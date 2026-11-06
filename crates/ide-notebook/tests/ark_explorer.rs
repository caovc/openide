//! Real Ark data-explorer smoke for U9.2a.
//! PATH=$HOME/.cargo/bin:/workspace/mamba/envs/r/bin:$PATH \
//! OPENIDE_ARK=/workspace/ark/target/release/ark R_HOME=/workspace/mamba/envs/r/lib/R \
//! cargo test -p ide-notebook --test ark_explorer -- --ignored --nocapture --test-threads=1
use ide_core::CancellationToken;
use ide_notebook::ark_explorer::ArkExplorerBroker;
use ide_notebook::kernel::{KernelManager, KernelRuntime};
use ide_notebook::session::{SessionData, SessionSnapshot};
use serde_json::Value;
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
    assert_eq!(result.status, "ok", "{result:?}");
}

async fn wait(path: &Path, predicate: impl Fn(&SessionSnapshot) -> bool) -> SessionSnapshot {
    tokio::time::timeout(Duration::from_secs(20), async {
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
    .expect("session snapshot deadline")
}

fn cell_code(value: &Value) -> Option<i64> {
    value.as_i64()
}

fn cell_text(value: &Value) -> Option<&str> {
    value.as_str()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires OPENIDE_ARK + R_HOME real kernel"]
async fn ark_view_schema_page_and_restart_rejection() {
    let ark = std::env::var_os("OPENIDE_ARK").expect("OPENIDE_ARK");
    let root = tempfile::tempdir().unwrap();
    let manager = KernelManager::new(root.path().join("kernels"), Arc::new(|_, _, _| {}));
    let notebook = root.path().join("explorer.ipynb");
<<<<<<< Updated upstream
    let runtime =
        KernelRuntime::Ark { executable: ark.into(), r_home: std::env::var_os("R_HOME").expect("R_HOME").into() };
=======
    let runtime = KernelRuntime::Ark {
        executable: ark.into(),
        r_home: std::env::var_os("R_HOME").expect("R_HOME").into(),
    };
>>>>>>> Stashed changes

    // Small data.frame: int/logical/string/double with NA/NaN/Inf and a duplicate name.
    execute(
        &manager,
        &notebook,
        &runtime,
        r#"
df <- data.frame(
  i = c(1L, NA_integer_, 3L),
  l = c(TRUE, FALSE, NA),
  s = c("a", "", NA_character_),
  d = c(1.5, NaN, Inf),
  s_dup = c("dup", "x", "y"),
  neg = c(-Inf, 0, NA_real_),
  check.names = FALSE
)
names(df)[5] <- "s"
"#,
    )
    .await;

    let snapshot = wait(&notebook, |s| s.variables.iter().any(|v| v.name == "df")).await;
    let variable = snapshot.variables.iter().find(|v| v.name == "df").expect("df variable");
    assert!(!variable.key.is_empty(), "opaque access key required");
    println!("PASS discovered opaque key for df type={}", variable.type_name);

    let comms = manager.comms(&notebook).expect("comms");
<<<<<<< Updated upstream
    let broker = ArkExplorerBroker::open(comms.clone(), &variable.key).await.expect("view opens positron.dataExplorer");
=======
    let broker = ArkExplorerBroker::open(comms.clone(), &variable.key)
        .await
        .expect("view opens positron.dataExplorer");
>>>>>>> Stashed changes
    println!(
        "PASS view opened explorer_comm={} title={:?} generation={}",
        broker.explorer_comm(),
        broker.title(),
        broker.generation()
    );

    let state = broker.get_state().await.expect("get_state");
    assert!(state.num_rows >= 3, "rows={:?}", state.raw);
    assert!(state.num_columns >= 5, "cols={:?}", state.raw);
    println!("PASS get_state rows={} cols={}", state.num_rows, state.num_columns);

    let indices: Vec<i64> = (0..state.num_columns.min(6)).collect();
    let schema = broker.get_schema(&indices).await.expect("get_schema");
    assert_eq!(schema.columns.len(), indices.len());
<<<<<<< Updated upstream
    let names: Vec<_> = schema.columns.iter().map(|c| c["column_name"].as_str().unwrap_or("")).collect();
=======
    let names: Vec<_> = schema
        .columns
        .iter()
        .map(|c| c["column_name"].as_str().unwrap_or(""))
        .collect();
>>>>>>> Stashed changes
    assert!(names.contains(&"i") && names.contains(&"l") && names.contains(&"d"), "{names:?}");
    assert_eq!(names.iter().filter(|n| **n == "s").count(), 2, "duplicate name by ordinal: {names:?}");
    println!("PASS get_schema names={names:?}");

<<<<<<< Updated upstream
    let page = broker.get_data_values(&indices, 0, 2).await.expect("get_data_values inclusive 0..=2");
=======
    let page = broker
        .get_data_values(&indices, 0, 2)
        .await
        .expect("get_data_values inclusive 0..=2");
>>>>>>> Stashed changes
    assert_eq!(page.columns.len(), indices.len());
    for col in &page.columns {
        assert_eq!(col.len(), 3, "inclusive three rows: {col:?}");
    }

    // Column i: 1, NA(code 1), 3
    let i_col = &page.columns[0];
    assert_eq!(cell_text(&i_col[0]).or_else(|| i_col[0].as_i64().map(|_| "")), cell_text(&i_col[0]));
<<<<<<< Updated upstream
    assert!(cell_text(&i_col[0]) == Some("1") || i_col[0] == Value::String("1".into()), "int 1 got {:?}", i_col[0]);
=======
    assert!(
        cell_text(&i_col[0]) == Some("1") || i_col[0] == Value::String("1".into()),
        "int 1 got {:?}",
        i_col[0]
    );
>>>>>>> Stashed changes
    assert_eq!(cell_code(&i_col[1]), Some(1), "integer NA -> special code 1, got {:?}", i_col[1]);
    assert!(cell_text(&i_col[2]) == Some("3") || i_col[2] == Value::String("3".into()), "{:?}", i_col[2]);

    // logical: TRUE/FALSE/NA
    let l_idx = names.iter().position(|n| *n == "l").unwrap();
    let l_col = &page.columns[l_idx];
    assert!(cell_text(&l_col[0]).is_some(), "{:?}", l_col[0]);
    assert_eq!(cell_code(&l_col[2]), Some(1), "logical NA -> 1 got {:?}", l_col[2]);

    // string: a, "", NA
    let s_idx = names.iter().position(|n| *n == "s").unwrap();
    let s_col = &page.columns[s_idx];
    assert_eq!(cell_text(&s_col[0]), Some("a"));
    assert_eq!(cell_text(&s_col[1]), Some(""));
    assert_eq!(cell_code(&s_col[2]), Some(1), "character NA -> 1 got {:?}", s_col[2]);

    // double: 1.5, NaN(2), Inf(10)
    let d_idx = names.iter().position(|n| *n == "d").unwrap();
    let d_col = &page.columns[d_idx];
    assert!(cell_text(&d_col[0]).is_some(), "finite double formatted {:?}", d_col[0]);
    assert_eq!(cell_code(&d_col[1]), Some(2), "NaN -> 2 got {:?}", d_col[1]);
    assert_eq!(cell_code(&d_col[2]), Some(10), "Inf -> 10 got {:?}", d_col[2]);

    // -Inf
    let neg_idx = names.iter().position(|n| *n == "neg").unwrap();
    let neg_col = &page.columns[neg_idx];
    assert_eq!(cell_code(&neg_col[0]), Some(11), "-Inf -> 11 got {:?}", neg_col[0]);
    assert_eq!(cell_code(&neg_col[2]), Some(1), "double NA -> 1 got {:?}", neg_col[2]);
    println!("PASS page values NA/NaN/Inf/-Inf codes");

    // Capture wire fixture for TS mapping (real runtime).
    let fixture = serde_json::json!({
        "state": state.raw,
        "schema": schema.raw,
        "page": page.raw,
        "access_key_present": true,
        "column_names": names,
    });
    std::fs::write(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.audit/u9-2-ark-wire.json"),
        serde_json::to_string_pretty(&fixture).unwrap(),
    )
    .ok();

    let old_generation = broker.generation().to_string();
    manager.restart(&notebook).await.expect("restart");
    // Wait until a new generation is ready (variables empty or ready again).
    let _ = wait(&notebook, |s| s.generation != old_generation && s.ready).await;
<<<<<<< Updated upstream
    assert!(broker.get_state().await.is_err(), "old broker must reject after restart/generation change");
=======
    assert!(
        broker.get_state().await.is_err(),
        "old broker must reject after restart/generation change"
    );
>>>>>>> Stashed changes
    println!("PASS restart rejects stale broker generation={old_generation}");
    let _ = broker.close().await;
}
