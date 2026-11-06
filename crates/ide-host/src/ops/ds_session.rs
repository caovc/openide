//! Thin, document-authorized access to the shared kernel session panels.
use crate::Host;
use crate::notebook::NotebookService;
use ide_core::{IdeError, IdeResult, SharedSink};
use ide_notebook::session::{SessionChildren, SessionData, SessionSnapshot};
use parking_lot::Mutex;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock, Weak};

type Owners = Vec<(Weak<NotebookService>, PathBuf)>;
static OWNERS: OnceLock<Mutex<Owners>> = OnceLock::new();

/// Additive project-service registration; the existing NotebookService owns
/// execution and lifecycle unchanged. Weak registration never keeps it alive.
pub(crate) fn notebook_service(runtime: PathBuf, sink: SharedSink) -> Arc<NotebookService> {
    let service = NotebookService::new(runtime.clone(), sink);
    let mut owners = OWNERS.get_or_init(Default::default).lock();
    owners.retain(|(owner, _)| owner.strong_count() > 0);
    owners.push((Arc::downgrade(&service), runtime));
    service
}

fn scope(service: &Arc<NotebookService>) -> IdeResult<PathBuf> {
    OWNERS
        .get_or_init(Default::default)
        .lock()
        .iter()
        .find(|(owner, _)| owner.ptr_eq(&Arc::downgrade(service)))
        .map(|(_, runtime)| runtime.clone())
        .ok_or_else(|| IdeError::unavailable("session owner is not registered"))
}

pub fn snapshot(host: &Host, window: &str, id: String) -> IdeResult<Option<SessionSnapshot>> {
    host.require_trust(window)?;
    let project = host.project(window)?;
    let document = project.notebooks.get(&id)?;
    SessionData::for_owner_path(&scope(&project.notebooks)?, &document.path)?
        .map(|session| session.snapshot())
        .transpose()
}

pub async fn inspect(
    host: &Host,
    window: &str,
    id: String,
    generation: String,
    revision: u32,
    path: Vec<String>,
) -> IdeResult<SessionChildren> {
    host.require_trust(window)?;
    let project = host.project(window)?;
    let document = project.notebooks.get(&id)?;
    let session = SessionData::for_owner_path(&scope(&project.notebooks)?, &document.path)?
        .ok_or_else(|| IdeError::unavailable("session has stopped"))?;
    let children = session.inspect(&generation, revision, path).await?;
    project.notebooks.get(&id)?;
    host.require_trust(window)?;
    if !Arc::ptr_eq(&project, &host.project(window)?) {
        return Err(IdeError::cancelled());
    }
    Ok(children)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_registration_is_unique_and_does_not_retain_the_service() {
        let root = tempfile::tempdir().unwrap();
        let first = notebook_service(root.path().join("first"), Arc::new(ide_core::NullSink));
        let second = notebook_service(root.path().join("second"), Arc::new(ide_core::NullSink));
        assert_ne!(scope(&first).unwrap(), scope(&second).unwrap());
        let weak = Arc::downgrade(&first);
        drop(first);
        assert!(weak.upgrade().is_none());
        let unregistered = NotebookService::new(root.path().join("unregistered"), Arc::new(ide_core::NullSink));
        assert!(scope(&unregistered).is_err());
    }
}
