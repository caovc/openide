//! Real Ark 0.1.252 integration probe. Put the selected R on PATH.
//! OPENIDE_ARK defaults to /workspace/ark/target/release/ark; R_HOME comes from R RHOME.
//! Run with `cargo test -p ide-notebook --test ark_smoke -- --ignored --nocapture`.
#![cfg(unix)]

use jupyter_protocol::{
    CommId, CommOpen, ConnectionInfo, ExecuteRequest, JupyterMessage, KernelInfoRequest, ShutdownRequest,
};
use jupyter_zmq_client::{ClientControlConnection, Connection, DealerSendConnection, RawMessage};
use serde_json::{Value, json};
use std::error::Error;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::{Instant, timeout};
use uuid::Uuid;
use zeromq::SocketRecv;

type Result<T> = std::result::Result<T, Box<dyn Error + Send + Sync>>;
const WAIT: Duration = Duration::from_secs(30);

#[derive(Debug, PartialEq)]
enum Channel {
    Shell,
    Iopub,
}

#[derive(Debug)]
struct Frame {
    channel: Channel,
    parent: String,
    kind: String,
    content: Value,
}

struct Ark {
    child: Child,
    pid: u32,
    owns_group: bool,
    directory: tempfile::TempDir,
}

impl Ark {
    fn spawn(info: &ConnectionInfo) -> Result<Self> {
        let directory = tempfile::Builder::new().prefix("openide-ark-smoke-").tempdir()?;
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700))?;
        let connection = directory.path().join("connection.json");
        std::fs::write(&connection, serde_json::to_vec(info)?)?;
        let ark = std::env::var_os("OPENIDE_ARK").unwrap_or_else(|| "/workspace/ark/target/release/ark".into());
        let version = Command::new(&ark).arg("--version").output()?;
        assert!(version.status.success(), "cannot query Ark version");
        let version = String::from_utf8(version.stdout)?;
        assert_eq!(version.trim(), "Ark 0.1.252", "this probe is pinned to Ark 0.1.252");
        let r_home = Command::new("R").arg("RHOME").output()?;
        assert!(r_home.status.success(), "R RHOME failed; put the selected R on PATH");
        let r_home = String::from_utf8(r_home.stdout)?.trim().to_owned();
        let child = Command::new(ark)
            .args([
                "--connection_file",
                connection.to_str().unwrap(),
                "--session-mode",
                "notebook",
                "--default-repos",
                "none",
                "--log",
            ])
            .arg(directory.path().join("ark.log"))
            .args(["--", "--interactive", "--vanilla"])
            .env("R_HOME", &r_home)
            .current_dir(directory.path())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .process_group(0)
            .spawn()?;
        let pid = child.id();
        println!("{} pid={pid} R_HOME={r_home}", version.trim());
        Ok(Self { child, pid, owns_group: true, directory })
    }

    async fn wait(&mut self) -> Result<()> {
        let status = timeout(Duration::from_secs(10), async {
            loop {
                if let Some(status) = self.child.try_wait()? {
                    return Ok::<_, io::Error>(status);
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await??;
        assert!(status.success(), "Ark exited with {status}");
        // The child owns a private process group. ESRCH proves it has no surviving descendants.
        let alive = unsafe { libc::kill(-(self.pid as i32), 0) };
        assert_eq!(alive, -1, "Ark process group still exists");
        assert_eq!(io::Error::last_os_error().raw_os_error(), Some(libc::ESRCH));
        self.owns_group = false;
        println!("PASS shutdown_reply; Ark pid={} reaped; process group absent (ESRCH)", self.pid);
        Ok(())
    }
}

impl Drop for Ark {
    fn drop(&mut self) {
        if std::thread::panicking()
            && let Ok(log) = std::fs::read_to_string(self.directory.path().join("ark.log"))
        {
            eprintln!("Ark log:\n{log}");
        }
        // Only this probe's process group is signalled, including on assertion failure.
        if self.owns_group {
            unsafe {
                libc::kill(-(self.pid as i32), libc::SIGKILL);
            }
        }
        let _ = self.child.wait();
    }
}

struct Session {
    shell: DealerSendConnection,
    control: ClientControlConnection,
    frames: mpsc::Receiver<Result<Frame>>,
    readers: Vec<JoinHandle<()>>,
}

impl Drop for Session {
    fn drop(&mut self) {
        for reader in &self.readers {
            reader.abort();
        }
    }
}

fn reader<S: SocketRecv + Send + 'static>(
    mut connection: Connection<S>,
    channel: Channel,
    tx: mpsc::Sender<Result<Frame>>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            let result = async {
                let multipart = connection.socket.recv().await?;
                let delimiter = multipart
                    .iter()
                    .position(|part| part.as_ref() == b"<IDS|MSG>")
                    .ok_or("missing Jupyter delimiter")?;
                if multipart.len() < delimiter + 6 {
                    return Err("incomplete Jupyter message".into());
                }
                let raw = RawMessage::from_multipart(multipart, &connection.mac)?;
                let header: Value = serde_json::from_slice(&raw.jparts[0])?;
                let parent: Value = serde_json::from_slice(&raw.jparts[1])?;
                Ok(Frame {
                    channel: match channel {
                        Channel::Shell => Channel::Shell,
                        Channel::Iopub => Channel::Iopub,
                    },
                    parent: parent["msg_id"].as_str().unwrap_or("").into(),
                    kind: header["msg_type"].as_str().ok_or("missing message type")?.into(),
                    content: serde_json::from_slice(&raw.jparts[3])?,
                })
            }
            .await;
            let failed = result.is_err();
            if tx.send(result).await.is_err() || failed {
                break;
            }
        }
    })
}

impl Session {
    async fn connect(info: &ConnectionInfo) -> Result<Self> {
        let id = Uuid::new_v4().to_string();
        let identity = jupyter_zmq_client::peer_identity_for_session(&id)?;
        let (iopub, shell, control) = tokio::try_join!(
            jupyter_zmq_client::create_client_iopub_connection(info, "", &id),
            jupyter_zmq_client::create_client_shell_connection_with_identity(info, &id, identity),
            jupyter_zmq_client::create_client_control_connection(info, &id),
        )?;
        let (shell, shell_recv) = shell.split();
        let (tx, frames) = mpsc::channel(64);
        let readers = vec![reader(iopub, Channel::Iopub, tx.clone()), reader(shell_recv, Channel::Shell, tx)];
        Ok(Self { shell, control, frames, readers })
    }

    async fn send(&mut self, message: impl Into<JupyterMessage>) -> Result<String> {
        let message = message.into();
        let id = message.header.msg_id.clone();
        timeout(WAIT, self.shell.send(message)).await??;
        Ok(id)
    }

    async fn frame(&mut self) -> Result<Frame> {
        self.frames.recv().await.ok_or("Jupyter readers stopped")?
    }

    async fn reply_and_idle(&mut self, id: &str, kind: &str) -> Result<Vec<Frame>> {
        timeout(WAIT, async {
            let mut reply = false;
            let mut idle = false;
            let mut frames = Vec::new();
            while !(reply && idle) {
                let frame = self.frame().await?;
                if frame.parent != id {
                    continue;
                }
                if frame.channel == Channel::Shell && frame.kind == kind {
                    assert_eq!(frame.content["status"], "ok", "{kind}: {:?}", frame.content);
                    reply = true;
                }
                if frame.channel == Channel::Iopub
                    && frame.kind == "status"
                    && frame.content["execution_state"] == "idle"
                {
                    idle = true;
                }
                frames.push(frame);
            }
            Ok(frames)
        })
        .await?
    }

    async fn ready(&mut self) -> Result<()> {
        let deadline = Instant::now() + Duration::from_secs(60);
        loop {
            let id = self.send(KernelInfoRequest {}).await?;
            // A subscriber can miss the initial idle. Only readiness requests are retried.
            if let Ok(result) = timeout(Duration::from_secs(2), self.reply_and_idle(&id, "kernel_info_reply")).await {
                let frames = result?;
                let reply = frames.iter().find(|f| f.kind == "kernel_info_reply").unwrap();
                assert_eq!(reply.content["language_info"]["name"], "R");
                println!("PASS kernel_info_reply + idle; language=R");
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err("Ark readiness timed out after 60s".into());
            }
        }
    }

    async fn lsp_port(&mut self) -> Result<u16> {
        let comm_id = Uuid::new_v4().to_string();
        self.send(CommOpen {
            comm_id: CommId(comm_id.clone()),
            target_name: "positron.lsp".into(),
            data: serde_json::from_value(json!({"ip_address":"127.0.0.1"}))?,
            target_module: None,
        })
        .await?;
        // ServerComm notifications are session-scoped, not tied to an execution parent.
        timeout(WAIT, async {
            loop {
                let frame = self.frame().await?;
                if frame.channel != Channel::Iopub || frame.content["comm_id"] != comm_id {
                    continue;
                }
                if frame.kind == "comm_close" {
                    return Err("Ark rejected LSP comm".into());
                }
                if frame.kind == "comm_msg" && frame.content["data"]["msg_type"] == "server_started" {
                    let port = frame.content["data"]["content"]["port"].as_u64().ok_or("missing LSP port")?;
                    return Ok(u16::try_from(port)?);
                }
            }
        })
        .await?
    }
}

struct Lsp(BufReader<TcpStream>);

impl Lsp {
    async fn send(&mut self, message: Value) -> Result<()> {
        let body = serde_json::to_vec(&message)?;
        self.0.get_mut().write_all(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes()).await?;
        self.0.get_mut().write_all(&body).await?;
        Ok(())
    }

    async fn read(&mut self) -> Result<Value> {
        let mut length = None;
        loop {
            let mut line = String::new();
            if self.0.read_line(&mut line).await? == 0 {
                return Err("LSP EOF".into());
            }
            if line == "\r\n" {
                break;
            }
            if let Some((name, value)) = line.split_once(':')
                && name.eq_ignore_ascii_case("Content-Length")
            {
                length = Some(value.trim().parse::<usize>()?);
            }
        }
        let length = length.ok_or("missing LSP Content-Length")?;
        if length > 8 * 1024 * 1024 {
            return Err("LSP message exceeds 8 MiB".into());
        }
        let mut body = vec![0; length];
        self.0.read_exact(&mut body).await?;
        Ok(serde_json::from_slice(&body)?)
    }

    async fn request(&mut self, id: u32, method: &str, params: Value) -> Result<Value> {
        self.send(json!({"jsonrpc":"2.0", "id":id, "method":method, "params":params})).await?;
        timeout(WAIT, async {
            loop {
                let message = self.read().await?;
                if let Some(method) = message["method"].as_str() {
                    if let Some(id) = message.get("id") {
                        let result = match method {
                            "workspace/configuration" => json!(
                                message["params"]["items"]
                                    .as_array()
                                    .ok_or("invalid configuration request")?
                                    .iter()
                                    .map(|_| Value::Null)
                                    .collect::<Vec<_>>()
                            ),
                            "client/registerCapability" | "window/workDoneProgress/create" => Value::Null,
                            _ => return Err(format!("unsupported LSP server request: {message}").into()),
                        };
                        self.send(json!({"jsonrpc":"2.0", "id":id, "result":result})).await?;
                    }
                } else if message["id"] == id {
                    if message.get("error").is_some() {
                        return Err(format!("LSP error: {message}").into());
                    }
                    return message.get("result").cloned().ok_or_else(|| "missing LSP result".into());
                }
            }
        })
        .await?
    }
}

async fn check_lsp(port: u16, directory: &std::path::Path) -> Result<()> {
    let stream = TcpStream::connect(("127.0.0.1", port)).await?;
    let mut lsp = Lsp(BufReader::new(stream));
    let result = lsp
        .request(
            1,
            "initialize",
            json!({"processId":std::process::id(), "rootUri":null, "capabilities":{}, "workspaceFolders":null}),
        )
        .await?;
    assert_eq!(result["serverInfo"]["name"], "Ark R Kernel");
    assert!(result["capabilities"]["completionProvider"].is_object());
    lsp.send(json!({"jsonrpc":"2.0", "method":"initialized", "params":{}})).await?;
    println!("PASS initialize / initialized; serverInfo={}", result["serverInfo"]);
    let uri = format!("file://{}/smoke.R", directory.display());
    lsp.send(json!({"jsonrpc":"2.0", "method":"textDocument/didOpen", "params":{"textDocument":{"uri":uri,"languageId":"r","version":1,"text":"openide_smoke <- 42\nopenide_sm\n"}}})).await?;
    let result = lsp
        .request(
            2,
            "textDocument/completion",
            json!({"textDocument":{"uri":uri}, "position":{"line":1,"character":10}}),
        )
        .await?;
    let items = result.as_array().or_else(|| result["items"].as_array()).ok_or("expected completion list")?;
    let item = items
        .iter()
        .find(|item| item["label"] == "openide_smoke")
        .ok_or_else(|| format!("didOpen variable absent in completion: {result}"))?;
    println!("PASS didOpen / completion; item={item}");
    lsp.send(json!({"jsonrpc":"2.0", "method":"textDocument/didClose", "params":{"textDocument":{"uri":uri}}})).await?;
    drop(lsp);
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires real Ark 0.1.252 and R on PATH"]
async fn ark_headless() -> Result<()> {
    let ip = "127.0.0.1".parse()?;
    let (ports, listeners) = jupyter_zmq_client::peek_ports_with_listeners(ip, 5).await?;
    let info = ConnectionInfo {
        transport: jupyter_protocol::connection_info::Transport::TCP,
        ip: ip.to_string(),
        stdin_port: ports[0],
        control_port: ports[1],
        hb_port: ports[2],
        shell_port: ports[3],
        iopub_port: ports[4],
        signature_scheme: "hmac-sha256".into(),
        key: Uuid::new_v4().to_string(),
        kernel_name: Some("ark".into()),
    };
    drop(listeners);
    let mut ark = Ark::spawn(&info)?;
    let outcome = timeout(Duration::from_secs(150), async {
        let mut session = Session::connect(&info).await?;
        session.ready().await?;
        let mut execute = ExecuteRequest::new("x <- 41; x + 1".into());
        execute.allow_stdin = false;
        let id = session.send(execute).await?;
        let frames = session.reply_and_idle(&id, "execute_reply").await?;
        let output: Vec<_> = frames
            .iter()
            .filter(|f| {
                f.channel == Channel::Iopub && matches!(f.kind.as_str(), "execute_result" | "display_data" | "stream")
            })
            .map(|f| f.content.clone())
            .collect();
        assert!(
            output.iter().any(|v| v["data"]["text/plain"]
                .as_str()
                .or_else(|| v["text"].as_str())
                .is_some_and(|text| text.trim() == "[1] 42")),
            "expected R result 42, got {output:?}"
        );
        println!("PASS execute_reply status=ok + idle; output={}", json!(output));
        let port = session.lsp_port().await?;
        println!("PASS comm positron.lsp server_started port={port}");
        check_lsp(port, ark.directory.path()).await?;
        timeout(WAIT, session.control.send(ShutdownRequest { restart: false }.into())).await??;
        let reply = timeout(WAIT, session.control.read()).await??;
        assert_eq!(reply.header.msg_type, "shutdown_reply");
        ark.wait().await?;
        Ok::<_, Box<dyn Error + Send + Sync>>(())
    })
    .await;
    match outcome {
        Ok(Ok(())) => {
            println!("VERIFIED Ark headless smoke");
            Ok(())
        }
        error => {
            eprintln!(
                "Ark log:\n{}",
                std::fs::read_to_string(ark.directory.path().join("ark.log")).unwrap_or_default()
            );
            match error {
                Ok(Err(error)) => Err(error),
                Err(error) => Err(error.into()),
                _ => unreachable!(),
            }
        }
    }
}

/// U2: the same execution/LSP/reaping contract through the product manager.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires real Ark 0.1.252 and R on PATH"]
async fn ark_product_runtime() -> Result<()> {
    use ide_core::CancellationToken;
    use ide_notebook::kernel::{KernelManager, KernelRuntime};
    use std::sync::{Arc, Mutex};
    let root = tempfile::tempdir()?;
    let notebook = root.path().join("product.ipynb");
    let ark = std::env::var_os("OPENIDE_ARK").unwrap_or_else(|| "/workspace/ark/target/release/ark".into());
    let version = Command::new(&ark).arg("--version").output()?;
    assert!(version.status.success());
    assert_eq!(String::from_utf8(version.stdout)?.trim(), "Ark 0.1.252");
    let home = Command::new("R").arg("RHOME").output()?;
    assert!(home.status.success());
    let runtime = KernelRuntime::Ark { executable: ark.into(), r_home: String::from_utf8(home.stdout)?.trim().into() };
    let manager = KernelManager::new(root.path().join("runtime"), Arc::new(|_, _, _| {}));
    let outputs = Arc::new(Mutex::new(Vec::new()));
    let sink = outputs.clone();
    let mut pid = None;
    let outcome = timeout(Duration::from_secs(150), async {
        let result = manager
            .execute_runtime(
                &notebook,
                &runtime,
                "cat('OPENIDE_PID=', Sys.getpid(), '\n', sep=''); x <- 41; x + 1",
                CancellationToken::new(),
                Arc::new(move |o| sink.lock().unwrap().push(o)),
            )
            .await?;
        assert_eq!(result.status, "ok");
        let text: String = outputs
            .lock()
            .unwrap()
            .iter()
            .filter_map(|o| o.content["text"].as_str().or_else(|| o.content["data"]["text/plain"].as_str()))
            .collect();
        assert!(text.contains("[1] 42"), "expected R 42, got {text}");
        let value = text.split("OPENIDE_PID=").nth(1).ok_or("missing R pid")?;
        pid = Some(value.lines().next().ok_or("missing pid line")?.trim().parse::<i32>()?);
        println!("PASS product Ark execution 42; pid={pid:?}");
        let comms = manager.comms(&notebook)?;
        let mut events = comms.subscribe();
        let id = Uuid::new_v4().to_string();
        comms.open(&id, "positron.lsp", json!({"ip_address":"127.0.0.1"})).await?;
        let port = timeout(WAIT, async {
            loop {
                let event = events.recv().await?;
                if event.comm_id != id {
                    continue;
                }
                assert_ne!(event.kind, "comm_close", "Ark rejected LSP comm");
                if event.kind == "comm_msg" && event.content["data"]["msg_type"] == "server_started" {
                    return Ok::<_, Box<dyn Error + Send + Sync>>(u16::try_from(
                        event.content["data"]["content"]["port"].as_u64().ok_or("missing LSP port")?,
                    )?);
                }
            }
        })
        .await??;
        check_lsp(port, root.path()).await?;
        assert!(outputs.lock().unwrap().iter().all(|o| !o.kind.starts_with("comm_")));
        manager.shutdown_kernel(&notebook).await?;
        assert!(comms.is_closed());
        assert!(events.recv().await.is_err());
        assert!(comms.send_message(&id, json!({})).await.is_err());
        assert!(manager.comms(&notebook).is_err());
        Ok::<_, Box<dyn Error + Send + Sync>>(())
    })
    .await;
    manager.shutdown().await;
    if let Some(pid) = pid {
        assert_eq!(unsafe { libc::kill(-pid, 0) }, -1, "Ark process group survived shutdown");
        assert_eq!(io::Error::last_os_error().raw_os_error(), Some(libc::ESRCH));
    }
    assert_eq!(std::fs::read_dir(root.path().join("runtime"))?.count(), 0);
    outcome??;
    println!("VERIFIED product Ark runtime + session LSP comm + process group absent");
    Ok(())
}

/// U4: the product bridge, with a symbol available ONLY in the execution session.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires real Ark 0.1.252 and R on PATH"]
async fn ark_session_lsp_bridge() -> Result<()> {
    use ide_core::{CancellationToken, Pos};
    use ide_lsp::session::{SessionFeature, SessionReply};
    use ide_notebook::kernel::{KernelManager, KernelRuntime};
    use std::sync::{Arc, Mutex};
    let root = tempfile::tempdir()?;
    let notebook = root.path().join("session.ipynb");
    let runtime = KernelRuntime::Ark {
        executable: std::env::var_os("OPENIDE_ARK")
            .unwrap_or_else(|| "/workspace/ark/target/release/ark".into())
            .into(),
        r_home: std::env::var_os("R_HOME").ok_or("R_HOME is required")?.into(),
    };
    let manager = KernelManager::new(root.path().join("runtime"), Arc::new(|_, _, _| {}));
    let outputs = Arc::new(Mutex::new(String::new()));
    let sink = outputs.clone();
    let outcome = timeout(Duration::from_secs(150), async {
        manager.execute_runtime(&notebook, &runtime,
            "cat('OPENIDE_PID=', Sys.getpid(), '\n', sep=''); openide_session_only <- function(z) z + 41; openide_session_only(1)",
            CancellationToken::new(), Arc::new(move |o| {
                if let Some(text) = o.content["text"].as_str().or_else(|| o.content["data"]["text/plain"].as_str()) { sink.lock().unwrap().push_str(text); }
            })).await?;
        assert!(outputs.lock().unwrap().contains("[1] 42"));
        let comms = manager.comms(&notebook)?;
        let lsp = comms.ark_lsp().await?;
        assert!(std::ptr::eq(lsp, comms.ark_lsp().await?), "one connection per generation");
        let path = root.path().join("cell.R");
        let text = "openide_session_on\nmean(1)\n";
        std::fs::write(&path, text)?;
        let uri = ide_lsp::path_to_uri_string(&path);
        let result = lsp.query(&uri, text, Pos::new(0, 18), SessionFeature::Completion, CancellationToken::new()).await?;
        let SessionReply::Completion { items } = result else { panic!("expected completions") };
        assert!(items.iter().any(|item| item.label == "openide_session_only"), "execution-only symbol absent: {items:?}");
        println!("PASS bridge .R completion contains execution-only openide_session_only; same Ark pid/session");
        let hover = lsp.query(&uri, text, Pos::new(1, 2), SessionFeature::Hover, CancellationToken::new()).await?;
        let SessionReply::Hover { text: Some(hover) } = hover else { panic!("expected mean hover") };
        assert!(!hover.is_empty());
        println!("PASS bridge .R hover: {}", hover.chars().take(160).collect::<String>());
        let changed = "openide_document_only <- 1\nopenide_document_on\n";
        let result = lsp.query(&uri, changed, Pos::new(1, 19), SessionFeature::Completion, CancellationToken::new()).await?;
        let SessionReply::Completion { items } = result else { panic!("expected changed completions") };
        assert!(items.iter().any(|item| item.label == "openide_document_only"));
        println!("PASS bridge didChange completion reflects new cell source");
        manager.restart(&notebook).await?;
        assert!(comms.is_closed());
        assert!(lsp.query(&uri, text, Pos::new(0, 18), SessionFeature::Completion, CancellationToken::new()).await.is_err());
        let next = manager.comms(&notebook)?;
        let result = next.ark_lsp().await?.query(&uri, text, Pos::new(0, 18), SessionFeature::Completion, CancellationToken::new()).await?;
        let SessionReply::Completion { items } = result else { panic!("expected restarted completions") };
        assert!(!items.iter().any(|item| item.label == "openide_session_only"), "old execution state leaked into replacement kernel");
        println!("PASS restart revokes old bridge; new generation has no old execution symbol");
        let sink = outputs.clone();
        manager.execute_runtime(&notebook, &runtime, "cat('OPENIDE_PID=', Sys.getpid(), '\n', sep='')", CancellationToken::new(), Arc::new(move |o| {
            if let Some(text) = o.content["text"].as_str() { sink.lock().unwrap().push_str(text); }
        })).await?;
        manager.shutdown_kernel(&notebook).await?;
        assert!(next.is_closed());
        assert!(next.ark_lsp().await.is_err());
        Ok::<_, Box<dyn Error + Send + Sync>>(())
    }).await;
    manager.shutdown().await;
    let text = outputs.lock().unwrap().clone();
    let pids: Vec<i32> = text
        .split("OPENIDE_PID=")
        .skip(1)
        .filter_map(|s| s.lines().next())
        .filter_map(|s| s.trim().parse().ok())
        .collect();
    for pid in &pids {
        assert_eq!(unsafe { libc::kill(-*pid, 0) }, -1, "Ark process group survived");
        assert_eq!(io::Error::last_os_error().raw_os_error(), Some(libc::ESRCH));
        println!("PASS Ark pid={pid} process group absent (ESRCH)");
    }
    if matches!(&outcome, Ok(Ok(()))) {
        assert_eq!(pids.len(), 2, "must check both execution generations");
    }
    assert_eq!(std::fs::read_dir(root.path().join("runtime"))?.count(), 0);
    outcome??;
    println!("VERIFIED U4 product session LSP bridge; shutdown cleaned runtime files and Ark process group");
    Ok(())
}

/// U5: real session DAP and opt-in stdin, using product transports throughout.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires real Ark and R_HOME"]
async fn ark_dap_and_stdin() -> Result<()> {
    use ide_core::CancellationToken;
    use ide_notebook::kernel::{KernelManager, KernelRuntime};
    use std::sync::{Arc, Mutex};
    let root = tempfile::tempdir()?;
    let notebook = root.path().join("debug.ipynb");
    let runtime = KernelRuntime::Ark {
        executable: std::env::var_os("OPENIDE_ARK")
            .unwrap_or_else(|| "/workspace/ark/target/release/ark".into())
            .into(),
        r_home: std::env::var_os("R_HOME").ok_or("R_HOME is required")?.into(),
    };
    let manager = Arc::new(KernelManager::new(root.path().join("runtime"), Arc::new(|_, _, _| {})));
    let outputs = Arc::new(Mutex::new(String::new()));
    let sink = outputs.clone();
    let outcome = timeout(Duration::from_secs(150), async {
        manager
            .execute_runtime(
                &notebook,
                &runtime,
                "cat('OPENIDE_PID=', Sys.getpid(), '\n', sep='')",
                CancellationToken::new(),
                Arc::new(move |o| {
                    if let Some(text) = o.content["text"].as_str() {
                        sink.lock().unwrap().push_str(text);
                    }
                }),
            )
            .await?;
        let comms = manager.comms(&notebook)?;
        let dap = comms.ark_dap().await?;
        assert!(std::ptr::eq(dap, comms.ark_dap().await?));
        let mut events = dap.subscribe();
        let source = root.path().join("debug.R");
        std::fs::write(&source, "u5 <- function() {\n  x <- 41\n  x <- x + 1\n  x\n}\nu5()\n")?;
        let bp = dap
            .request(
                "setBreakpoints",
                json!({"source":{"path":source},"breakpoints":[{"line":3}]}),
                CancellationToken::new(),
            )
            .await?;
        println!("PASS DAP initialize/attach; setBreakpoints={bp}");
        let run = {
            let manager = manager.clone();
            let notebook = notebook.clone();
            let runtime = runtime.clone();
            let code = format!("source('{}')", source.display());
            tokio::spawn(async move {
                manager.execute_runtime(&notebook, &runtime, &code, CancellationToken::new(), Arc::new(|_| {})).await
            })
        };
        async fn stopped(events: &mut ide_dap::session_dap::DapSubscription) -> Result<Value> {
            timeout(WAIT, async {
                loop {
                    let (kind, body) = events.recv().await?;
                    println!("DAP event {kind}: {body}");
                    if kind == "stopped" {
                        return Ok(body);
                    }
                }
            })
            .await?
        }
        let stop = stopped(&mut events).await?;
        let thread = stop["threadId"].as_i64().ok_or("missing thread")?;
        let stack = dap.request("stackTrace", json!({"threadId":thread}), CancellationToken::new()).await?;
        println!("PASS breakpoint stackTrace={stack}");
        assert_eq!(stack["stackFrames"][0]["line"], 3);
        let frame = stack["stackFrames"][0]["id"].as_i64().ok_or("missing frame")?;
        let scopes = dap.request("scopes", json!({"frameId":frame}), CancellationToken::new()).await?;
        let reference = scopes["scopes"][0]["variablesReference"].as_i64().ok_or("missing scope")?;
        let variables =
            dap.request("variables", json!({"variablesReference":reference}), CancellationToken::new()).await?;
        println!("PASS scopes/variables={variables}");
        assert!(
            variables["variables"]
                .as_array()
                .ok_or("missing variables")?
                .iter()
                .any(|v| v["name"] == "x" && v["value"].as_str().is_some_and(|v| v.contains("41")))
        );
        let value = dap
            .request(
                "evaluate",
                json!({"expression":"x + 1", "frameId":frame, "context":"watch"}),
                CancellationToken::new(),
            )
            .await?;
        assert!(value["result"].as_str().is_some_and(|s| s.contains("42")), "{value}");
        println!("PASS evaluate x+1={value}");
        dap.request("next", json!({"threadId":thread}), CancellationToken::new()).await?;
        stopped(&mut events).await?;
        let stack = dap.request("stackTrace", json!({"threadId":thread}), CancellationToken::new()).await?;
        assert_eq!(stack["stackFrames"][0]["line"], 4);
        println!("PASS next advanced line 3 -> 4");
        dap.request("continue", json!({"threadId":thread}), CancellationToken::new()).await?;
        assert_eq!(timeout(WAIT, run).await???.status, "ok");
        let (tx, mut input) = mpsc::unbounded_channel();
        let run = {
            let manager = manager.clone();
            let notebook = notebook.clone();
            let runtime = runtime.clone();
            tokio::spawn(async move {
                manager
                    .execute_with_stdin(
                        &notebook,
                        &runtime,
                        "paste0(readline('U5 prompt>'), '-ok')",
                        true,
                        CancellationToken::new(),
                        Arc::new(move |o| {
                            let _ = tx.send(o);
                        }),
                    )
                    .await
            })
        };
        let prompt = timeout(WAIT, async {
            loop {
                let o = input.recv().await.ok_or("closed output")?;
                if o.kind == "input_request" {
                    return Ok::<_, Box<dyn Error + Send + Sync>>(o);
                }
            }
        })
        .await??;
        assert_eq!(prompt.content["prompt"], "U5 prompt>");
        let id = prompt.content["requestId"].as_str().ok_or("no prompt id")?.to_owned();
        comms.input_reply("wrong-id".into(), Some("bad".into())).await.expect_err("stale prompt accepted");
        comms.input_reply(id.clone(), Some("answer".into())).await?;
        assert_eq!(timeout(WAIT, run).await???.status, "ok");
        let mut text = String::new();
        while let Some(o) = input.recv().await {
            if let Some(s) = o.content["data"]["text/plain"].as_str() {
                text.push_str(s);
            }
        }
        assert!(text.contains("answer-ok"), "{text}");
        assert!(comms.input_reply(id, Some("duplicate".into())).await.is_err());
        println!("PASS stdin request/reply; R result={text}; stale+duplicate rejected");
        let (tx, mut input) = mpsc::unbounded_channel();
        let run = {
            let manager = manager.clone();
            let notebook = notebook.clone();
            let runtime = runtime.clone();
            tokio::spawn(async move {
                manager
                    .execute_with_stdin(
                        &notebook,
                        &runtime,
                        "readline('cancel>')",
                        true,
                        CancellationToken::new(),
                        Arc::new(move |o| {
                            let _ = tx.send(o);
                        }),
                    )
                    .await
            })
        };
        let id = timeout(WAIT, async {
            loop {
                let o = input.recv().await.ok_or("closed output")?;
                if o.kind == "input_request" {
                    return Ok::<_, Box<dyn Error + Send + Sync>>(
                        o.content["requestId"].as_str().ok_or("no prompt id")?.to_owned(),
                    );
                }
            }
        })
        .await??;
        comms.input_reply(id.clone(), None).await?;
        assert!(timeout(Duration::from_secs(10), run).await??.is_err());
        assert!(comms.input_reply(id, Some("late".into())).await.is_err());
        println!("PASS stdin cancellation drains or stops generation; late reply rejected");
        manager.shutdown_kernel(&notebook).await?;
        assert!(comms.is_closed());
        assert!(dap.request("threads", json!({}), CancellationToken::new()).await.is_err());
        assert!(comms.input_reply("late".into(), None).await.is_err());
        println!("PASS stop revokes DAP and stdin handles");
        Ok::<_, Box<dyn Error + Send + Sync>>(())
    })
    .await;
    manager.shutdown().await;
    for pid in outputs
        .lock()
        .unwrap()
        .split("OPENIDE_PID=")
        .skip(1)
        .filter_map(|s| s.lines().next())
        .map(|s| s.trim().parse::<i32>().unwrap())
    {
        assert_eq!(unsafe { libc::kill(-pid, 0) }, -1, "Ark group survived");
        assert_eq!(io::Error::last_os_error().raw_os_error(), Some(libc::ESRCH));
        println!("PASS Ark pid={pid} process group absent (ESRCH)");
    }
    assert_eq!(std::fs::read_dir(root.path().join("runtime"))?.count(), 0);
    outcome??;
    println!("VERIFIED U5 product DAP + stdin");
    Ok(())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires real Ark and R_HOME"]
async fn ark_stop_pending_stdin_and_debug() -> Result<()> {
    use ide_core::CancellationToken;
    use ide_notebook::kernel::{KernelManager, KernelRuntime};
    use std::sync::{Arc, Mutex};
    let root = tempfile::tempdir()?;
    let notebook = root.path().join("pending.ipynb");
    let runtime = KernelRuntime::Ark {
        executable: std::env::var_os("OPENIDE_ARK")
            .unwrap_or_else(|| "/workspace/ark/target/release/ark".into())
            .into(),
        r_home: std::env::var_os("R_HOME").ok_or("R_HOME required")?.into(),
    };
    let manager = Arc::new(KernelManager::new(root.path().join("runtime"), Arc::new(|_, _, _| {})));
    let pids = Arc::new(Mutex::new(String::new()));
    let outcome = timeout(Duration::from_secs(100), async {
        for debug in [false, true] {
            let sink = pids.clone();
            manager
                .execute_runtime(
                    &notebook,
                    &runtime,
                    "cat('OPENIDE_PID=', Sys.getpid(), '\n', sep='')",
                    CancellationToken::new(),
                    Arc::new(move |o| {
                        if let Some(s) = o.content["text"].as_str() {
                            sink.lock().unwrap().push_str(s);
                        }
                    }),
                )
                .await?;
            let comms = manager.comms(&notebook)?;
            let dap = comms.ark_dap().await?;
            let mut events = dap.subscribe();
            let (send, mut outputs) = mpsc::unbounded_channel();
            let run = {
                let manager = manager.clone();
                let notebook = notebook.clone();
                let runtime = runtime.clone();
                let code =
                    if debug { "stopper <- function() { browser(); 1 }; stopper()" } else { "readline('pending>')" };
                tokio::spawn(async move {
                    manager
                        .execute_with_stdin(
                            &notebook,
                            &runtime,
                            code,
                            true,
                            CancellationToken::new(),
                            Arc::new(move |o| {
                                let _ = send.send(o);
                            }),
                        )
                        .await
                })
            };
            let prompt = if debug {
                timeout(WAIT, async {
                    loop {
                        let (kind, _) = events.recv().await?;
                        if kind == "stopped" {
                            break Ok::<_, Box<dyn Error + Send + Sync>>(());
                        }
                    }
                })
                .await??;
                None
            } else {
                Some(
                    timeout(WAIT, async {
                        loop {
                            let output = outputs.recv().await.ok_or("output closed")?;
                            if output.kind == "input_request" {
                                break Ok::<_, Box<dyn Error + Send + Sync>>(
                                    output.content["requestId"].as_str().ok_or("no prompt id")?.to_owned(),
                                );
                            }
                        }
                    })
                    .await??,
                )
            };
            if debug {
                manager.shutdown_kernel(&notebook).await?;
            } else {
                manager.restart(&notebook).await?;
            }
            assert!(timeout(Duration::from_secs(10), run).await??.is_err(), "pending execution survived stop/restart");
            assert!(comms.is_closed());
            assert!(timeout(Duration::from_secs(2), events.recv()).await?.is_err());
            assert!(dap.request("threads", json!({}), CancellationToken::new()).await.is_err());
            if let Some(prompt) = prompt {
                assert!(comms.input_reply(prompt, Some("late".into())).await.is_err());
            }
            println!(
                "PASS {} while pending {}; old DAP subscription/request and stdin replies revoked",
                if debug { "stop" } else { "restart" },
                if debug { "debug stop" } else { "stdin prompt" }
            );
        }
        Ok::<_, Box<dyn Error + Send + Sync>>(())
    })
    .await;
    manager.shutdown().await;
    let pids: Vec<i32> = pids
        .lock()
        .unwrap()
        .split("OPENIDE_PID=")
        .skip(1)
        .filter_map(|s| s.lines().next())
        .map(|s| s.trim().parse().unwrap())
        .collect();
    for pid in &pids {
        assert_eq!(unsafe { libc::kill(-*pid, 0) }, -1);
        assert_eq!(io::Error::last_os_error().raw_os_error(), Some(libc::ESRCH));
        println!("PASS pending-stop Ark pid={pid} process group absent (ESRCH)");
    }
    outcome??;
    assert_eq!(pids.len(), 2);
    assert_eq!(std::fs::read_dir(root.path().join("runtime"))?.count(), 0);
    Ok(())
}
