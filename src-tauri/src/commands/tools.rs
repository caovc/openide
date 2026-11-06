//! IPC commands of `ide_host::ops::tools` (the shared implementation).

use crate::state::AppState;
use ide_core::{IdeResult, RequestId};
#[allow(unused_imports)]
pub use ide_host::ops::tools::*;
use ide_tools::{InstallEvent, ToolInfo};
use tauri::ipc::Channel;
use tauri::{State, Window};

/// Status of every known language server / debug adapter and the languages using it.
#[tauri::command]
#[specta::specta]
pub async fn tools_list(window: Window, state: State<'_, AppState>) -> IdeResult<Vec<ToolInfo>> {
    ide_host::ops::tools::tools_list(&state.host, window.label()).await
}

/// Installs (or reinstalls) a tool into `<app-data>/tools`, streaming output through
/// `on_event`. Cancel with `cancel_request(request)`.
#[tauri::command]
#[specta::specta]
pub async fn tools_install(
    window: Window,
    state: State<'_, AppState>,
    name: String,
    request: RequestId,
    on_event: Channel<InstallEvent>,
) -> IdeResult<ToolInfo> {
    ide_host::ops::tools::tools_install(&state.host, window.label(), name, request, crate::commands::sender(on_event))
        .await
}

/// Removes a tool the IDE installed.
#[tauri::command]
#[specta::specta]
pub async fn tools_uninstall(window: Window, state: State<'_, AppState>, name: String) -> IdeResult<ToolInfo> {
    ide_host::ops::tools::tools_uninstall(&state.host, window.label(), name).await
}
