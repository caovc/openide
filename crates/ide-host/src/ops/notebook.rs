//! Native notebook operations shared by desktop IPC and the remote dispatcher.
use crate::Host;
pub use crate::notebook::{
    NotebookDapEvent, NotebookDapQuery, NotebookDapReply, NotebookLspQuery, NotebookOutputEvent, SessionReply,
};
use crate::ops::Channel;
use crate::rpc::Dispatcher;
use ide_core::{IdeError, IdeResult, RequestId};
use ide_notebook::{NotebookEdit, NotebookSnapshot};
use std::path::PathBuf;

pub async fn open(host: &Host, window: &str, path: String) -> IdeResult<NotebookSnapshot> {
    let project = host.project(window)?;
    if let Some(key) = path.strip_prefix("openide-console:") {
        let notebooks = project.notebooks.clone();
        let root = project.root.clone();
        let key = key.to_owned();
        return host.blocking(move || notebooks.open_console(&root, &key)).await;
    }
    let path = PathBuf::from(path);
    let path = if path.is_absolute() { path } else { project.root.join(path) };
    let notebooks = project.notebooks.clone();
    host.blocking(move || notebooks.open(&path)).await
}

pub fn get(host: &Host, window: &str, id: String) -> IdeResult<NotebookSnapshot> {
    host.project(window)?.notebooks.get(&id)
}

pub async fn edit(
    host: &Host,
    window: &str,
    id: String,
    version: u32,
    edit: NotebookEdit,
) -> IdeResult<NotebookSnapshot> {
    let notebooks = host.project(window)?.notebooks.clone();
    host.blocking(move || notebooks.edit(&id, version, edit)).await
}

pub async fn save(host: &Host, window: &str, id: String) -> IdeResult<NotebookSnapshot> {
    let notebooks = host.project(window)?.notebooks.clone();
    host.blocking(move || notebooks.save(&id)).await
}

pub async fn undo(host: &Host, window: &str, id: String) -> IdeResult<NotebookSnapshot> {
    let notebooks = host.project(window)?.notebooks.clone();
    host.blocking(move || notebooks.undo(&id, false)).await
}

pub async fn redo(host: &Host, window: &str, id: String) -> IdeResult<NotebookSnapshot> {
    let notebooks = host.project(window)?.notebooks.clone();
    host.blocking(move || notebooks.undo(&id, true)).await
}

pub async fn reload(host: &Host, window: &str, id: String) -> IdeResult<NotebookSnapshot> {
    let notebooks = host.project(window)?.notebooks.clone();
    // An abandoned IPC future must not leave a lifecycle transition half applied.
    tokio::spawn(async move { notebooks.reload(&id, false).await })
        .await
        .map_err(|error| IdeError::internal(error.to_string()))?
}

pub async fn restart(host: &Host, window: &str, id: String) -> IdeResult<NotebookSnapshot> {
    host.require_trust(window)?;
    let notebooks = host.project(window)?.notebooks.clone();
    tokio::spawn(async move { notebooks.reload(&id, true).await })
        .await
        .map_err(|error| IdeError::internal(error.to_string()))?
}

pub async fn close(host: &Host, window: &str, id: String) -> IdeResult<()> {
    let notebooks = host.project(window)?.notebooks.clone();
    tokio::spawn(async move { notebooks.close(&id).await })
        .await
        .map_err(|error| IdeError::internal(error.to_string()))?
}

pub async fn interrupt(host: &Host, window: &str, id: String) -> IdeResult<()> {
    let notebooks = host.project(window)?.notebooks.clone();
    tokio::spawn(async move { notebooks.interrupt(&id).await })
        .await
        .map_err(|error| IdeError::internal(error.to_string()))?
}

#[allow(clippy::too_many_arguments)]
pub async fn execute(
    host: &Host,
    window: &str,
    id: String,
    cells: Vec<String>,
    python: Option<String>,
    request: RequestId,
    on_output: Channel<NotebookOutputEvent>,
) -> IdeResult<NotebookSnapshot> {
    host.require_trust(window)?;
    let project = host.project(window)?;
    let cancel = host.begin_project_request(window, request);
    let _request = RequestGuard { host, request, cancel: cancel.clone() };
    // Reserve the WHOLE batch and capture source before asynchronous discovery.
    let admission = project.notebooks.admit(&id, cells, cancel.clone())?;
    let runtime = match python {
        Some(path) if path.trim().is_empty() => {
            return Err(IdeError::invalid("select a notebook kernel"));
        }
        Some(path) if path.starts_with(ide_notebook::discover::ARK_SELECTION_PREFIX) => {
            ide_notebook::parse_selection(&path)?
        }
        Some(path) => {
            let selected = PathBuf::from(path);
            // Do not canonicalize this path: resolving a venv symlink to base Python
            // changes sys.prefix and executes in the wrong environment.
            let python = if selected.is_absolute() { selected } else { project.root.join(selected) };
            if !python.is_absolute() {
                return Err(IdeError::invalid("python interpreter path must be absolute"));
            }
            ide_notebook::kernel::KernelRuntime::python(python)
        }
        None => {
            let root = project.root.clone();
            let settings = project.settings.effective();
            let selected = tokio::select! {
                biased;
                _ = cancel.cancelled() => return Err(IdeError::cancelled()),
                result = host.blocking(move || {
                    ide_sdk::apply::python_interpreter(&root, &settings)
                        .or_else(|| ide_sdk::detect(ide_sdk::SdkKind::Python, Some(&root))
                            .into_iter().next().map(|sdk| sdk.path.into_path_buf()))
                        .ok_or_else(|| IdeError::unavailable("select a Python environment with ipykernel installed"))
                }) => result?,
            };
            let python = if selected.is_absolute() { selected } else { project.root.join(selected) };
            ide_notebook::kernel::KernelRuntime::python(python)
        }
    };
    project.notebooks.execute(admission, runtime, on_output).await
}

pub async fn lsp(
    host: &Host,
    window: &str,
    id: String,
    query: NotebookLspQuery,
    request: RequestId,
) -> IdeResult<SessionReply> {
    host.require_trust(window)?;
    let project = host.project(window)?;
    let cancel = host.begin_project_request(window, request);
    let _request = RequestGuard { host, request, cancel: cancel.clone() };
    project.notebooks.lsp(&id, query, cancel).await
}

pub async fn input_reply(
    host: &Host,
    window: &str,
    id: String,
    prompt: String,
    value: Option<String>,
) -> IdeResult<()> {
    host.require_trust(window)?;
    host.project(window)?.notebooks.input_reply(&id, prompt, value).await
}

pub async fn dap(
    host: &Host,
    window: &str,
    id: String,
    query: NotebookDapQuery,
    request: RequestId,
) -> IdeResult<NotebookDapReply> {
    host.require_trust(window)?;
    let project = host.project(window)?;
    let cancel = host.begin_project_request(window, request);
    let _request = RequestGuard { host, request, cancel: cancel.clone() };
    project.notebooks.dap(&id, query, cancel).await
}

pub async fn dap_events(
    host: &Host,
    window: &str,
    id: String,
    selection: String,
    request: RequestId,
    on_event: Channel<NotebookDapEvent>,
) -> IdeResult<()> {
    host.require_trust(window)?;
    let project = host.project(window)?;
    let cancel = host.begin_project_request(window, request);
    let _request = RequestGuard { host, request, cancel: cancel.clone() };
    project.notebooks.dap_events(&id, &selection, cancel, on_event).await
}

pub async fn stop_kernel(host: &Host, window: &str, id: String) -> IdeResult<()> {
    let notebooks = host.project(window)?.notebooks.clone();
    tokio::spawn(async move { notebooks.stop_kernel(&id).await })
        .await
        .map_err(|error| IdeError::internal(error.to_string()))?
}

struct RequestGuard<'a> {
    host: &'a Host,
    request: RequestId,
    cancel: ide_core::CancellationToken,
}

impl Drop for RequestGuard<'_> {
    fn drop(&mut self) {
        // If the invocation is dropped, the owned batch still receives cancellation.
        self.cancel.cancel();
        self.host.end_request(self.request);
    }
}

pub(crate) fn register(d: &mut Dispatcher) {
    d.add("notebook_dap_events", |c| async move {
        dap_events(&c.host, &c.window, c.arg("id")?, c.arg("selection")?, c.arg("request")?, c.sender("onEvent")?).await
    });
    d.add("notebook_input_reply", |c| async move {
        input_reply(&c.host, &c.window, c.arg("id")?, c.arg("prompt")?, c.arg("value")?).await
    });
    d.add("notebook_dap", |c| async move {
        dap(&c.host, &c.window, c.arg("id")?, c.arg("query")?, c.arg("request")?).await
    });
    d.add("notebook_lsp", |c| async move {
        lsp(&c.host, &c.window, c.arg("id")?, c.arg("query")?, c.arg("request")?).await
    });
    d.add("notebook_stop_kernel", |c| async move { stop_kernel(&c.host, &c.window, c.arg("id")?).await });
    d.add("notebook_open", |c| async move { open(&c.host, &c.window, c.arg("path")?).await });
    d.add("notebook_get", |c| async move { get(&c.host, &c.window, c.arg("id")?) });
    d.add("notebook_edit", |c| async move {
        edit(&c.host, &c.window, c.arg("id")?, c.arg("version")?, c.arg("edit")?).await
    });
    d.add("notebook_save", |c| async move { save(&c.host, &c.window, c.arg("id")?).await });
    d.add("notebook_reload", |c| async move { reload(&c.host, &c.window, c.arg("id")?).await });
    d.add("notebook_undo", |c| async move { undo(&c.host, &c.window, c.arg("id")?).await });
    d.add("notebook_redo", |c| async move { redo(&c.host, &c.window, c.arg("id")?).await });
    d.add("notebook_close", |c| async move { close(&c.host, &c.window, c.arg("id")?).await });
    d.add("notebook_interrupt", |c| async move { interrupt(&c.host, &c.window, c.arg("id")?).await });
    d.add("notebook_restart", |c| async move { restart(&c.host, &c.window, c.arg("id")?).await });
    d.add("notebook_detect_runtimes", |_c| async move { Ok::<_, IdeError>(ide_notebook::detect_ark()) });
    d.add("notebook_execute", |c| async move {
        execute(
            &c.host,
            &c.window,
            c.arg("id")?,
            c.arg("cells")?,
            c.arg("python")?,
            c.arg("request")?,
            c.sender("onOutput")?,
        )
        .await
    });
}
