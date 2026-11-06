//! Real kernel acceptance for U6. No mock kernels or substituted responses.
use ide_core::CancellationToken;
use ide_notebook::kernel::{KernelManager, KernelRuntime};
use ide_notebook::session::{SessionData, SessionSnapshot};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

async fn execute(manager: &KernelManager, path: &Path, runtime: &KernelRuntime, code: &str) {
    let result = tokio::time::timeout(
        Duration::from_secs(60),
        manager.execute_runtime(path, runtime, code, CancellationToken::new(), Arc::new(|_| {})),
    )
    .await
    .expect("execution deadline")
    .expect("real execution");
    assert_eq!(result.status, "ok");
}

async fn wait(path: &Path, predicate: impl Fn(&SessionSnapshot) -> bool) -> SessionSnapshot {
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            if let Some(data) = SessionData::for_owner_path(&path.parent().unwrap().join("kernels"), path).unwrap() {
                let snapshot = data.snapshot().unwrap();
                assert!(snapshot.error.is_none(), "adapter error: {:?}", snapshot.error);
                if snapshot.ready && predicate(&snapshot) {
                    return snapshot;
                }
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("real session snapshot deadline")
}

async fn smoke(runtime: KernelRuntime, r: bool) {
    let root = tempfile::tempdir().unwrap();
    let manager = KernelManager::new(root.path().join("kernels"), Arc::new(|_, _, _| {}));
    let first = root.path().join("first.ipynb");
    let second = root.path().join("second.ipynb");
    let (create, change, expected) = if r {
        (
            "shared <- list(answer=41, nested=list(value='R')); plot(1:3, c(1,4,9))",
            "shared <- list(answer=42); only_first <- TRUE",
            "42",
        )
    } else {
        (
            "shared = {'answer': 41, 'nested': {'value': 'Python'}}\nimport matplotlib.pyplot as plt\nplt.plot([1,2,3], [1,4,9]); plt.show()",
            "shared = {'answer': 42}\nonly_first = True",
            "42",
        )
    };
    execute(&manager, &first, &runtime, create).await;
    let snapshot =
        wait(&first, |state| state.variables.iter().any(|v| v.name == "shared") && !state.plots.is_empty()).await;
    let shared = snapshot.variables.iter().find(|v| v.name == "shared").unwrap();
    assert!(shared.has_children);
    assert!(!shared.type_name.is_empty());
    assert!(!shared.summary.is_empty());
    let data = manager.comms(&first).unwrap().session().clone();
    let children = data.inspect(&snapshot.generation, snapshot.revision, vec![shared.key.clone()]).await.unwrap();
    assert!(children.variables.iter().any(|v| v.name.contains("answer") && v.summary.contains("41")), "{children:?}");
    let nested = children.variables.iter().find(|v| v.name.contains("nested")).unwrap();
    let nested = data
        .inspect(&snapshot.generation, snapshot.revision, vec![shared.key.clone(), nested.key.clone()])
        .await
        .unwrap();
    assert!(nested.variables.iter().any(|v| v.summary.contains(if r { "R" } else { "Python" })));
    assert!(snapshot.plots[0].data.len() > 100);
    println!(
        "PASS {} real variables name/type/summary + two-level lazy inspect + plot {} ({} bytes)",
        snapshot.language,
        snapshot.plots[0].mime,
        snapshot.plots[0].data.len()
    );

    execute(
        &manager,
        &second,
        &runtime,
        if r {
            "second_only <- 99; plot(3:1)"
        } else {
            "second_only = 99\nimport matplotlib.pyplot as plt\nplt.plot([3,2,1]); plt.show()"
        },
    )
    .await;
    let second_snapshot =
        wait(&second, |state| state.variables.iter().any(|v| v.name == "second_only") && !state.plots.is_empty()).await;
    assert_ne!(snapshot.generation, second_snapshot.generation);
    assert!(!second_snapshot.variables.iter().any(|v| v.name == "shared"));
    execute(&manager, &first, &runtime, change).await;
    let changed = wait(&first, |state| {
        state.revision != snapshot.revision && state.variables.iter().any(|v| v.name == "only_first")
    })
    .await;
    assert!(data.inspect(&snapshot.generation, snapshot.revision, vec![shared.key.clone()]).await.is_err());
    let children = data.inspect(&changed.generation, changed.revision, vec![shared.key.clone()]).await.unwrap();
    assert!(children.variables.iter().any(|v| v.summary.contains(expected)));
    assert!(
        !manager.comms(&second).unwrap().session().snapshot().unwrap().variables.iter().any(|v| v.name == "only_first")
    );

    execute(&manager, &first, &runtime, if r { "plot(4:6)" } else { "plt.figure(); plt.plot([4,5,6]); plt.show()" })
        .await;
    wait(&first, |state| state.plots.len() >= 2).await;
    manager.restart(&first).await.unwrap();
    assert!(data.snapshot().is_err(), "old generation must be revoked immediately");
    assert!(data.inspect(&changed.generation, changed.revision, vec![shared.key.clone()]).await.is_err());
    let reset = wait(&first, |_| true).await;
    assert_ne!(reset.generation, changed.generation);
    assert!(reset.plots.is_empty());
    assert!(!reset.variables.iter().any(|v| v.name == "shared" || v.name == "only_first"));
    let retained = manager.comms(&second).unwrap().session().snapshot().unwrap();
    assert_eq!(retained.generation, second_snapshot.generation);
    assert!(!retained.plots.is_empty());
    println!(
        "PASS {} dual-session isolation, execution mutation, plot history, stale revision rejection, restart clears only its generation",
        reset.language
    );
    manager.shutdown().await;
    assert!(SessionData::for_owner_path(&root.path().join("kernels"), &first).unwrap().is_none());
    assert!(SessionData::for_owner_path(&root.path().join("kernels"), &second).unwrap().is_none());
    assert_eq!(std::fs::read_dir(root.path().join("kernels")).unwrap().count(), 0, "connection files cleaned");
    println!("VERIFIED {} shutdown revokes both sessions and cleans kernel runtime files", reset.language);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires real ipykernel and matplotlib"]
async fn python_variables_plots_isolation_restart() {
    smoke(KernelRuntime::python(std::env::var_os("OPENIDEA_TEST_PYTHON").expect("OPENIDEA_TEST_PYTHON")), false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires real Ark and R"]
async fn ark_variables_plots_isolation_restart() {
    smoke(
        KernelRuntime::Ark {
            executable: std::env::var_os("OPENIDE_ARK").expect("OPENIDE_ARK").into(),
            r_home: std::env::var_os("R_HOME").expect("R_HOME").into(),
        },
        true,
    )
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires real ipykernel and Ark"]
async fn mixed_language_sessions_do_not_share_variables_or_plots() {
    let root = tempfile::tempdir().unwrap();
    let manager = KernelManager::new(root.path().join("kernels"), Arc::new(|_, _, _| {}));
    let python = root.path().join("python.ipynb");
    let r = root.path().join("r.ipynb");
    let py = KernelRuntime::python(std::env::var_os("OPENIDEA_TEST_PYTHON").unwrap());
    let ark = KernelRuntime::Ark {
        executable: std::env::var_os("OPENIDE_ARK").unwrap().into(),
        r_home: std::env::var_os("R_HOME").unwrap().into(),
    };
    execute(&manager, &python, &py, "only_python = 10").await;
    execute(&manager, &r, &ark, "only_r <- 20; plot(1:3)").await;
    let ps = wait(&python, |s| s.variables.iter().any(|v| v.name == "only_python")).await;
    let rs = wait(&r, |s| s.variables.iter().any(|v| v.name == "only_r") && !s.plots.is_empty()).await;
    assert_ne!(ps.generation, rs.generation);
    assert!(ps.plots.is_empty());
    assert!(!ps.variables.iter().any(|v| v.name == "only_r"));
    assert!(!rs.variables.iter().any(|v| v.name == "only_python"));
    manager.restart(&python).await.unwrap();
    assert_eq!(manager.comms(&r).unwrap().session().snapshot().unwrap().generation, rs.generation);
    manager.shutdown().await;
    println!("VERIFIED simultaneous real Python+Ark: variables, plots, restart and shutdown isolated");
}
