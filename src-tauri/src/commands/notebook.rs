//! Thin desktop adapters for the shared native notebook service.
use crate::state::AppState;
use ide_core::{IdeResult, RequestId};
use ide_host::ops::notebook::{
    self, NotebookDapEvent, NotebookDapQuery, NotebookDapReply, NotebookLspQuery, NotebookOutputEvent, SessionReply,
};
use ide_notebook::{NotebookEdit, NotebookRuntimeInfo, NotebookSnapshot};
use tauri::ipc::Channel;
use tauri::{State, Window};

#[tauri::command]
#[specta::specta]
pub async fn notebook_start_kernel(
    window: Window,
    state: State<'_, AppState>,
    id: String,
    selection: String,
    request: RequestId,
) -> IdeResult<ide_host::notebook::NotebookKernelSession> {
    notebook::start_kernel(&state.host, window.label(), id, selection, request).await
}

#[tauri::command]
#[specta::specta]
pub async fn notebook_project_environment(
    window: Window,
    state: State<'_, AppState>,
    near: Option<std::path::PathBuf>,
) -> IdeResult<ide_notebook::environment::RProjectEnvironment> {
    notebook::project_environment(&state.host, window.label(), near).await
}

#[tauri::command]
#[specta::specta]
pub async fn notebook_open(window: Window, state: State<'_, AppState>, path: String) -> IdeResult<NotebookSnapshot> {
    notebook::open(&state.host, window.label(), path).await
}

#[tauri::command]
#[specta::specta]
pub fn notebook_get(window: Window, state: State<'_, AppState>, id: String) -> IdeResult<NotebookSnapshot> {
    notebook::get(&state.host, window.label(), id)
}

#[tauri::command]
#[specta::specta]
pub async fn notebook_edit(
    window: Window,
    state: State<'_, AppState>,
    id: String,
    version: u32,
    edit: NotebookEdit,
) -> IdeResult<NotebookSnapshot> {
    notebook::edit(&state.host, window.label(), id, version, edit).await
}

#[tauri::command]
#[specta::specta]
pub async fn notebook_save(window: Window, state: State<'_, AppState>, id: String) -> IdeResult<NotebookSnapshot> {
    notebook::save(&state.host, window.label(), id).await
}

#[tauri::command]
#[specta::specta]
pub async fn notebook_reload(window: Window, state: State<'_, AppState>, id: String) -> IdeResult<NotebookSnapshot> {
    notebook::reload(&state.host, window.label(), id).await
}

#[tauri::command]
#[specta::specta]
pub async fn notebook_undo(window: Window, state: State<'_, AppState>, id: String) -> IdeResult<NotebookSnapshot> {
    notebook::undo(&state.host, window.label(), id).await
}

#[tauri::command]
#[specta::specta]
pub async fn notebook_redo(window: Window, state: State<'_, AppState>, id: String) -> IdeResult<NotebookSnapshot> {
    notebook::redo(&state.host, window.label(), id).await
}

#[tauri::command]
#[specta::specta]
pub async fn notebook_close(window: Window, state: State<'_, AppState>, id: String) -> IdeResult<()> {
    notebook::close(&state.host, window.label(), id).await
}

#[tauri::command]
#[specta::specta]
pub async fn notebook_interrupt(window: Window, state: State<'_, AppState>, id: String) -> IdeResult<()> {
    notebook::interrupt(&state.host, window.label(), id).await
}

#[tauri::command]
#[specta::specta]
pub async fn notebook_restart(window: Window, state: State<'_, AppState>, id: String) -> IdeResult<NotebookSnapshot> {
    notebook::restart(&state.host, window.label(), id).await
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn notebook_execute(
    window: Window,
    state: State<'_, AppState>,
    id: String,
    cells: Vec<String>,
    python: Option<String>,
    request: RequestId,
    on_output: Channel<NotebookOutputEvent>,
) -> IdeResult<NotebookSnapshot> {
    notebook::execute(&state.host, window.label(), id, cells, python, request, super::sender(on_output)).await
}

#[tauri::command]
#[specta::specta]
pub fn notebook_detect_runtimes() -> IdeResult<Vec<NotebookRuntimeInfo>> {
    let mut runtimes = Vec::new();
    // Python discovery stays on sdkDetect("python"); this adds Ark only so the
    // UI can merge lists without silently inventing a Python fallback.
    runtimes.extend(ide_notebook::detect_ark());
    Ok(runtimes)
}

#[tauri::command]
#[specta::specta]
pub async fn notebook_lsp(
    window: Window,
    state: State<'_, AppState>,
    id: String,
    query: NotebookLspQuery,
    request: RequestId,
) -> IdeResult<SessionReply> {
    notebook::lsp(&state.host, window.label(), id, query, request).await
}

#[tauri::command]
#[specta::specta]
pub async fn notebook_stop_kernel(window: Window, state: State<'_, AppState>, id: String) -> IdeResult<()> {
    notebook::stop_kernel(&state.host, window.label(), id).await
}

#[tauri::command]
#[specta::specta]
pub async fn notebook_input_reply(
    window: Window,
    state: State<'_, AppState>,
    id: String,
    prompt: String,
    value: Option<String>,
) -> IdeResult<()> {
    notebook::input_reply(&state.host, window.label(), id, prompt, value).await
}

#[tauri::command]
#[specta::specta]
pub async fn notebook_dap(
    window: Window,
    state: State<'_, AppState>,
    id: String,
    query: NotebookDapQuery,
    request: RequestId,
) -> IdeResult<NotebookDapReply> {
    notebook::dap(&state.host, window.label(), id, query, request).await
}

#[tauri::command]
#[specta::specta]
pub async fn notebook_dap_events(
    window: Window,
    state: State<'_, AppState>,
    id: String,
    selection: String,
    request: RequestId,
    on_event: Channel<NotebookDapEvent>,
) -> IdeResult<()> {
    notebook::dap_events(&state.host, window.label(), id, selection, request, super::sender(on_event)).await
}
