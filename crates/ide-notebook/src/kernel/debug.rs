//! Generation-bound Jupyter debug requests. Cancellation abandons a request locally;
//! it does not claim to cancel execution inside an adapter.
use ide_core::{CancellationToken, IdeError, IdeResult};
use parking_lot::Mutex;
use serde_json::Value;
use std::sync::Arc;
use std::sync::atomic::{AtomicU8, AtomicU32, Ordering};
use std::time::Duration;
use tokio::sync::{broadcast, mpsc, oneshot};
use tokio::time::Instant;

pub(super) const TIMEOUT: Duration = Duration::from_secs(10);
pub(super) const MAX_PENDING: usize = 32;

#[derive(Clone, Debug)]
pub struct KernelDebugCapabilities {
    pub generation: String,
    /// The kernel's advertisement, not a claim that every DAP feature works.
    pub debugger: bool,
    pub kernel_info: Value,
}

#[derive(Clone, Debug)]
pub struct KernelDebugEvent {
    pub generation: String,
    pub sequence: u32,
    pub parent_id: String,
    pub content: Value,
}

pub struct KernelDebugSubscription {
    generation: String,
    events: broadcast::Receiver<KernelDebugEvent>,
    stop: CancellationToken,
}

impl KernelDebugSubscription {
    pub fn generation(&self) -> &str {
        &self.generation
    }

    pub async fn recv(&mut self) -> IdeResult<KernelDebugEvent> {
        tokio::select! {
            biased;
            _ = self.stop.cancelled() => Err(IdeError::unavailable("kernel debug session closed")),
            event = self.events.recv() => event.map_err(|error| IdeError::unavailable(format!("kernel debug subscription: {error}"))),
        }
    }
}

pub(super) struct DebugRequest {
    pub public: bool,
    pub message: jupyter_protocol::JupyterMessage,
    pub seq: u32,
    pub command: String,
    pub cancel: CancellationToken,
    pub deadline: Instant,
    pub reply: oneshot::Sender<IdeResult<Value>>,
}

pub(super) struct DebugClient {
    pub generation: String,
    pub info: Mutex<Option<Value>>,
    pub requests: mpsc::Sender<DebugRequest>,
    events: broadcast::Sender<KernelDebugEvent>,
    stop: CancellationToken,
    seq: AtomicU32,
    event_seq: AtomicU32,
    mode: AtomicU8,
}

impl DebugClient {
    pub fn new(generation: String, stop: CancellationToken) -> (Arc<Self>, mpsc::Receiver<DebugRequest>) {
        let (requests, receiver) = mpsc::channel(MAX_PENDING);
        let (events, _) = broadcast::channel(64);
        (
            Arc::new(Self {
                generation,
                info: Mutex::new(None),
                requests,
                events,
                stop,
                seq: AtomicU32::new(0),
                event_seq: AtomicU32::new(0),
                mode: AtomicU8::new(0),
            }),
            receiver,
        )
    }

    pub fn capabilities(&self) -> IdeResult<KernelDebugCapabilities> {
        if self.stop.is_cancelled() {
            return Err(IdeError::unavailable("kernel debug session closed"));
        }
        let info =
            self.info.lock().clone().ok_or_else(|| IdeError::unavailable("kernel capabilities are not ready"))?;
        let debugger = info["debugger"] == true
            || info["supported_features"]
                .as_array()
                .is_some_and(|features| features.iter().any(|feature| feature == "debugger"));
        Ok(KernelDebugCapabilities { generation: self.generation.clone(), debugger, kernel_info: info })
    }

    // A transport choice lasts for the entire generation, including after disconnect.
    pub fn claim(&self, mode: u8) -> IdeResult<()> {
        match self.mode.compare_exchange(0, mode, Ordering::AcqRel, Ordering::Acquire) {
            Ok(_) => Ok(()),
            Err(current) if current == mode => Ok(()),
            Err(_) => Err(IdeError::unavailable(
                "another debug transport owns this kernel; restart the kernel to change debug transport",
            )),
        }
    }

    pub fn subscribe(&self) -> IdeResult<KernelDebugSubscription> {
        let events = self.events.subscribe();
        if self.stop.is_cancelled() {
            return Err(IdeError::unavailable("kernel debug session closed"));
        }
        Ok(KernelDebugSubscription { generation: self.generation.clone(), events, stop: self.stop.clone() })
    }

    pub fn event(&self, parent: &str, content: &Value) -> IdeResult<()> {
        if serde_json::to_vec(content).map_err(|error| IdeError::invalid(error.to_string()))?.len() > 64 * 1024 {
            return Err(IdeError::unavailable("kernel debug event exceeds 64 KiB"));
        }
        if content["type"] != "event" || content["event"].as_str().is_none_or(str::is_empty) {
            return Err(IdeError::invalid("malformed kernel debug event"));
        }
        let sequence = next(&self.event_seq)?;
        let _ = self.events.send(KernelDebugEvent {
            generation: self.generation.clone(),
            sequence,
            parent_id: parent.into(),
            content: content.clone(),
        });
        Ok(())
    }

    pub async fn request(
        &self,
        command: &str,
        mut arguments: Value,
        cancel: CancellationToken,
        public: bool,
    ) -> IdeResult<Value> {
        if cancel.is_cancelled() {
            return Err(IdeError::cancelled());
        }
        validate(command, &arguments)?;
        if command == "disconnect" {
            if arguments["terminateDebuggee"] == true || arguments["restart"] == true {
                return Err(IdeError::invalid("disconnect cannot terminate or restart a shared notebook kernel"));
            }
            arguments["terminateDebuggee"] = Value::Bool(false);
            arguments["restart"] = Value::Bool(false);
        }
        let capabilities = self.capabilities()?;
        if !capabilities.debugger {
            return Err(IdeError::unavailable("kernel does not advertise Jupyter debugging"));
        }
        if public && self.mode.load(Ordering::Acquire) == 2 {
            return Err(IdeError::unavailable(
                "another debug transport owns this kernel; restart the kernel to change debug transport",
            ));
        }
        // Ark deserializes threads as a unit enum variant; an object is invalid on its wire.
        if command == "threads" && capabilities.kernel_info["implementation"] == "ark" {
            arguments = Value::Null;
        }
        let seq = next(&self.seq)?;
        let message = jupyter_protocol::DebugRequest {
            content: serde_json::json!({
                "seq": seq, "type": "request", "command": command, "arguments": arguments,
            }),
        }
        .into();
        let (reply, result) = oneshot::channel();
        let deadline = Instant::now() + TIMEOUT;
        self.requests
            .try_send(DebugRequest {
                public,
                message,
                seq,
                command: command.into(),
                cancel: cancel.clone(),
                deadline,
                reply,
            })
            .map_err(|_| IdeError::unavailable("kernel debug request queue is full or closed"))?;
        tokio::select! {
            biased;
            _ = cancel.cancelled() => Err(IdeError::cancelled()),
            _ = self.stop.cancelled() => Err(IdeError::unavailable("kernel debug session closed")),
            _ = tokio::time::sleep_until(deadline) => Err(IdeError::unavailable("kernel debug request timed out")),
            result = result => result.unwrap_or_else(|_| Err(IdeError::unavailable("kernel debug broker closed"))),
        }
    }
}

fn next(sequence: &AtomicU32) -> IdeResult<u32> {
    sequence
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |value| value.checked_add(1))
        .map(|previous| previous + 1)
        .map_err(|_| IdeError::unavailable("kernel debug sequence exhausted; restart the kernel"))
}

fn validate(command: &str, arguments: &Value) -> IdeResult<()> {
    if !matches!(
        command,
        "initialize"
            | "attach"
            | "configurationDone"
            | "disconnect"
            | "debugInfo"
            | "dumpCell"
            | "setBreakpoints"
            | "setExceptionBreakpoints"
            | "threads"
            | "stackTrace"
            | "scopes"
            | "variables"
            | "evaluate"
            | "next"
            | "stepIn"
            | "stepOut"
            | "continue"
            | "pause"
            | "source"
    ) {
        return Err(IdeError::invalid("unsupported kernel debug command"));
    }
    if !arguments.is_object() {
        return Err(IdeError::invalid("kernel debug arguments must be an object"));
    }
    if serde_json::to_vec(arguments).map_err(|error| IdeError::invalid(error.to_string()))?.len() > 1024 * 1024 {
        return Err(IdeError::invalid("kernel debug arguments exceed 1 MiB"));
    }
    Ok(())
}

#[derive(Default)]
pub(super) struct Pending(std::collections::HashMap<String, DebugRequest>);

impl Pending {
    pub fn full(&self) -> bool {
        self.0.len() >= MAX_PENDING
    }

    pub fn insert(&mut self, request: DebugRequest) {
        self.0.insert(request.message.header.msg_id.clone(), request);
    }

    pub fn receive(&mut self, parent: &str, content: Value) {
        let Some(request) = self.0.get(parent) else { return };
        if content["type"] != "response"
            || content["request_seq"].as_u64() != Some(u64::from(request.seq))
            || content["command"] != request.command
            || !content["success"].is_boolean()
        {
            return;
        }
        let request = self.0.remove(parent).expect("matched pending debug request");
        let result = if let Err(error) = bounded(&content) {
            Err(error)
        } else if request.cancel.is_cancelled() {
            Err(IdeError::cancelled())
        } else if Instant::now() >= request.deadline {
            Err(IdeError::unavailable("kernel debug request timed out"))
        } else {
            Ok(content)
        };
        let _ = request.reply.send(result);
    }

    pub fn expire(&mut self) {
        let now = Instant::now();
        let expired = self
            .0
            .iter()
            .filter(|(_, request)| {
                request.reply.is_closed() || request.cancel.is_cancelled() || now >= request.deadline
            })
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        for id in expired {
            let request = self.0.remove(&id).expect("expired pending request");
            let error = if request.cancel.is_cancelled() {
                IdeError::cancelled()
            } else {
                IdeError::unavailable("kernel debug request timed out")
            };
            let _ = request.reply.send(Err(error));
        }
    }
}

fn bounded(content: &Value) -> IdeResult<()> {
    if serde_json::to_vec(content).map_err(|error| IdeError::invalid(error.to_string()))?.len() > 8 * 1024 * 1024 {
        return Err(IdeError::unavailable("kernel debug message exceeds 8 MiB"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn request(seq: u32, command: &str) -> (DebugRequest, oneshot::Receiver<IdeResult<Value>>) {
        let (reply, result) = oneshot::channel();
        (
            DebugRequest {
                public: true,
                message: jupyter_protocol::DebugRequest { content: json!({"seq":seq,"command":command}) }.into(),
                seq,
                command: command.into(),
                cancel: CancellationToken::new(),
                deadline: Instant::now() + TIMEOUT,
                reply,
            },
            result,
        )
    }

    fn response(seq: u32, command: &str) -> Value {
        json!({"type":"response","request_seq":seq,"command":command,"success":true,"body":{"supportsConfigurationDoneRequest":true}})
    }

    #[tokio::test]
    async fn replies_require_all_three_identifiers_and_allow_out_of_order_delivery() {
        let mut pending = Pending::default();
        let (first, mut a) = request(1, "initialize");
        let first_id = first.message.header.msg_id.clone();
        let (second, b) = request(2, "threads");
        let second_id = second.message.header.msg_id.clone();
        assert_ne!(first_id, second_id);
        pending.insert(first);
        pending.insert(second);
        pending.receive("unrelated-parent", response(1, "initialize"));
        pending.receive(&first_id, response(2, "initialize"));
        pending.receive(&first_id, response(1, "threads"));
        let mut invalid = response(1, "initialize");
        invalid["type"] = json!("event");
        pending.receive(&first_id, invalid);
        let mut invalid = response(1, "initialize");
        invalid["success"] = Value::Null;
        pending.receive(&first_id, invalid);
        assert!(a.try_recv().is_err());
        assert_eq!(pending.0.len(), 2);
        pending.receive(&second_id, response(2, "threads"));
        assert_eq!(b.await.unwrap().unwrap()["command"], "threads");
        let original = response(1, "initialize");
        pending.receive(&first_id, original.clone());
        assert_eq!(a.await.unwrap().unwrap(), original);
        assert!(pending.0.is_empty());
    }

    #[tokio::test]
    async fn timeout_cancel_and_dropped_waiters_leave_no_pending_without_replies() {
        let mut pending = Pending::default();
        let (mut timed_out, timeout) = request(1, "threads");
        timed_out.deadline = Instant::now();
        let late_id = timed_out.message.header.msg_id.clone();
        let (cancelled, cancel) = request(2, "threads");
        cancelled.cancel.cancel();
        let (dropped, drop_result) = request(3, "threads");
        drop(drop_result);
        pending.insert(timed_out);
        pending.insert(cancelled);
        pending.insert(dropped);
        pending.expire();
        assert!(timeout.await.unwrap().unwrap_err().message.contains("timed out"));
        assert_eq!(cancel.await.unwrap().unwrap_err().kind, ide_core::error::ErrorKind::Cancelled);
        assert!(pending.0.is_empty());
        pending.receive(&late_id, response(1, "threads"));
        assert!(pending.0.is_empty());
    }

    #[tokio::test]
    async fn preserves_adapter_failure_and_bounds_reply_event_and_arguments() {
        let mut pending = Pending::default();
        let (failed, receiver) = request(1, "evaluate");
        let id = failed.message.header.msg_id.clone();
        pending.insert(failed);
        let mut reply = response(1, "evaluate");
        reply["success"] = json!(false);
        reply["message"] = json!("actual adapter diagnostic");
        pending.receive(&id, reply.clone());
        assert_eq!(receiver.await.unwrap().unwrap(), reply);
        assert!(validate("dumpCell", &json!({"code":"x".repeat(1024*1024)})).is_err());
        let (large, receiver) = request(2, "variables");
        let id = large.message.header.msg_id.clone();
        pending.insert(large);
        let mut reply = response(2, "variables");
        reply["body"] = json!({"value":"x".repeat(8*1024*1024)});
        pending.receive(&id, reply);
        assert!(receiver.await.unwrap().unwrap_err().message.contains("8 MiB"));
        let (client, _rx) = DebugClient::new("generation".into(), CancellationToken::new());
        assert!(client.event("", &json!({"type":"event","event":"output","body":"x".repeat(8*1024*1024)})).is_err());
    }

    #[tokio::test]
    async fn subscription_is_ready_before_requests_and_has_generation_sequence_lag_and_close() {
        let stop = CancellationToken::new();
        let (client, _rx) = DebugClient::new("generation-a".into(), stop.clone());
        let mut subscription = client.subscribe().unwrap();
        assert_eq!(subscription.generation(), "generation-a");
        let event = json!({"type":"event","event":"initialized"});
        client.event("independent-of-execute", &event).unwrap();
        let received = subscription.recv().await.unwrap();
        assert_eq!(received.generation, "generation-a");
        assert_eq!(received.sequence, 1);
        assert_eq!(received.parent_id, "independent-of-execute");
        for _ in 0..65 {
            client.event("", &event).unwrap();
        }
        assert!(subscription.recv().await.unwrap_err().message.contains("lagged"));
        stop.cancel();
        assert!(subscription.recv().await.unwrap_err().message.contains("closed"));
        assert!(client.subscribe().is_err());
    }

    #[tokio::test]
    async fn capabilities_are_actual_and_mode_is_exclusive_after_validation() {
        let (client, mut rx) = DebugClient::new("generation".into(), CancellationToken::new());
        assert!(client.capabilities().is_err());
        for info in [json!({"debugger":true}), json!({"supported_features":["debugger"]})] {
            *client.info.lock() = Some(info.clone());
            let caps = client.capabilities().unwrap();
            assert!(caps.debugger);
            assert_eq!(caps.kernel_info, info);
        }
        *client.info.lock() = Some(json!({"debugger":false}));
        assert!(client.request("initialize", json!({}), CancellationToken::new(), true).await.is_err());
        assert_eq!(client.mode.load(Ordering::Acquire), 0);
        *client.info.lock() = Some(json!({"debugger":true}));
        for command in ["launch", "restart"] {
            assert!(client.request(command, json!({}), CancellationToken::new(), true).await.is_err());
        }
        for arguments in [json!({"restart":true}), json!({"terminateDebuggee":true})] {
            assert!(client.request("disconnect", arguments, CancellationToken::new(), true).await.is_err());
        }
        let cancel = CancellationToken::new();
        cancel.cancel();
        assert!(client.request("initialize", json!({}), cancel, true).await.is_err());
        assert_eq!(client.mode.load(Ordering::Acquire), 0);
        assert!(rx.try_recv().is_err());
        client.claim(2).unwrap();
        assert!(
            client
                .request("initialize", json!({}), CancellationToken::new(), true)
                .await
                .unwrap_err()
                .message
                .contains("restart")
        );
        client.claim(2).unwrap();
        let (other, _rx) = DebugClient::new("generation-b".into(), CancellationToken::new());
        other.claim(1).unwrap();
        assert!(other.claim(2).is_err());
    }

    #[tokio::test]
    async fn broker_receives_unique_sequences_and_safe_disconnect_arguments() {
        let (client, mut requests) = DebugClient::new("generation".into(), CancellationToken::new());
        *client.info.lock() = Some(json!({"debugger":true}));
        let a = client.clone();
        let task =
            tokio::spawn(async move { a.request("disconnect", json!({}), CancellationToken::new(), true).await });
        let request = requests.recv().await.unwrap();
        assert_eq!(request.seq, 1);
        let jupyter_protocol::JupyterMessageContent::DebugRequest(message) = &request.message.content else {
            panic!("debug request")
        };
        assert_eq!(message.content["arguments"], json!({"restart":false,"terminateDebuggee":false}));
        request.reply.send(Ok(response(request.seq, &request.command))).unwrap();
        task.await.unwrap().unwrap();
        let a = client.clone();
        let task = tokio::spawn(async move { a.request("threads", json!({}), CancellationToken::new(), true).await });
        let request = requests.recv().await.unwrap();
        assert_eq!(request.seq, 2);
        request.reply.send(Ok(response(request.seq, &request.command))).unwrap();
        task.await.unwrap().unwrap();
    }
    #[tokio::test]
    async fn ark_threads_is_a_unit_variant_and_unsent_requests_do_not_claim_transport() {
        let (client, mut requests) = DebugClient::new("generation".into(), CancellationToken::new());
        *client.info.lock() = Some(json!({"debugger":true,"implementation":"ark"}));
        let a = client.clone();
        let task = tokio::spawn(async move { a.request("threads", json!({}), CancellationToken::new(), true).await });
        let queued = requests.recv().await.unwrap();
        let jupyter_protocol::JupyterMessageContent::DebugRequest(message) = &queued.message.content else {
            panic!("debug request")
        };
        assert_eq!(message.content["arguments"], Value::Null);
        queued.reply.send(Ok(response(queued.seq, &queued.command))).unwrap();
        task.await.unwrap().unwrap();
        assert_eq!(client.mode.load(Ordering::Acquire), 0, "only broker send may claim transport");
        let mut receivers = Vec::new();
        for seq in 0..MAX_PENDING {
            let (request, receiver) = request(seq as u32, "threads");
            receivers.push(receiver);
            assert!(client.requests.try_send(request).is_ok());
        }
        assert!(
            client
                .request("threads", json!({}), CancellationToken::new(), true)
                .await
                .unwrap_err()
                .message
                .contains("queue")
        );
        assert_eq!(client.mode.load(Ordering::Acquire), 0);
        drop(requests);
        assert!(client.request("threads", json!({}), CancellationToken::new(), true).await.is_err());
        assert_eq!(client.mode.load(Ordering::Acquire), 0);
    }
}
