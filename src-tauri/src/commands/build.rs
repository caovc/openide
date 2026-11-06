//! IPC commands for project compilation.
use crate::state::AppState;
use ide_build::compile::{BuildEvent, BuildKind, BuildResult};
use ide_core::{IdeResult, RequestId};
use tauri::ipc::Channel;
use tauri::{State, Window};

#[tauri::command]
#[specta::specta]
pub async fn build_run(
    window: Window,
    state: State<'_, AppState>,
    kind: BuildKind,
    file: Option<std::path::PathBuf>,
    request: RequestId,
    clear: Vec<std::path::PathBuf>,
    on_event: Channel<BuildEvent>,
) -> IdeResult<BuildResult> {
    ide_host::ops::build::build_run(
        &state.host,
        window.label(),
        kind,
        file,
        request,
        clear,
        crate::commands::sender(on_event),
    )
    .await
}
