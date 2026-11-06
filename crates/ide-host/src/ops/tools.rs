//! Language server / debug adapter installer (`ide-tools`).
use crate::Host;
use crate::ops::Channel;
use crate::rpc::Dispatcher;

use ide_core::{IdeError, IdeResult, RequestId};
use ide_tools::{InstallEvent, ToolInfo, Tools};

/// The installer, reporting the executables chosen in the window's settings.
fn tools(host: &Host, window: &str) -> IdeResult<Tools> {
    host.require_trust(window)?;
    let data = host.local_data_dir.clone();
    let (settings, root) = match host.project(window) {
        Ok(project) => (project.settings.effective(), project.root.clone()),
        Err(_) => (host.global_settings.effective(), Default::default()),
    };
    let custom = settings
        .tools
        .iter()
        .filter_map(|(command, t)| Some((command.clone(), ide_sdk::apply::setting_path(&root, &t.path)?)))
        .collect();
    // Godot is usually an app bundle / Flatpak outside the search path.
    let found = ide_sdk::godot::find(None).map(|p| (ide_sdk::godot::COMMAND.to_owned(), p));
    let work_dir = (!root.as_os_str().is_empty()).then_some(root);
    Ok(Tools::new(&data)
        .with_custom_paths(custom)
        .with_found_paths(found.into_iter().collect())
        .with_work_dir(work_dir))
}

/// The language definitions plus the servers defined in the window's settings.
fn languages(host: &Host, window: &str) -> Vec<ide_language::LanguageConfig> {
    let settings = match host.project(window) {
        Ok(project) => project.settings.effective(),
        Err(_) => host.global_settings.effective(),
    };
    let mut langs = host.languages.all();
    ide_sdk::apply::with_custom_servers(&mut langs, &settings);
    langs
}

fn join_err(e: impl std::fmt::Display) -> IdeError {
    IdeError::internal(e.to_string())
}

fn reconfigure_servers(host: &Host) {
    for project in host.projects() {
        let lsp = project.lsp.clone();
        host.runtime.spawn(async move { lsp.reconfigure().await });
    }
}

/// Status of every known language server / debug adapter and the languages using it.
pub async fn tools_list(host: &Host, window: &str) -> IdeResult<Vec<ToolInfo>> {
    let tools = tools(host, window)?;
    let langs = languages(host, window);
    tokio::task::spawn_blocking(move || tools.list(&langs)).await.map_err(join_err)
}

/// Installs (or reinstalls) a tool into `<app-data>/tools`, streaming output through
/// `on_event`. Cancel with `cancel_request(request)`.
pub async fn tools_install(
    host: &Host,
    window: &str,
    name: String,
    request: RequestId,
    on_event: Channel<InstallEvent>,
) -> IdeResult<ToolInfo> {
    let tools = tools(host, window)?;
    let langs = languages(host, window);
    let cancel = host.begin_request(request);
    let result = tokio::task::spawn_blocking(move || {
        tools.install(&name, &langs, &cancel, &|e| {
            let _ = on_event.send(e);
        })
    })
    .await
    .map_err(join_err);
    host.end_request(request);
    let info = result??;
    // Language servers pick up newly installed tools.
    reconfigure_servers(host);
    Ok(info)
}

/// Removes a tool the IDE installed.
pub async fn tools_uninstall(host: &Host, window: &str, name: String) -> IdeResult<ToolInfo> {
    let tools = tools(host, window)?;
    let langs = languages(host, window);
    let info = tokio::task::spawn_blocking(move || tools.uninstall(&name, &langs)).await.map_err(join_err)??;
    reconfigure_servers(host);
    Ok(info)
}

/// Commands of this module the remote server answers.
pub(crate) fn register(d: &mut Dispatcher) {
    d.add("tools_list", |c| async move { tools_list(&c.host, &c.window).await });
    d.add("tools_install", |c| async move {
        tools_install(&c.host, &c.window, c.arg("name")?, c.arg("request")?, c.sender("onEvent")?).await
    });
    d.add("tools_uninstall", |c| async move { tools_uninstall(&c.host, &c.window, c.arg("name")?).await });
}
