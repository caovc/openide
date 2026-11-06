use super::comm::{CommRequest, InputReplyRequest};
use super::process::Process;
use super::{
    CommEvent, ExecutionResult, KernelComms, KernelOutput, KernelRuntime, KernelState, OutputCallback, StatusCallback,
};
use ide_core::{CancellationToken, IdeError, IdeResult};
use jupyter_protocol::{ExecuteRequest, JupyterMessage, KernelInfoRequest, ShutdownRequest};
use jupyter_zmq_client::{ClientControlConnection, Connection, DealerSendConnection, RawMessage};
use parking_lot::Mutex;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::sync::{OwnedSemaphorePermit, Semaphore, broadcast, mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio::time::{Instant, MissedTickBehavior};
use uuid::Uuid;
use zeromq::SocketRecv;

const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const INTERRUPT_TIMEOUT: Duration = Duration::from_secs(5);
const SEND_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_MESSAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 32 * 1024 * 1024;
const MAX_OUTPUT_MESSAGES: usize = 10_000;
const QUEUED_MESSAGES: usize = 64;
const QUEUED_BYTES: usize = 16 * 1024 * 1024;

struct Admission(Arc<AtomicBool>);
impl Drop for Admission {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

struct Execution {
    code: String,
    allow_stdin: bool,
    cancel: CancellationToken,
    interrupt: CancellationToken,
    output: OutputCallback,
    reply: oneshot::Sender<IdeResult<ExecutionResult>>,
    _admission: Admission,
}

pub(super) struct Running {
    pub runtime: KernelRuntime,
    pub comms: KernelComms,
    pub stop: CancellationToken,
    requests: mpsc::Sender<Execution>,
    task: Option<JoinHandle<()>>,
    busy: Arc<AtomicBool>,
}

impl Running {
    pub fn spawn(
        runtime: PathBuf,
        notebook: PathBuf,
        selected: KernelRuntime,
        status: StatusCallback,
    ) -> (Self, oneshot::Receiver<IdeResult<()>>) {
        let stop = CancellationToken::new();
        let (requests, receiver) = mpsc::channel(1);
        let (ready, ready_rx) = oneshot::channel();
        let (comm_tx, comm_rx) = mpsc::channel(16);
        let (events, _) = broadcast::channel(16);
        let (input, input_rx) = mpsc::channel(8);
        let session_data = crate::session::SessionData::new(
            runtime.clone(),
            notebook.clone(),
            &selected,
            stop.clone(),
            comm_tx.clone(),
        );
        let comms = KernelComms {
            session: session_data.clone(),
            requests: comm_tx,
            events: events.clone(),
            stop: stop.clone(),
            runtime: selected.clone(),
            lsp: Default::default(),
            dap: Default::default(),
            input,
        };
        let task = tokio::spawn(supervise(
            runtime,
            notebook,
            selected.clone(),
            status,
            stop.clone(),
            receiver,
            SessionChannels { ready, comm_requests: comm_rx, comm_events: events, input: input_rx, session_data },
        ));
        (
            Self { runtime: selected, comms, stop, requests, task: Some(task), busy: Arc::new(AtomicBool::new(false)) },
            ready_rx,
        )
    }

    pub fn is_finished(&self) -> bool {
        self.task.as_ref().is_none_or(JoinHandle::is_finished)
    }

    pub async fn execute(
        &self,
        code: &str,
        allow_stdin: bool,
        cancel: CancellationToken,
        interrupt: CancellationToken,
        output: OutputCallback,
    ) -> IdeResult<ExecutionResult> {
        if self.busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
            return Err(IdeError::unavailable("previous kernel execution has not drained"));
        }
        let (reply, result) = oneshot::channel();
        let execution = Execution {
            code: code.to_owned(),
            allow_stdin,
            cancel,
            interrupt,
            output,
            reply,
            _admission: Admission(self.busy.clone()),
        };
        self.requests.try_send(execution).map_err(|_| IdeError::unavailable("kernel is busy or has exited"))?;
        result.await.unwrap_or_else(|_| Err(IdeError::unavailable("kernel execution task ended")))
    }

    pub async fn shutdown(mut self) {
        self.stop.cancel();
        if let Some(mut task) = self.task.take()
            && tokio::time::timeout(Duration::from_secs(8), &mut task).await.is_err()
        {
            task.abort();
            let _ = task.await;
        }
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        self.stop.cancel();
        // Do not abort: supervisor owns graceful shutdown and process reaping.
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Channel {
    Stdin,
    Shell,
    Iopub,
}

struct Frame {
    channel: Channel,
    parent: String,
    kind: String,
    content: Value,
    bytes: usize,
    _permit: Option<OwnedSemaphorePermit>,
}

#[derive(Clone)]
struct Failure {
    token: CancellationToken,
    error: Arc<Mutex<Option<IdeError>>>,
}
impl Failure {
    fn new() -> Self {
        Self { token: CancellationToken::new(), error: Arc::new(Mutex::new(None)) }
    }
    fn fail(&self, error: IdeError) {
        self.error.lock().get_or_insert(error);
        self.token.cancel();
    }
    fn error(&self) -> IdeError {
        self.error.lock().clone().unwrap_or_else(|| IdeError::unavailable("kernel reader stopped"))
    }
}

struct Readers(Vec<JoinHandle<()>>);
impl Drop for Readers {
    fn drop(&mut self) {
        for task in &self.0 {
            task.abort();
        }
    }
}

fn reader<S: SocketRecv + Send + 'static>(
    mut connection: Connection<S>,
    channel: Channel,
    tx: mpsc::Sender<Frame>,
    failure: Failure,
    queued: Arc<Semaphore>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            let result = receive(&mut connection, channel, &queued).await;
            match result {
                Ok(frame) => {
                    if tx.try_send(frame).is_err() {
                        failure.fail(IdeError::unavailable(
                            "kernel output queue overflow; execution stopped to bound memory",
                        ));
                        break;
                    }
                }
                Err(error) => {
                    failure.fail(error);
                    break;
                }
            }
        }
    })
}

async fn receive<S: SocketRecv + Send>(
    connection: &mut Connection<S>,
    channel: Channel,
    queued: &Arc<Semaphore>,
) -> IdeResult<Frame> {
    let multipart = connection.socket.recv().await.map_err(protocol)?;
    let bytes = multipart
        .iter()
        .try_fold(0_usize, |sum, part| sum.checked_add(part.len()))
        .ok_or_else(|| IdeError::unavailable("kernel message size overflow"))?;
    if bytes > MAX_MESSAGE_BYTES {
        return Err(IdeError::unavailable("kernel message exceeds 8 MiB limit; execution stopped"));
    }
    let permit = queued
        .clone()
        .try_acquire_many_owned(bytes as u32)
        .map_err(|_| IdeError::unavailable("kernel output queue exceeds 16 MiB; execution stopped"))?;
    // Upstream RawMessage indexes four signed parts without checking length.
    // Validate framing before calling it, including messages from a bad kernel.
    let delimiter = multipart
        .iter()
        .position(|part| part.as_ref() == b"<IDS|MSG>")
        .ok_or_else(|| protocol("missing Jupyter message delimiter"))?;
    if multipart.len() < delimiter + 6 {
        return Err(protocol("incomplete Jupyter message frames"));
    }
    let raw = RawMessage::from_multipart(multipart, &connection.mac).map_err(protocol)?;
    let header: Value = serde_json::from_slice(&raw.jparts[0]).map_err(protocol)?;
    let parent: Value = serde_json::from_slice(&raw.jparts[1]).map_err(protocol)?;
    let kind = header
        .get("msg_type")
        .and_then(Value::as_str)
        .ok_or_else(|| protocol("missing Jupyter message type"))?
        .to_owned();
    let parent = parent.get("msg_id").and_then(Value::as_str).unwrap_or("").to_owned();
    let content = serde_json::from_slice(&raw.jparts[3]).map_err(protocol)?;
    Ok(Frame { channel, parent, kind, content, bytes, _permit: Some(permit) })
}

fn protocol(error: impl std::fmt::Display) -> IdeError {
    IdeError::new(ide_core::error::ErrorKind::Protocol, format!("Jupyter protocol: {error}"))
}

struct Session {
    data: Option<Arc<crate::session::SessionData>>,
    process: Process,
    shell: DealerSendConnection,
    control: ClientControlConnection,
    stdin: DealerSendConnection,
    input: mpsc::Receiver<InputReplyRequest>,
    frames: mpsc::Receiver<Frame>,
    failure: Failure,
    _readers: Readers,
    comm_requests: mpsc::Receiver<CommRequest>,
    comm_events: broadcast::Sender<CommEvent>,
    dap_comm: Option<String>,
}

impl Session {
    async fn initialize_variables(&mut self, runtime: &KernelRuntime, stop: &CancellationToken) -> IdeResult<()> {
        let adapter = crate::session_adapter::SessionAdapter::for_runtime(runtime);
        if let Some(bootstrap) = adapter.bootstrap {
            let source = serde_json::to_string(bootstrap).map_err(protocol)?;
            let request: JupyterMessage = ExecuteRequest {
                code: format!("exec({source}, {{'__name__': '__openide_session__'}})"),
                silent: true,
                store_history: false,
                allow_stdin: false,
                ..Default::default()
            }
            .into();
            let id = request.header.msg_id.clone();
            send(&mut self.shell, request).await?;
            let mut completion = Completion::default();
            tokio::time::timeout(Duration::from_secs(10), async {
                loop {
                    let frame = tokio::select! {
                        biased;
                        _ = stop.cancelled() => return Err(IdeError::cancelled()),
                        frame = self.frames.recv() => frame.ok_or_else(|| protocol("variables bootstrap disconnected"))?,
                    };
                    if self.dispatch_comm(&frame).await? { continue; }
                    completion.observe(&frame, &id)?;
                    if completion.complete() {
                        return if completion.reply.as_ref().is_some_and(|reply| reply.status == "ok") { Ok(()) }
                            else { Err(IdeError::unavailable("Python variables adapter could not initialize")) };
                    }
                }
            }).await.map_err(|_| IdeError::unavailable("Python variables bootstrap timed out"))??;
        }
        let data = self.data.as_ref().expect("session data initialized");
        let message = jupyter_protocol::CommOpen {
            comm_id: jupyter_protocol::CommId(data.comm_id.clone()),
            target_name: adapter.target.into(),
            data: Default::default(),
            target_module: None,
        }
        .into();
        send(&mut self.shell, message).await
    }

    async fn connect(
        runtime: &std::path::Path,
        notebook: &std::path::Path,
        selected: &KernelRuntime,
        comm_requests: mpsc::Receiver<CommRequest>,
        comm_events: broadcast::Sender<CommEvent>,
        input: mpsc::Receiver<InputReplyRequest>,
    ) -> IdeResult<Self> {
        let (process, info) = Process::spawn(runtime, notebook, selected).await?;
        let session = Uuid::new_v4().to_string();
        let identity = jupyter_zmq_client::peer_identity_for_session(&session).map_err(protocol)?;
        let (iopub, shell, control, stdin) = tokio::try_join!(
            jupyter_zmq_client::create_client_iopub_connection(&info, "", &session),
            jupyter_zmq_client::create_client_shell_connection_with_identity(&info, &session, identity.clone()),
            jupyter_zmq_client::create_client_control_connection(&info, &session),
            jupyter_zmq_client::create_client_stdin_connection_with_identity(&info, &session, identity),
        )
        .map_err(protocol)?;
        let (shell, shell_recv) = shell.split();
        let (stdin, stdin_recv) = stdin.split();
        let (tx, frames) = mpsc::channel(QUEUED_MESSAGES);
        let failure = Failure::new();
        let queued = Arc::new(Semaphore::new(QUEUED_BYTES));
        let readers = Readers(vec![
            reader(iopub, Channel::Iopub, tx.clone(), failure.clone(), queued.clone()),
            reader(shell_recv, Channel::Shell, tx.clone(), failure.clone(), queued.clone()),
            reader(stdin_recv, Channel::Stdin, tx, failure.clone(), queued),
        ]);
        Ok(Self {
            data: None,
            process,
            shell,
            control,
            stdin,
            input,
            frames,
            failure,
            _readers: readers,
            comm_requests,
            comm_events,
            dap_comm: None,
        })
    }

    async fn ready(&mut self, stop: &CancellationToken) -> IdeResult<()> {
        let deadline = Instant::now() + STARTUP_TIMEOUT;
        let mut probe = tokio::time::interval(Duration::from_millis(250));
        probe.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let mut request = String::new();
        let mut reply = false;
        let mut idle = false;
        loop {
            tokio::select! {
                biased;
                _ = stop.cancelled() => return Err(IdeError::cancelled()),
                _ = self.failure.token.cancelled() => return Err(self.failure.error()),
                _ = tokio::time::sleep_until(deadline) => return Err(IdeError::unavailable(format!(
                    "selected kernel was not ready within 30 seconds; {}", self.process.stderr()))),
                _ = probe.tick() => {
                    if let Some(message) = self.process.death()? {
                        return Err(IdeError::unavailable(message));
                    }
                    // Only readiness probes are retried, never user execution.
                    // Once the shell replies, retain its ID to await IOPub idle.
                    if !reply {
                        let message: JupyterMessage = KernelInfoRequest {}.into();
                        request = message.header.msg_id.clone();
                        idle = false;
                        send(&mut self.shell, message).await?;
                    } else if !idle {
                        // A slow subscriber can miss the first idle. Probe again
                        // after a reply, proving BOTH live shell and subscription.
                        reply = false;
                    }
                },
                frame = self.frames.recv() => {
                    let frame = frame.ok_or_else(|| IdeError::unavailable("kernel readers closed during startup"))?;
                    if self.dispatch_comm(&frame).await? { continue; }
                    if frame.parent != request { continue; }
                    if frame.channel == Channel::Shell && frame.kind == "kernel_info_reply" { reply = true; }
                    if frame.channel == Channel::Iopub && is_idle(&frame) { idle = true; }
                    if reply && idle { return Ok(()); }
                }
            }
        }
    }

    async fn run(
        &mut self,
        execution: &mut Execution,
        stop: &CancellationToken,
        notebook: &std::path::Path,
        status: &StatusCallback,
    ) -> IdeResult<ExecutionResult> {
        if execution.cancel.is_cancelled() || execution.interrupt.is_cancelled() || execution.reply.is_closed() {
            return Err(IdeError::cancelled());
        }
        let request: JupyterMessage = ExecuteRequest {
            code: std::mem::take(&mut execution.code),
            allow_stdin: execution.allow_stdin,
            stop_on_error: true,
            ..Default::default()
        }
        .into();
        let request_id = request.header.msg_id.clone();
        // If sending fails/times out, delivery is uncertain. Supervisor closes
        // the process; no caller may retry user code automatically.
        send(&mut self.shell, request).await?;
        status(notebook, KernelState::Busy, None);
        let mut completion = Completion::default();
        let mut budget = Budget::default();
        let mut interrupted = false;
        let mut pending_input: Option<String> = None;
        let mut interrupt_deadline = None;
        let mut death = tokio::time::interval(Duration::from_millis(100));
        death.set_missed_tick_behavior(MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                biased;
                _ = stop.cancelled() => return Err(IdeError::cancelled()),
                _ = self.failure.token.cancelled() => return Err(self.failure.error()),
                _ = execution.cancel.cancelled(), if !interrupted => {
                    pending_input = None;
                    self.process.interrupt()?;
                    interrupted = true;
                    interrupt_deadline = Some(Instant::now() + INTERRUPT_TIMEOUT);
                },
                _ = execution.interrupt.cancelled(), if !interrupted => {
                    pending_input = None;
                    self.process.interrupt()?;
                    interrupted = true;
                    interrupt_deadline = Some(Instant::now() + INTERRUPT_TIMEOUT);
                },
                _ = death.tick() => {
                    if execution.reply.is_closed() && !interrupted {
                        self.process.interrupt()?;
                        interrupted = true;
                        interrupt_deadline = Some(Instant::now() + INTERRUPT_TIMEOUT);
                    }
                    if interrupt_deadline.is_some_and(|deadline| Instant::now() >= deadline) {
                        return Err(IdeError::unavailable("kernel did not drain within 5 seconds of interrupt; owned kernel stopped"));
                    }
                    if let Some(message) = self.process.death()? { return Err(IdeError::unavailable(message)); }
                },
                Some(request) = self.input.recv() => {
                    if request.reply.is_closed() { continue; }
                    if interrupted || pending_input.as_ref() != Some(&request.id) {
                        let _ = request.reply.send(Err(IdeError::invalid("stale or already answered stdin prompt")));
                        continue;
                    }
                    pending_input = None;
                    let result = if let Some(value) = request.value {
                        send(&mut self.stdin, jupyter_protocol::InputReply { value, ..Default::default() }.into()).await
                    } else {
                        interrupted = true;
                        interrupt_deadline = Some(Instant::now() + INTERRUPT_TIMEOUT);
                        self.process.interrupt()
                    };
                    let _ = request.reply.send(result.clone());
                    result?;
                },
                Some(request) = self.comm_requests.recv() => self.send_comm(request).await?,
                frame = self.frames.recv() => {
                    let frame = frame.ok_or_else(|| IdeError::unavailable("kernel readers closed during execution"))?;
                    if self.dispatch_comm(&frame).await? { continue; }
                    if frame.parent != request_id { continue; }
                    budget.add(frame.bytes)?;
                    if frame.channel == Channel::Stdin && frame.kind == "input_request" {
                        if interrupted { continue; }
                        if !execution.allow_stdin || pending_input.is_some() { return Err(protocol("unexpected stdin request")); }
                        let id = Uuid::new_v4().to_string();
                        pending_input = Some(id.clone());
                        let mut content = frame.content;
                        content["requestId"] = Value::String(id);
                        (execution.output)(KernelOutput { kind: "input_request".into(), content, msg_id: frame.parent });
                        continue;
                    }
                    completion.observe(&frame, &request_id)?;
                    if frame.channel == Channel::Iopub && is_output(&frame.kind) {
                        (execution.output)(KernelOutput { kind: frame.kind, content: frame.content, msg_id: frame.parent });
                    }
                    if completion.complete() {
                        status(notebook, KernelState::Idle, None);
                        if interrupted || execution.cancel.is_cancelled() || execution.interrupt.is_cancelled() {
                            return Err(IdeError::cancelled());
                        }
                        return Ok(completion.reply.take().expect("complete reply"));
                    }
                }
            }
        }
    }

    async fn dispatch_comm(&mut self, frame: &Frame) -> IdeResult<bool> {
        if frame.channel == Channel::Iopub
            && let Some(data) = &self.data
        {
            data.observe(&frame.kind, &frame.content, &frame.parent);
        }
        if frame.channel != Channel::Iopub || !matches!(frame.kind.as_str(), "comm_open" | "comm_msg" | "comm_close") {
            return Ok(false);
        }
        let comm_id = frame.content["comm_id"].as_str().ok_or_else(|| protocol("comm event missing comm_id"))?;
        if self.data.as_ref().is_some_and(|data| data.owns_comm(comm_id)) {
            return Ok(true);
        }
        // Ark DAP delegates stepping through its server comm. Only the exact
        // app-opened DAP comm may request one of these fixed browser commands.
        if self.dap_comm.as_deref() == Some(comm_id)
            && frame.kind == "comm_msg"
            && frame.content["data"]["method"] == "execute"
        {
            let command = frame.content["data"]["params"]["command"]
                .as_str()
                .ok_or_else(|| protocol("missing DAP browser command"))?;
            if !matches!(command, "n" | "s" | "f" | "c" | "Q") {
                return Err(protocol("invalid DAP browser command"));
            }
            // In notebook mode the shell stays occupied until the cell ends.
            // Control debug_request reaches R's paused debug loop directly.
            let command = match command {
                "n" => "next",
                "s" => "stepIn",
                "f" => "stepOut",
                "c" => "continue",
                "Q" => "disconnect",
                _ => unreachable!(),
            };
            let request: JupyterMessage = jupyter_protocol::DebugRequest { content: serde_json::json!({"seq":1,"type":"request","command":command,"arguments":{"threadId":-1,"restart":false}}) }.into();
            tokio::time::timeout(SEND_TIMEOUT, async {
                self.control.send(request).await.map_err(protocol)?;
                let reply = self.control.read().await.map_err(protocol)?;
                match reply.content {
                    jupyter_protocol::JupyterMessageContent::DebugReply(reply) if reply.content["success"] == true => {
                        Ok(())
                    }
                    _ => Err(protocol("Ark control rejected DAP browser command")),
                }
            })
            .await
            .map_err(|_| IdeError::unavailable("Ark debug control timed out"))??;
        }
        if self.dap_comm.as_deref() == Some(comm_id) && frame.kind == "comm_close" {
            self.dap_comm = None;
        }
        let _ = self.comm_events.send(CommEvent {
            kind: frame.kind.clone(),
            comm_id: comm_id.into(),
            parent_id: frame.parent.clone(),
            content: frame.content.clone(),
        });
        Ok(true)
    }

    async fn send_comm(&mut self, request: CommRequest) -> IdeResult<()> {
        if request.reply.is_closed() {
            return Ok(());
        }
        let dap_comm = match &request.message.content {
            jupyter_protocol::JupyterMessageContent::CommOpen(open) if open.target_name == "ark_dap" => {
                Some(open.comm_id.0.clone())
            }
            _ => None,
        };
        let result = send(&mut self.shell, request.message).await;
        if result.is_ok() && dap_comm.is_some() {
            self.dap_comm = dap_comm;
        }
        let _ = request.reply.send(result.clone());
        result
    }

    async fn shutdown(&mut self) {
        // Stop is separate from user interrupt: graceful shutdown, then kill only
        // our process group/job. It must remain bounded even for wedged Python.
        let request: JupyterMessage = ShutdownRequest { restart: false }.into();
        let _ = tokio::time::timeout(Duration::from_millis(500), self.control.send(request)).await;
        let deadline = Instant::now() + Duration::from_millis(750);
        while Instant::now() < deadline {
            match self.process.death() {
                Ok(None) => {}
                _ => break,
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        self.process.shutdown().await;
    }
}

async fn send(connection: &mut DealerSendConnection, message: JupyterMessage) -> IdeResult<()> {
    tokio::time::timeout(SEND_TIMEOUT, connection.send(message))
        .await
        .map_err(|_| IdeError::unavailable("kernel request send timed out; delivery uncertain, not retried"))?
        .map_err(protocol)
}

fn is_idle(frame: &Frame) -> bool {
    frame.kind == "status" && frame.content.get("execution_state").and_then(Value::as_str) == Some("idle")
}

fn is_output(kind: &str) -> bool {
    matches!(
        kind,
        "stream"
            | "display_data"
            | "execute_result"
            | "error"
            | "execute_input"
            | "clear_output"
            | "update_display_data"
    )
}

#[derive(Default)]
struct Completion {
    reply: Option<ExecutionResult>,
    idle: bool,
}
impl Completion {
    fn observe(&mut self, frame: &Frame, request_id: &str) -> IdeResult<()> {
        if frame.parent != request_id {
            return Ok(());
        }
        if frame.channel == Channel::Iopub && is_idle(frame) {
            self.idle = true;
        }
        if frame.channel == Channel::Shell && frame.kind == "execute_reply" {
            let status = frame
                .content
                .get("status")
                .and_then(Value::as_str)
                .ok_or_else(|| protocol("execute_reply missing status"))?;
            if !matches!(status, "ok" | "error" | "abort" | "aborted") {
                return Err(protocol("invalid execute_reply status"));
            }
            let count = match frame.content.get("execution_count") {
                None | Some(Value::Null) => None,
                Some(value) => Some(
                    value
                        .as_u64()
                        .and_then(|n| u32::try_from(n).ok())
                        .ok_or_else(|| protocol("invalid execution count"))?,
                ),
            };
            self.reply = Some(ExecutionResult { status: status.to_owned(), execution_count: count });
        }
        Ok(())
    }
    fn complete(&self) -> bool {
        self.idle && self.reply.is_some()
    }
}

#[derive(Default)]
struct Budget {
    bytes: usize,
    messages: usize,
}
impl Budget {
    fn add(&mut self, bytes: usize) -> IdeResult<()> {
        self.bytes = self.bytes.saturating_add(bytes);
        self.messages = self.messages.saturating_add(1);
        if self.bytes > MAX_OUTPUT_BYTES || self.messages > MAX_OUTPUT_MESSAGES {
            return Err(IdeError::unavailable("kernel output exceeded 32 MiB or 10000 messages; execution stopped"));
        }
        Ok(())
    }
}

struct SessionChannels {
    session_data: Arc<crate::session::SessionData>,
    ready: oneshot::Sender<IdeResult<()>>,
    comm_requests: mpsc::Receiver<CommRequest>,
    comm_events: broadcast::Sender<CommEvent>,
    input: mpsc::Receiver<InputReplyRequest>,
}

async fn supervise(
    runtime: PathBuf,
    notebook: PathBuf,
    selected: KernelRuntime,
    status: StatusCallback,
    stop: CancellationToken,
    mut requests: mpsc::Receiver<Execution>,
    channels: SessionChannels,
) {
    let SessionChannels { ready, comm_requests, comm_events, input, session_data } = channels;
    struct StopOnExit(CancellationToken);
    impl Drop for StopOnExit {
        fn drop(&mut self) {
            self.0.cancel();
        }
    }
    let _stop_on_exit = StopOnExit(stop.clone());
    status(&notebook, KernelState::Starting, None);
    let startup = async {
        let mut session = Session::connect(&runtime, &notebook, &selected, comm_requests, comm_events, input).await?;
        session.ready(&stop).await?;
        session.data = Some(session_data.clone());
        if let Err(error) = session.initialize_variables(&selected, &stop).await {
            session_data.error(error.message);
        }
        IdeResult::Ok(session)
    };
    let result = tokio::select! {
        biased;
        _ = stop.cancelled() => Err(IdeError::cancelled()),
        result = tokio::time::timeout(STARTUP_TIMEOUT, startup) => result.unwrap_or_else(|_| Err(IdeError::unavailable("selected kernel startup timed out"))),
    };
    let mut session = match result {
        Ok(session) => session,
        Err(error) => {
            let hint = match &selected {
                KernelRuntime::Python { executable } => format!(
                    "Ensure ipykernel is installed in this exact environment ({} -m pip install ipykernel)",
                    executable.display()
                ),
                KernelRuntime::Ark { r_home, .. } => {
                    format!("Ensure Ark and R_HOME {} are compatible", r_home.display())
                }
            };
            let message = format!(
                "{}; selected {}: {}. {hint}; no fallback interpreter was used",
                error.message,
                selected.language(),
                selected.executable().display()
            );
            let error = IdeError::new(error.kind, message);
            status(&notebook, KernelState::Dead, Some(error.message.clone()));
            let _ = ready.send(Err(error));
            return;
        }
    };
    status(&notebook, KernelState::Idle, None);
    if ready.send(Ok(())).is_err() {
        stop.cancel();
    }
    let mut death = tokio::time::interval(Duration::from_millis(100));
    death.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let failure = session.failure.clone();
    let mut reason = None;
    loop {
        tokio::select! {
            biased;
            _ = stop.cancelled() => break,
            _ = failure.token.cancelled() => { reason = Some(failure.error().message); break; },
            _ = death.tick() => match session.process.death() {
                Ok(None) => {},
                Ok(Some(message)) => { reason = Some(message); break; },
                Err(error) => { reason = Some(error.message); break; },
            },
            request = requests.recv() => {
                let Some(mut request) = request else { break };
                let result = session.run(&mut request, &stop, &notebook, &status).await;
                // Cancelled with reply+idle is reusable. Stop cancellation or any
                // transport/death/overflow error invalidates this generation.
                let fatal = result.as_ref().err().is_some_and(|e| e.kind != ide_core::error::ErrorKind::Cancelled)
                    || stop.is_cancelled();
                if fatal { reason = result.as_ref().err().map(|e| e.message.clone()); }
                let Execution { reply, _admission, .. } = request;
                drop(_admission);
                let _ = reply.send(result);
                if fatal { break; }
            },
            Some(request) = session.input.recv() => {
                let _ = request.reply.send(Err(IdeError::invalid("no active stdin prompt")));
            },
            Some(request) = session.comm_requests.recv() => {
                if let Err(error) = session.send_comm(request).await { reason = Some(error.message); break; }
            },
            frame = session.frames.recv() => {
                // Post-idle/background messages are deliberately NOT forwarded.
                // Keeping this drain alive also prevents stale IDs leaking into
                // later executions or another process generation.
                match frame {
                    None => { reason = Some("kernel readers closed".into()); break; }
                    Some(frame) => if let Err(error) = session.dispatch_comm(&frame).await { reason = Some(error.message); break; },
                }
            }
        }
    }
    requests.close();
    while let Ok(request) = requests.try_recv() {
        let _ = request.reply.send(Err(IdeError::unavailable("kernel stopped before execution admission")));
    }
    session.shutdown().await;
    status(&notebook, KernelState::Dead, reason);
}

#[cfg(test)]
#[path = "transport_tests.rs"]
mod tests;
