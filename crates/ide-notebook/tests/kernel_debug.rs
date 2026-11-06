//! Real Jupyter debug acceptance, not a mock transport test.
//! Explicit ignored runs require OPENIDEA_TEST_PYTHON or OPENIDE_ARK + R_HOME.
//! Missing capabilities, unverified breakpoints and unsupported requests fail visibly.
use ide_core::{CancellationToken, error::ErrorKind};
use ide_notebook::kernel::{KernelComms, KernelDebugSubscription, KernelManager, KernelOutput, KernelRuntime};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::timeout;

const WAIT: Duration = Duration::from_secs(30);

// A failed assertion while paused must not leave an execution task owning the kernel.
struct AbortOnDrop(tokio::task::AbortHandle);
impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

async fn request(comms: &KernelComms, command: &str, arguments: Value) -> Value {
    let reply = timeout(WAIT, comms.debug_request(command, arguments, CancellationToken::new()))
        .await
        .expect("debug request timed out")
        .unwrap_or_else(|error| panic!("{command}: {error}"));
    eprintln!("DAP {command}: {reply}");
    assert_eq!(reply["success"], true, "unsupported/failed {command}: {reply}");
    assert_eq!(reply["command"], command);
    reply["body"].clone()
}

async fn event(subscription: &mut KernelDebugSubscription, name: &str) -> Value {
    timeout(WAIT, async {
        loop {
            let event = subscription.recv().await.expect("debug subscription closed");
            assert_eq!(event.generation, subscription.generation());
            eprintln!("DAP event #{}: {}", event.sequence, event.content);
            if event.content["event"] == name {
                return event.content["body"].clone();
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("timed out waiting for {name}"))
}

fn output_text(outputs: &Mutex<Vec<KernelOutput>>) -> String {
    outputs
        .lock()
        .unwrap()
        .iter()
        .map(|output| {
            output.content["text"].as_str().or_else(|| output.content["data"]["text/plain"].as_str()).unwrap_or("")
        })
        .collect()
}

fn pid(text: &str) -> i32 {
    text.lines().find_map(|line| line.strip_prefix("PID=")).expect("PID output").trim().parse().unwrap()
}

async fn frame_and_x(comms: &KernelComms, thread: i64, source: &str, line: u64, expected: &str) -> i64 {
    let stack = request(comms, "stackTrace", json!({"threadId":thread})).await;
    let frame = stack["stackFrames"]
        .as_array()
        .expect("stack frames")
        .iter()
        .find(|frame| {
            // Ark returns a file URI even after pathFormat=path; retain the real source,
            // comparing its properly escaped URI form rather than stripping prefixes.
            frame["source"]["path"] == source
                || frame["source"]["path"] == ide_lsp::path_to_uri_string(Path::new(source))
        })
        .expect("dumped cell frame");
    assert_eq!(frame["line"], line, "DAP coordinates are one-based");
    let id = frame["id"].as_i64().expect("frame id");
    let scopes = request(comms, "scopes", json!({"frameId":id})).await;
    let mut found = false;
    for scope in scopes["scopes"].as_array().expect("scopes") {
        if scope["expensive"] == true {
            continue;
        }
        let variables = request(comms, "variables", json!({"variablesReference":scope["variablesReference"]})).await;
        found |= variables["variables"].as_array().expect("variables").iter().any(|variable| {
            variable["name"] == "x"
                && variable["value"]
                    .as_str()
                    .is_some_and(|value| value == expected || value == format!("[1] {expected}"))
        });
    }
    assert!(found, "paused frame must expose local x={expected}");
    id
}

async fn real_debug(runtime: KernelRuntime) {
    let python = matches!(runtime, KernelRuntime::Python { .. });
    let root = tempfile::tempdir().unwrap();
    let notebook = root.path().join("debug.ipynb");
    std::fs::write(&notebook, "unexecuted notebook sentinel").unwrap();
    let manager = Arc::new(KernelManager::new(root.path().join("runtime"), Arc::new(|_, _, _| {})));
    let comms = manager.ensure_started(&notebook, &runtime, CancellationToken::new()).await.unwrap();
    let capabilities = comms.debug_capabilities().unwrap();
    eprintln!("kernel info: {}", capabilities.kernel_info);
    assert!(capabilities.debugger, "selected kernel did not advertise debugger support");
    let generation = capabilities.generation;
    let mut subscription = comms.debug_subscribe().unwrap();
    assert_eq!(subscription.generation(), generation);
    let info = request(&comms, "debugInfo", json!({})).await;
    assert_eq!(info["isStarted"], !python, "fresh Ark advertises isStarted even before attachment");
    assert!(info["breakpoints"].as_array().unwrap().is_empty());
    assert!(info["stoppedThreads"].as_array().unwrap().is_empty());
    // Subscription is registered before initialize: initialized may precede its reply.
    request(&comms, "initialize", json!({"clientID":"openide-test","adapterID":if python {"python"} else {"r"},"pathFormat":"path","linesStartAt1":true,"columnsStartAt1":true,"supportsVariableType":true})).await;
    let attach_comms = comms.clone();
    let attach = tokio::spawn(async move {
        request(&attach_comms, "attach", json!({"request":"attach","type":"notebook","justMyCode":true})).await
    });
    let _attach_cleanup = AbortOnDrop(attach.abort_handle());
    event(&mut subscription, "initialized").await;
    let definition = if python {
        "def add_one():\n    x = 41\n    x = x + 1\n    return x"
    } else {
        "add_one <- function() {\n  x <- 41\n  x <- x + 1\n  x\n}"
    };
    let dump = request(&comms, "dumpCell", json!({"code":definition})).await;
    let source = dump["sourcePath"].as_str().expect("dumpCell sourcePath").to_owned();
    let breakpoints =
        request(&comms, "setBreakpoints", json!({"source":{"path":source},"breakpoints":[{"line":3}]})).await;
    request(&comms, "configurationDone", json!({})).await;
    timeout(WAIT, attach).await.unwrap().unwrap();
    let defined = manager
        .execute_cell_with_stdin(
            &notebook,
            &runtime,
            "definition",
            definition,
            false,
            CancellationToken::new(),
            Arc::new(|_| {}),
        )
        .await
        .unwrap();
    assert_eq!(defined.status, "ok");
    assert_eq!(defined.execution_count, Some(1), "startup/debug handshake must not execute user cells");
    if !breakpoints["breakpoints"].as_array().expect("breakpoints").iter().any(|bp| bp["verified"] == true) {
        let verified = event(&mut subscription, "breakpoint").await;
        assert_eq!(verified["breakpoint"]["verified"], true, "definition must verify breakpoint");
    }
    let outputs: Arc<Mutex<Vec<KernelOutput>>> = Arc::default();
    let sink = outputs.clone();
    let run_manager = manager.clone();
    let run_path = notebook.clone();
    let run_runtime = runtime.clone();
    let execution = tokio::spawn(async move {
        let call = if python {
            "import os\nprint('PID='+str(os.getpid()), flush=True)\nprint('RESULT='+str(add_one()), flush=True)"
        } else {
            "cat('PID=', Sys.getpid(), '\n', sep=''); cat('RESULT=', add_one(), '\n', sep='')"
        };
        run_manager
            .execute_cell_with_stdin(
                &run_path,
                &run_runtime,
                "call",
                call,
                false,
                CancellationToken::new(),
                Arc::new(move |output| sink.lock().unwrap().push(output)),
            )
            .await
    });
    let _execution_cleanup = AbortOnDrop(execution.abort_handle());
    let stopped = event(&mut subscription, "stopped").await;
    assert!(!execution.is_finished(), "paused cell must keep its shell request pending");
    let thread = stopped["threadId"].as_i64().expect("stopped thread id");
    let threads = request(&comms, "threads", json!({})).await;
    assert!(threads["threads"].as_array().unwrap().iter().any(|item| item["id"] == thread));
    let frame = frame_and_x(&comms, thread, &source, 3, "41").await;
    let watch = request(&comms, "evaluate", json!({"frameId":frame,"expression":"x + 1","context":"watch"})).await;
    assert!(matches!(watch["result"].as_str(), Some("42" | "[1] 42")), "{watch}");
    request(&comms, "next", json!({"threadId":thread})).await;
    event(&mut subscription, "stopped").await;
    assert!(!execution.is_finished());
    let frame = frame_and_x(&comms, thread, &source, 4, "42").await;
    let watch = request(&comms, "evaluate", json!({"frameId":frame,"expression":"x + 1","context":"watch"})).await;
    assert!(matches!(watch["result"].as_str(), Some("43" | "[1] 43")), "{watch}");
    request(&comms, "continue", json!({"threadId":thread})).await;
    let result = timeout(WAIT, execution).await.unwrap().unwrap().unwrap();
    assert_eq!(result.status, "ok");
    assert_eq!(result.execution_count, Some(2));
    let text = output_text(&outputs);
    assert!(text.contains("RESULT=42"), "{text}");
    let before_pid = pid(&text);
    request(&comms, "disconnect", json!({"restart":false,"terminateDebuggee":false})).await;
    assert!(!comms.is_closed(), "disconnect must preserve the kernel");
    outputs.lock().unwrap().clear();
    let sink = outputs.clone();
    let code = if python {
        "print('PID='+str(os.getpid()))\nprint('AFTER='+str(1+1))"
    } else {
        "cat('PID=', Sys.getpid(), '\n', sep=''); cat('AFTER=', 1+1, '\n', sep='')"
    };
    let after = manager
        .execute_cell_with_stdin(
            &notebook,
            &runtime,
            "after",
            code,
            false,
            CancellationToken::new(),
            Arc::new(move |output| sink.lock().unwrap().push(output)),
        )
        .await
        .unwrap();
    assert_eq!(after.status, "ok");
    let text = output_text(&outputs);
    assert_eq!(pid(&text), before_pid);
    assert!(text.contains("AFTER=2"), "{text}");
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert_eq!(comms.debug_request("debugInfo", json!({}), cancel).await.unwrap_err().kind, ErrorKind::Cancelled);
    assert!(!comms.is_closed(), "request cancellation must not shut down a shared kernel");
    manager.restart(&notebook).await.unwrap();
    assert!(comms.debug_request("threads", json!({}), CancellationToken::new()).await.is_err());
    assert!(timeout(WAIT, subscription.recv()).await.unwrap().is_err(), "old subscription must retire");
    let fresh = manager.ensure_started(&notebook, &runtime, CancellationToken::new()).await.unwrap();
    assert_ne!(fresh.debug_capabilities().unwrap().generation, generation);
    assert_eq!(std::fs::read_to_string(&notebook).unwrap(), "unexecuted notebook sentinel");
    manager.shutdown().await;
    assert!(fresh.is_closed());
    eprintln!(
        "VERIFIED real Jupyter debug: python={python}, breakpoint/step/control-while-paused, same-PID disconnect, cancel and stale generation"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires explicit OPENIDEA_TEST_PYTHON with ipykernel + debugpy"]
async fn python_notebook_debug_protocol() {
    let python = PathBuf::from(std::env::var_os("OPENIDEA_TEST_PYTHON").expect("OPENIDEA_TEST_PYTHON"));
    let probe = std::process::Command::new(&python)
        .args(["-c", "import sys,ipykernel,debugpy; print(sys.executable, ipykernel.__version__, debugpy.__version__)"])
        .output()
        .unwrap();
    assert!(
        probe.status.success(),
        "selected runtime lacks debug dependencies: {}",
        String::from_utf8_lossy(&probe.stderr)
    );
    eprintln!("Python/ipykernel/debugpy: {}", String::from_utf8_lossy(&probe.stdout));
    real_debug(KernelRuntime::python(python)).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires explicit OPENIDE_ARK and R_HOME"]
async fn ark_notebook_debug_protocol() {
    let executable = PathBuf::from(std::env::var_os("OPENIDE_ARK").expect("OPENIDE_ARK"));
    let r_home = PathBuf::from(std::env::var_os("R_HOME").expect("R_HOME"));
    let probe = std::process::Command::new(&executable).arg("--version").output().unwrap();
    assert!(probe.status.success());
    eprintln!("Ark: {} R_HOME={}", String::from_utf8_lossy(&probe.stdout), r_home.display());
    real_debug(KernelRuntime::Ark { executable, r_home }).await;
}
