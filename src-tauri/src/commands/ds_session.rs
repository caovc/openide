//! Shared Session Variables / Plots IPC adapters.
use crate::state::AppState;
use ide_core::IdeResult;
use ide_notebook::session::{SessionChildren, SessionSnapshot};
use tauri::{State, Window};

#[tauri::command]
#[specta::specta]
pub fn ds_session_snapshot(
    window: Window,
    state: State<'_, AppState>,
    id: String,
) -> IdeResult<Option<SessionSnapshot>> {
    ide_host::ops::ds_session::snapshot(&state.host, window.label(), id)
}

#[tauri::command]
#[specta::specta]
pub async fn ds_session_inspect(
    window: Window,
    state: State<'_, AppState>,
    id: String,
    generation: String,
    revision: u32,
    path: Vec<String>,
) -> IdeResult<SessionChildren> {
    ide_host::ops::ds_session::inspect(&state.host, window.label(), id, generation, revision, path).await
}
