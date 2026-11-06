use ide_core::{CancellationToken, NullSink, RequestId, error::ErrorKind};
use ide_host::{Host, HostConfig, notebook::NotebookService, ops};
use ide_notebook::{NotebookEdit, kernel::KernelRuntime};
use std::{path::Path, sync::Arc, time::Duration};

fn host(base: &Path) -> Arc<Host> {
    Arc::new(Host::new(HostConfig {
        config_dir: base.join("config"),
        data_dir: base.join("data"),
        local_data_dir: base.join("data"),
        languages: Arc::new(ide_language::LanguageRegistry::load(None).unwrap()),
        syntax: Arc::default(),
        sink_for: Box::new(|_| Arc::new(NullSink)),
        owner: |window| window,
        runtime: tokio::runtime::Handle::current(),
        project_environment: false,
    }))
}

#[tokio::test]
async fn explicit_start_requires_trust_and_a_valid_selection() {
    let temp = tempfile::tempdir().unwrap();
    let host = host(temp.path());
    host.open_project("main", temp.path()).unwrap();
    let before = ops::notebook::open(&host, "main", "openide-console:start".into()).await.unwrap();
    let error =
        ops::notebook::start_kernel(&host, "main", before.id.clone(), "/missing/python".into(), RequestId::next())
            .await
            .unwrap_err();
    assert_eq!(error.kind, ErrorKind::Unavailable);
    assert!(error.message.contains("Restricted Mode"), "{error}");
    host.set_project_trust(temp.path(), true, false).await.unwrap();
    for selection in ["", "python", "ark:not-a-selection"] {
        assert!(
            ops::notebook::start_kernel(&host, "main", before.id.clone(), selection.into(), RequestId::next())
                .await
                .is_err()
        );
    }
    assert_eq!(
        serde_json::to_value(&before).unwrap(),
        serde_json::to_value(host.project("main").unwrap().notebooks.get(&before.id).unwrap()).unwrap()
    );
    host.shutdown().await;
}

#[tokio::test]
async fn cancelled_start_does_not_mutate_document_or_reserve_admission() {
    let temp = tempfile::tempdir().unwrap();
    let service = NotebookService::new(temp.path().join("runtime"), Arc::new(NullSink));
    let before = service.open_console(temp.path(), "cancel").unwrap();
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert_eq!(
        service.start_kernel(&before.id, KernelRuntime::python("/missing/python"), cancel).await.unwrap_err().kind,
        ErrorKind::Cancelled
    );
    assert_eq!(serde_json::to_value(&before).unwrap(), serde_json::to_value(service.get(&before.id).unwrap()).unwrap());
    // A failed launch also releases admission, allowing lifecycle cleanup immediately.
    assert!(
        service
            .start_kernel(
                &before.id,
                KernelRuntime::python(temp.path().join("missing-python")),
                CancellationToken::new()
            )
            .await
            .is_err()
    );
    tokio::time::timeout(Duration::from_secs(2), service.close(&before.id)).await.unwrap().unwrap();
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn close_drains_inflight_startup_without_resurrecting_document() {
    use std::os::unix::fs::PermissionsExt;
    let temp = tempfile::tempdir().unwrap();
    let executable = temp.path().join("slow-python");
    let marker = temp.path().join("started");
    // The fake interpreter deliberately never answers Jupyter's handshake.
    std::fs::write(&executable, format!("#!/bin/sh\ntouch '{}'\nexec sleep 60\n", marker.display())).unwrap();
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
    let runtime_dir = temp.path().join("runtime");
    let service = NotebookService::new(runtime_dir.clone(), Arc::new(NullSink));
    let document = service.open_console(temp.path(), "close-race").unwrap();
    let pending = {
        let service = service.clone();
        let id = document.id.clone();
        tokio::spawn(async move {
            service.start_kernel(&id, KernelRuntime::python(executable), CancellationToken::new()).await
        })
    };
    tokio::time::timeout(Duration::from_secs(5), async {
        while !marker.exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    tokio::time::timeout(Duration::from_secs(5), service.close(&document.id)).await.unwrap().unwrap();
    assert!(pending.await.unwrap().is_err());
    assert!(service.get(&document.id).is_err());
    assert_eq!(std::fs::read_dir(runtime_dir).unwrap().count(), 0);
}

#[cfg(unix)]
fn slow_interpreter(base: &Path) -> (std::path::PathBuf, std::path::PathBuf) {
    use std::os::unix::fs::PermissionsExt;
    let executable = base.join("slow-python");
    let marker = base.join("connection-path");
    // Python is launched with -m ipykernel_launcher -f <connection file>.
    std::fs::write(&executable, format!("#!/bin/sh\nprintf '%s' \"$4\" > '{}'\nexec sleep 60\n", marker.display()))
        .unwrap();
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
    (executable, marker)
}

#[cfg(unix)]
async fn started_directory(marker: &Path) -> std::path::PathBuf {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Ok(path) = std::fs::read_to_string(marker)
                && !path.is_empty()
            {
                return Path::new(&path).parent().unwrap().to_path_buf();
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap()
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn abandoned_ipc_start_cancels_owned_startup_and_releases_admission() {
    let temp = tempfile::tempdir().unwrap();
    let (executable, marker) = slow_interpreter(temp.path());
    let host = host(temp.path());
    host.open_project("main", temp.path()).unwrap();
    host.set_project_trust(temp.path(), true, false).await.unwrap();
    let before = ops::notebook::open(&host, "main", "openide-console:abandoned-start".into()).await.unwrap();
    let pending = {
        let host = host.clone();
        let id = before.id.clone();
        tokio::spawn(async move {
            ops::notebook::start_kernel(&host, "main", id, executable.to_string_lossy().into_owned(), RequestId::next())
                .await
        })
    };
    let directory = started_directory(&marker).await;
    assert!(directory.exists());
    pending.abort();
    assert!(pending.await.unwrap_err().is_cancelled());
    // No lifecycle operation here: dropping the IPC future itself must stop the process.
    tokio::time::timeout(Duration::from_secs(5), async {
        while directory.exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let service = host.project("main").unwrap().notebooks.clone();
    assert_eq!(serde_json::to_value(&before).unwrap(), serde_json::to_value(service.get(&before.id).unwrap()).unwrap());
    // Await admission release without using close/interrupt to mask a leaked request.
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let error = service
                .start_kernel(
                    &before.id,
                    KernelRuntime::python(temp.path().join("missing-python")),
                    CancellationToken::new(),
                )
                .await
                .unwrap_err();
            if !error.message.contains("already running") {
                assert!(error.message.contains("cannot start selected"), "{error}");
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    host.shutdown().await;
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn restart_and_restriction_drain_pending_startup() {
    for restart in [true, false] {
        let temp = tempfile::tempdir().unwrap();
        let (executable, marker) = slow_interpreter(temp.path());
        let service = NotebookService::new(temp.path().join("runtime"), Arc::new(NullSink));
        let before = service.open_console(temp.path(), "pending-transition").unwrap();
        let pending = {
            let service = service.clone();
            let id = before.id.clone();
            tokio::spawn(async move {
                service.start_kernel(&id, KernelRuntime::python(executable), CancellationToken::new()).await
            })
        };
        let directory = started_directory(&marker).await;
        tokio::time::timeout(Duration::from_secs(5), async {
            if restart {
                service.reload(&before.id, true).await.unwrap();
            } else {
                service.restrict().await;
            }
        })
        .await
        .unwrap();
        assert!(pending.await.unwrap().is_err());
        assert!(!directory.exists());
        assert_eq!(
            serde_json::to_value(&before).unwrap(),
            serde_json::to_value(service.get(&before.id).unwrap()).unwrap()
        );
        service.close(&before.id).await.unwrap();
    }
}

/// Run once with OPENIDE_B0_RUNTIME=python and once with =ark, sourcing the real runtime fixture.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires explicit Python/ipykernel or Ark/R runtime"]
async fn real_start_preserves_document_and_reuses_generation_until_restart() {
    let ark = std::env::var("OPENIDE_B0_RUNTIME").unwrap_or_else(|_| "python".into()) == "ark";
    let selection = if ark {
        ide_notebook::discover::encode_ark(
            Path::new(&std::env::var("OPENIDE_ARK").unwrap()),
            Path::new(&std::env::var("R_HOME").unwrap()),
        )
    } else {
        std::env::var("OPENIDEA_TEST_PYTHON").unwrap()
    };
    let temp = tempfile::tempdir().unwrap();
    let host = host(temp.path());
    host.open_project("main", temp.path()).unwrap();
    host.set_project_trust(temp.path(), true, false).await.unwrap();
    let before = ops::notebook::open(&host, "main", "openide-console:real-start".into()).await.unwrap();
    let id = before.id.clone();
    let service = host.project("main").unwrap().notebooks.clone();
    let inserted =
        service.edit(&id, before.version, NotebookEdit::InsertCell { after: None, cell_type: "code".into() }).unwrap();
    let cell = inserted.cells[0].id.clone();
    let sentinel = if ark {
        "stop('startup must never execute this cell')"
    } else {
        "raise RuntimeError('startup must never execute this cell')"
    };
    let edited = service
        .edit(&id, inserted.version, NotebookEdit::SetSource { cell: cell.clone(), source: sentinel.into() })
        .unwrap();
    let before = service
        .edit(
            &id,
            edited.version,
            NotebookEdit::SetOutputs {
                cell: cell.clone(),
                outputs: vec![serde_json::json!({"output_type":"stream","name":"stdout","text":"saved output"})],
                execution_count: Some(42),
            },
        )
        .unwrap();
    let first =
        ops::notebook::start_kernel(&host, "main", id.clone(), selection.clone(), RequestId::next()).await.unwrap();
    assert_eq!(first.id, id);
    assert_eq!(first.selection, selection);
    assert_eq!(first.language, if ark { "r" } else { "python" });
    assert!(!first.token.is_empty());
    assert_eq!(serde_json::to_value(&before).unwrap(), serde_json::to_value(service.get(&id).unwrap()).unwrap());
    let repeat =
        ops::notebook::start_kernel(&host, "main", id.clone(), selection.clone(), RequestId::next()).await.unwrap();
    assert_eq!(first.token, repeat.token);
    let other = service.open_console(temp.path(), "other").unwrap();
    let other_session =
        ops::notebook::start_kernel(&host, "main", other.id.clone(), selection.clone(), RequestId::next())
            .await
            .unwrap();
    service.validate_kernel_session(&other.id, &other_session.token).unwrap();
    service.validate_kernel_session(&id, &first.token).unwrap();
    assert!(service.validate_kernel_session(&other.id, &first.token).is_err());
    assert!(service.validate_kernel_session(&id, &other_session.token).is_err());
    service.close(&other.id).await.unwrap();
    let source = if ark {
        "openide_start_value <- 73; openide_start_pid <- Sys.getpid(); cat(openide_start_pid)"
    } else {
        "import os\nopenide_start_value = 73\nopenide_start_pid = os.getpid()\nprint(openide_start_pid)"
    };
    service.edit(&id, before.version, NotebookEdit::SetSource { cell: cell.clone(), source: source.into() }).unwrap();
    let executed = ops::notebook::execute(
        &host,
        "main",
        id.clone(),
        vec![cell.clone()],
        Some(selection.clone()),
        RequestId::next(),
        ops::Channel::new(|_| {}),
    )
    .await
    .unwrap();
    assert_eq!(executed.cells[0].execution_count, Some(1));
    let repeat =
        ops::notebook::start_kernel(&host, "main", id.clone(), selection.clone(), RequestId::next()).await.unwrap();
    assert_eq!(first.token, repeat.token);
    let source = if ark {
        "stopifnot(openide_start_value == 73, openide_start_pid == Sys.getpid()); cat('preserved')"
    } else {
        "assert openide_start_value == 73 and openide_start_pid == os.getpid()\nprint('preserved')"
    };
    service.edit(&id, executed.version, NotebookEdit::SetSource { cell: cell.clone(), source: source.into() }).unwrap();
    let executed = ops::notebook::execute(
        &host,
        "main",
        id.clone(),
        vec![cell],
        Some(selection.clone()),
        RequestId::next(),
        ops::Channel::new(|_| {}),
    )
    .await
    .unwrap();
    assert!(serde_json::to_string(&executed.cells[0].outputs).unwrap().contains("preserved"));
    let cancelled = CancellationToken::new();
    cancelled.cancel();
    assert!(service.start_kernel(&id, ide_notebook::parse_selection(&selection).unwrap(), cancelled).await.is_err());
    service.validate_kernel_session(&id, &first.token).unwrap();
    assert!(
        service
            .start_kernel(&id, KernelRuntime::python(temp.path().join("other-python")), CancellationToken::new())
            .await
            .is_err()
    );
    service.validate_kernel_session(&id, &first.token).unwrap();
    ops::notebook::restart(&host, "main", id.clone()).await.unwrap();
    assert!(service.validate_kernel_session(&id, &first.token).is_err());
    let restarted = ops::notebook::start_kernel(&host, "main", id.clone(), selection, RequestId::next()).await.unwrap();
    assert_ne!(first.token, restarted.token);
    service.close(&id).await.unwrap();
    assert!(service.validate_kernel_session(&id, &restarted.token).is_err());
    host.shutdown().await;
}
