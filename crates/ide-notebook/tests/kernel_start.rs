//! Explicit startup must not execute user source, replace a live selection, or revive closed sessions.
use ide_core::{CancellationToken, error::ErrorKind};
use ide_notebook::kernel::{ExecutionResult, KernelManager, KernelOutput, KernelRuntime};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

type Outputs = Arc<Mutex<Vec<KernelOutput>>>;

fn manager(root: &Path) -> Arc<KernelManager> {
    Arc::new(KernelManager::new(root.join("runtime"), Arc::new(|_, _, _| {})))
}

async fn run(
    manager: &KernelManager,
    notebook: &Path,
    runtime: &KernelRuntime,
    code: &str,
) -> (ExecutionResult, String) {
    let outputs: Outputs = Arc::default();
    let sink = outputs.clone();
    let result = manager
        .execute_runtime(
            notebook,
            runtime,
            code,
            CancellationToken::new(),
            Arc::new(move |output| sink.lock().unwrap().push(output)),
        )
        .await
        .unwrap();
    assert_eq!(result.status, "ok");
    let text = outputs.lock().unwrap().iter().filter_map(|output| output.content["text"].as_str()).collect::<String>();
    (result, text)
}

fn pid(text: &str) -> i32 {
    text.lines().find_map(|line| line.strip_prefix("PID=")).expect("kernel PID output").trim().parse().unwrap()
}

fn assert_runtime_empty(root: &Path) {
    let dir = root.join("runtime");
    assert!(!dir.exists() || std::fs::read_dir(dir).unwrap().next().is_none(), "runtime files leaked");
}

#[tokio::test]
async fn cancelled_start_and_closed_manager_never_spawn() {
    let root = tempfile::tempdir().unwrap();
    let manager = manager(root.path());
    let notebook = root.path().join("notebook.ipynb");
    let runtime = KernelRuntime::python(root.path().join("not-an-interpreter"));
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert_eq!(manager.ensure_started(&notebook, &runtime, cancel).await.err().unwrap().kind, ErrorKind::Cancelled);
    assert!(manager.comms(&notebook).is_err());
    assert_runtime_empty(root.path());
    manager.shutdown().await;
    assert_eq!(
        manager.ensure_started(&notebook, &runtime, CancellationToken::new()).await.err().unwrap().kind,
        ErrorKind::Unavailable
    );
    assert_runtime_empty(root.path());
}

#[tokio::test]
async fn missing_selected_runtime_reports_its_path_without_fallback() {
    let root = tempfile::tempdir().unwrap();
    let manager = manager(root.path());
    let notebook = root.path().join("notebook.ipynb");
    let missing = root.path().join("missing-selected-python");
    let error = manager
        .ensure_started(&notebook, &KernelRuntime::python(&missing), CancellationToken::new())
        .await
        .err()
        .unwrap();
    assert!(error.message.contains(missing.to_string_lossy().as_ref()), "{error}");
    assert!(error.message.contains("no fallback interpreter"), "{error}");
    assert!(manager.comms(&notebook).is_err());
    manager.shutdown().await;
    assert_runtime_empty(root.path());
}

async fn real_start(runtime: KernelRuntime) {
    let root = tempfile::tempdir().unwrap();
    let manager = manager(root.path());
    let notebook = root.path().join("notebook.ipynb");
    // A sentinel on disk proves startup does not alter or attempt to execute the document.
    let source = "unexecuted user source must stay untouched";
    std::fs::write(&notebook, source).unwrap();
    let handle = manager.ensure_started(&notebook, &runtime, CancellationToken::new()).await.unwrap();
    let generation = handle.session().snapshot().unwrap().generation;
    let repeated = manager.ensure_started(&notebook, &runtime, CancellationToken::new()).await.unwrap();
    assert!(Arc::ptr_eq(handle.session(), repeated.session()));
    assert_eq!(generation, repeated.session().snapshot().unwrap().generation);
    assert_eq!(std::fs::read_to_string(&notebook).unwrap(), source);
    let python = matches!(runtime, KernelRuntime::Python { .. });
    let setup = if python {
        "import os\nkept = 41\nprint('PID='+str(os.getpid()))"
    } else {
        "kept <- 41; cat('PID=', Sys.getpid(), '\n', sep='')"
    };
    let identity = if python { "print('PID='+str(os.getpid()))" } else { "cat('PID=', Sys.getpid(), '\n', sep='')" };
    let (first, text) = run(&manager, &notebook, &runtime, setup).await;
    assert_eq!(first.execution_count, Some(1), "startup must not consume user execution counts");
    let first_pid = pid(&text);
    let repeated = manager.ensure_started(&notebook, &runtime, CancellationToken::new()).await.unwrap();
    assert_eq!(repeated.session().snapshot().unwrap().generation, generation);
    let (second, text) = run(&manager, &notebook, &runtime, identity).await;
    assert_eq!(second.execution_count, Some(2));
    assert_eq!(first_pid, pid(&text));
    let other_runtime = KernelRuntime::python(root.path().join("other-runtime"));
    let error = manager.ensure_started(&notebook, &other_runtime, CancellationToken::new()).await.err().unwrap();
    assert_eq!(error.kind, ErrorKind::Unavailable);
    assert!(error.message.contains("stop the current notebook kernel"));
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert_eq!(manager.ensure_started(&notebook, &runtime, cancel).await.err().unwrap().kind, ErrorKind::Cancelled);
    assert!(!handle.is_closed());
    let value = if python { "print('VALUE='+str(kept+1))" } else { "cat('VALUE=', kept+1, '\n', sep='')" };
    assert!(run(&manager, &notebook, &runtime, value).await.1.contains("VALUE=42"));

    if python {
        let busy = Arc::new(tokio::sync::Notify::new());
        let observed = busy.clone();
        let task_manager = manager.clone();
        let task_notebook = notebook.clone();
        let task_runtime = runtime.clone();
        let task = tokio::spawn(async move {
            task_manager
                .execute_runtime(
                    &task_notebook,
                    &task_runtime,
                    "import time\nprint('BUSY', flush=True)\ntime.sleep(1)\nkept += 1",
                    CancellationToken::new(),
                    Arc::new(move |output| {
                        if output.content["text"].as_str().is_some_and(|text| text.contains("BUSY")) {
                            observed.notify_one();
                        }
                    }),
                )
                .await
        });
        tokio::time::timeout(Duration::from_secs(10), busy.notified()).await.unwrap();
        let during_execution = manager.ensure_started(&notebook, &runtime, CancellationToken::new()).await.unwrap();
        assert!(Arc::ptr_eq(handle.session(), during_execution.session()));
        let cancel = CancellationToken::new();
        cancel.cancel();
        assert_eq!(manager.ensure_started(&notebook, &runtime, cancel).await.err().unwrap().kind, ErrorKind::Cancelled);
        assert_eq!(task.await.unwrap().unwrap().status, "ok");
        assert!(run(&manager, &notebook, &runtime, "print('VALUE='+str(kept))").await.1.contains("VALUE=42"));
    }

    let other = root.path().join("other.ipynb");
    let independent = manager.ensure_started(&other, &runtime, CancellationToken::new()).await.unwrap();
    let independent_generation = independent.session().snapshot().unwrap().generation;
    manager.restart(&notebook).await.unwrap();
    assert!(handle.is_closed());
    assert!(handle.session().snapshot().is_err());
    let fresh = manager.ensure_started(&notebook, &runtime, CancellationToken::new()).await.unwrap();
    assert_ne!(fresh.session().snapshot().unwrap().generation, generation);
    assert_eq!(independent.session().snapshot().unwrap().generation, independent_generation);
    let (restarted, text) = run(&manager, &notebook, &runtime, setup).await;
    assert_eq!(restarted.execution_count, Some(1));
    let next_pid = pid(&text);
    assert_ne!(next_pid, first_pid);
    manager.shutdown_kernel(&notebook).await.unwrap();
    assert!(fresh.is_closed());
    assert!(!independent.is_closed());
    manager.shutdown().await;
    assert!(independent.is_closed());
    assert_runtime_empty(root.path());
    #[cfg(unix)]
    for pid in [first_pid, next_pid] {
        assert_eq!(unsafe { libc::kill(-pid, 0) }, -1, "kernel process group survived cleanup");
    }
    println!(
        "VERIFIED startup without user execution, PID/state reuse, runtime rejection and generation isolation; python={python}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires OPENIDEA_TEST_PYTHON with real ipykernel"]
async fn python_start_without_user_execution() {
    real_start(KernelRuntime::python(PathBuf::from(
        std::env::var_os("OPENIDEA_TEST_PYTHON").expect("OPENIDEA_TEST_PYTHON"),
    )))
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires OPENIDE_ARK and R_HOME with real Ark"]
async fn ark_start_without_user_execution() {
    real_start(KernelRuntime::Ark {
        executable: std::env::var_os("OPENIDE_ARK").expect("OPENIDE_ARK").into(),
        r_home: std::env::var_os("R_HOME").expect("R_HOME").into(),
    })
    .await;
}

#[cfg(unix)]
async fn pending_start_cleanup(operation: &str) {
    use std::os::unix::fs::PermissionsExt;
    let root = tempfile::tempdir().unwrap();
    let manager = manager(root.path());
    let notebook = root.path().join("notebook.ipynb");
    let script = root.path().join("waiting-python");
    let pid_file = root.path().join("pid");
    std::fs::write(&script, format!("#!/bin/sh\necho $$ > '{}'\nexec sleep 60\n", pid_file.display())).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let cancel = CancellationToken::new();
    let task_manager = manager.clone();
    let task_notebook = notebook.clone();
    let task_cancel = cancel.clone();
    let task = tokio::spawn(async move {
        task_manager.ensure_started(&task_notebook, &KernelRuntime::python(script), task_cancel).await
    });
    let pid = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(pid) =
                std::fs::read_to_string(&pid_file).ok().and_then(|value| value.trim().parse::<i32>().ok())
            {
                break pid;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("selected process must start");
    match operation {
        "cancel" => cancel.cancel(),
        "close" => manager.shutdown_kernel(&notebook).await.unwrap(),
        "drop" => task.abort(),
        _ => unreachable!(),
    }
    let result = tokio::time::timeout(Duration::from_secs(10), task).await.unwrap();
    if operation == "drop" {
        assert!(result.err().unwrap().is_cancelled());
    } else {
        assert_eq!(result.unwrap().err().unwrap().kind, ErrorKind::Cancelled);
    }
    tokio::time::timeout(Duration::from_secs(5), async {
        while unsafe { libc::kill(-pid, 0) } == 0 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("cancelled startup must reap its process group");
    assert!(manager.comms(&notebook).is_err());
    // An aborted startup leaves a stopped slot until the next admission: it must not be reused as ready.
    let error = manager
        .ensure_started(&notebook, &KernelRuntime::python(root.path().join("missing")), CancellationToken::new())
        .await
        .err()
        .unwrap();
    assert!(error.message.contains("no fallback interpreter"), "{error}");
    manager.shutdown().await;
    assert_runtime_empty(root.path());
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancellation_during_startup_reaps_the_process() {
    pending_start_cleanup("cancel").await;
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn close_during_startup_does_not_publish_a_late_handle() {
    pending_start_cleanup("close").await;
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn dropping_the_startup_future_stops_and_does_not_reuse_the_partial_session() {
    pending_start_cleanup("drop").await;
}
