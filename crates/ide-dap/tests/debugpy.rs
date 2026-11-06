//! End-to-end against a real debugpy, using the selected Python environment.
//! Run with `OPENIDEA_TEST_PYTHON=/path/to/python cargo test -p ide-dap --test debugpy -- --ignored`.
//! Explicitly running this ignored test requires debugpy; missing dependencies are failures.

use ide_core::event::DebugEvent;
use ide_core::{IdeEvent, SharedSink};
use ide_dap::{Breakpoint, DebugManager, LaunchConfig, SessionOwner, StepKind};
use ide_language::LanguageRegistry;
use parking_lot::Mutex;
use serde_json::json;
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

async fn wait(events: &Mutex<Vec<IdeEvent>>, pred: impl Fn(&DebugEvent) -> bool) -> DebugEvent {
    for _ in 0..1500 {
        let hit = events.lock().iter().find_map(|e| match e {
            IdeEvent::Debug { event, .. } if pred(event) => Some(event.clone()),
            _ => None,
        });
        if let Some(e) = hit {
            return e;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("timed out; events: {:?}", events.lock());
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires OPENIDEA_TEST_PYTHON (or python3/python on PATH) with debugpy installed"]
async fn debugpy_end_to_end() {
    let python = std::env::var("OPENIDEA_TEST_PYTHON")
        .unwrap_or_else(|_| if cfg!(windows) { "python" } else { "python3" }.into());
    let probe = std::process::Command::new(&python)
        .args([
            "-c",
            "import debugpy, json, sys; print(json.dumps({'python': sys.executable, 'debugpy': debugpy.__version__}))",
        ])
        .output()
        .unwrap_or_else(|e| panic!("cannot run selected Python {python:?}: {e}"));
    assert!(
        probe.status.success(),
        "selected Python {python:?} requires debugpy; install with `{python} -m pip install debugpy`: {}",
        String::from_utf8_lossy(&probe.stderr)
    );
    let runtime: serde_json::Value = serde_json::from_slice(&probe.stdout).expect("Python runtime metadata");
    let selected_python = runtime["python"].as_str().expect("sys.executable");
    eprintln!("debugpy acceptance runtime: {runtime}");
    let dir = tempfile::tempdir().unwrap();
    let cwd = dir.path().canonicalize().unwrap();
    let script = cwd.join("prog.py");
    std::fs::write(&script, "def add_one():\n    x = 41\n    x = x + 1\n    return x\nprint(add_one())\n").unwrap();

    let events: Arc<Mutex<Vec<IdeEvent>>> = Arc::default();
    let sink_events = events.clone();
    let sink: SharedSink = Arc::new(move |e: IdeEvent| sink_events.lock().push(e));
    let manager = DebugManager::new(Arc::new(LanguageRegistry::from_configs(Vec::new())));
    let bp = Breakpoint { line: 2, condition: None, hit_condition: None, log_message: None, enabled: true };
    manager.set_breakpoints(script.clone(), vec![bp]).await.unwrap();
    let id = manager
        .start(
            LaunchConfig {
                name: "Python environment acceptance".into(),
                adapter: "debugpy".into(),
                request: "launch".into(),
                program: Some(script.to_string_lossy().into_owned()),
                args: vec!["--input".into(), "data with spaces.csv".into()],
                cwd: Some(cwd.clone().into()),
                env: BTreeMap::from([("OPENIDE_DEBUG_ACCEPTANCE".into(), "science".into())]),
                extra_json: Some(
                    json!({"python": selected_python, "console": "internalConsole", "justMyCode": true}).to_string(),
                ),
            },
            SessionOwner::new("main", sink),
        )
        .await
        .unwrap();
    let DebugEvent::Stopped { thread_id, .. } = wait(&events, |e| matches!(e, DebugEvent::Stopped { .. })).await else {
        unreachable!()
    };
    let frames = manager.stack_trace(id, thread_id).await.unwrap();
    assert_eq!(frames[0].line, 2, "0-based breakpoint on x = x + 1");
    let frame = frames[0].id;
    let scopes = manager.scopes(id, frame).await.unwrap();
    let vars = manager.variables(id, scopes[0].variables_reference).await.unwrap();
    assert!(vars.iter().any(|v| v.name == "x" && v.value == "41"), "{vars:?}");
    let watch = manager.evaluate_in(id, Some(frame), "x + 1".into(), Some("watch".into())).await.unwrap();
    assert_eq!(watch.value, "42");
    for expression in [
        format!("__import__('sys').executable == {}", json!(selected_python)),
        format!("__import__('os').path.samefile(__import__('os').getcwd(), {})", json!(cwd.to_string_lossy())),
        "__import__('sys').argv[1:] == ['--input', 'data with spaces.csv']".into(),
        "__import__('os').environ['OPENIDE_DEBUG_ACCEPTANCE'] == 'science'".into(),
    ] {
        let result = manager.evaluate(id, Some(frame), expression.clone()).await.unwrap();
        assert_eq!(result.value, "True", "{expression}");
    }
    // Clear the first stop before stepping, so it cannot satisfy the next-stop assertion.
    events.lock().clear();
    manager.step(id, thread_id, StepKind::Over).await.unwrap();
    wait(&events, |e| matches!(e, DebugEvent::Stopped { .. })).await;
    let frames = manager.stack_trace(id, thread_id).await.unwrap();
    assert_eq!(frames[0].line, 3, "step reaches return x");
    let value = manager.evaluate(id, Some(frames[0].id), "x".into()).await.unwrap();
    assert_eq!(value.value, "42");
    manager.set_breakpoints(script, vec![]).await.unwrap();
    manager.resume(id, thread_id).await.unwrap();
    wait(&events, |e| matches!(e, DebugEvent::Output { output, .. } if output.trim() == "42")).await;
    wait(&events, |e| matches!(e, DebugEvent::Terminated)).await;
    assert!(manager.sessions(None).is_empty(), "terminated debug sessions must be removed");
}
