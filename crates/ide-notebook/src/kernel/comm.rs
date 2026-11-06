//! JSON comm transport shared by session services (including Ark LSP).
//! Comm events are independent of execute parents and never enter cell output.
use ide_core::{CancellationToken, IdeError, IdeResult};
use jupyter_protocol::{CommClose, CommId, CommMsg, CommOpen, JupyterMessage};
use serde_json::Value;
use tokio::sync::{broadcast, mpsc, oneshot};

#[derive(Clone, Debug)]
pub struct CommEvent {
    pub kind: String,
    pub comm_id: String,
    pub parent_id: String,
    pub content: Value,
}

pub(crate) struct CommRequest {
    pub message: JupyterMessage,
    pub reply: oneshot::Sender<IdeResult<()>>,
}

pub(super) struct InputReplyRequest {
    pub id: String,
    pub value: Option<String>,
    pub reply: oneshot::Sender<IdeResult<()>>,
}

/// Bound to one process generation. Shutdown closes send and receive operations.
#[derive(Clone)]
pub struct KernelComms {
    pub(super) session: std::sync::Arc<crate::session::SessionData>,
    pub(super) requests: mpsc::Sender<CommRequest>,
    pub(super) events: broadcast::Sender<CommEvent>,
    pub(super) stop: CancellationToken,
    pub(super) runtime: super::KernelRuntime,
    pub(super) dap: std::sync::Arc<tokio::sync::OnceCell<ide_dap::session_dap::SessionDap>>,
    pub(super) input: mpsc::Sender<InputReplyRequest>,
    pub(super) lsp: std::sync::Arc<tokio::sync::OnceCell<ide_lsp::session::SessionLsp>>,
}

pub struct CommSubscription {
    events: broadcast::Receiver<CommEvent>,
    stop: CancellationToken,
}

impl CommSubscription {
    /// Lag is explicit: callers must resynchronize rather than silently lose events.
    pub async fn recv(&mut self) -> IdeResult<CommEvent> {
        tokio::select! {
            biased;
            _ = self.stop.cancelled() => Err(IdeError::unavailable("kernel comm session closed")),
            event = self.events.recv() => event.map_err(|e| IdeError::unavailable(format!("kernel comm subscription: {e}"))),
        }
    }
}

struct OpeningService {
    comms: KernelComms,
    id: String,
    connected: bool,
}

impl Drop for OpeningService {
    fn drop(&mut self) {
        if !self.connected && !self.comms.is_closed() {
            let comms = self.comms.clone();
            let id = self.id.clone();
            tokio::spawn(async move {
                let _ = comms.close(&id, serde_json::json!({})).await;
            });
        }
    }
}

impl KernelComms {
    pub fn session(&self) -> &std::sync::Arc<crate::session::SessionData> {
        &self.session
    }

    pub fn runtime(&self) -> &super::KernelRuntime {
        &self.runtime
    }

    /// One lazy LSP connection per generation, shared by split views and requests.
    pub async fn ark_lsp(&self) -> IdeResult<&ide_lsp::session::SessionLsp> {
        if !matches!(self.runtime, super::KernelRuntime::Ark { .. }) || self.is_closed() {
            return Err(IdeError::unavailable("a running Ark session is required for R LSP"));
        }
        self.lsp
            .get_or_try_init(|| async {
                let id = uuid::Uuid::new_v4().to_string();
                let mut opening = OpeningService { comms: self.clone(), id: id.clone(), connected: false };
                let mut events = self.subscribe();
                self.open(&id, "positron.lsp", serde_json::json!({"ip_address":"127.0.0.1"})).await?;
                let result = tokio::time::timeout(std::time::Duration::from_secs(30), async {
                    loop {
                        let event = events.recv().await?;
                        if event.comm_id != id {
                            continue;
                        }
                        if event.kind == "comm_close" {
                            return Err(IdeError::unavailable("Ark rejected LSP comm"));
                        }
                        if event.kind == "comm_msg" && event.content["data"]["msg_type"] == "server_started" {
                            let port = event.content["data"]["content"]["port"]
                                .as_u64()
                                .and_then(|p| u16::try_from(p).ok())
                                .filter(|p| *p != 0)
                                .ok_or_else(|| IdeError::unavailable("invalid Ark LSP port"))?;
                            return ide_lsp::session::SessionLsp::connect(port, self.stop.clone()).await;
                        }
                    }
                })
                .await
                .map_err(|_| IdeError::unavailable("Ark LSP comm timed out"))?;
                opening.connected = result.is_ok();
                result
            })
            .await
    }

    /// Reply once to the current prompt; None cancels the execution, not an empty answer.
    pub async fn input_reply(&self, id: String, value: Option<String>) -> IdeResult<()> {
        if value.as_ref().is_some_and(|v| v.len() > 1024 * 1024) {
            return Err(IdeError::invalid("stdin reply exceeds 1 MiB"));
        }
        let (reply, result) = oneshot::channel();
        tokio::select! {
            biased;
            _ = self.stop.cancelled() => Err(IdeError::unavailable("kernel session closed")),
            result = async {
                self.input.try_send(InputReplyRequest { id, value, reply }).map_err(|_| IdeError::unavailable("stdin queue full or closed"))?;
                result.await.unwrap_or_else(|_| Err(IdeError::unavailable("stdin task stopped")))
            } => result,
        }
    }

    /// Attach to Ark's own DAP server, never spawn an adapter or another R.
    pub async fn ark_dap(&self) -> IdeResult<&ide_dap::session_dap::SessionDap> {
        if !matches!(self.runtime, super::KernelRuntime::Ark { .. }) || self.is_closed() {
            return Err(IdeError::unavailable("a running Ark session is required for R DAP"));
        }
        self.dap
            .get_or_try_init(|| async {
                let id = uuid::Uuid::new_v4().to_string();
                let mut opening = OpeningService { comms: self.clone(), id: id.clone(), connected: false };
                let mut events = self.subscribe();
                self.open(&id, "ark_dap", serde_json::json!({"ip_address":"127.0.0.1"})).await?;
                let result = tokio::time::timeout(std::time::Duration::from_secs(30), async {
                    loop {
                        let event = events.recv().await?;
                        if event.comm_id != id {
                            continue;
                        }
                        if event.kind == "comm_close" {
                            return Err(IdeError::unavailable("Ark rejected DAP comm"));
                        }
                        if event.kind == "comm_msg" && event.content["data"]["method"] == "server_started" {
                            let port = event.content["data"]["params"]["port"]
                                .as_u64()
                                .and_then(|p| u16::try_from(p).ok())
                                .filter(|p| *p != 0)
                                .ok_or_else(|| IdeError::unavailable("invalid Ark DAP port"))?;
                            return ide_dap::session_dap::SessionDap::connect(port, self.stop.clone()).await;
                        }
                    }
                })
                .await
                .map_err(|_| IdeError::unavailable("Ark DAP comm timed out"))?;
                opening.connected = result.is_ok();
                result
            })
            .await
    }

    pub fn is_closed(&self) -> bool {
        self.stop.is_cancelled() || self.requests.is_closed()
    }

    pub fn subscribe(&self) -> CommSubscription {
        CommSubscription { events: self.events.subscribe(), stop: self.stop.clone() }
    }

    pub async fn open(&self, comm_id: &str, target: &str, data: Value) -> IdeResult<()> {
        self.send(
            CommOpen {
                comm_id: CommId(comm_id.into()),
                target_name: target.into(),
                data: object(data)?,
                target_module: None,
            }
            .into(),
        )
        .await
    }

    pub async fn send_message(&self, comm_id: &str, data: Value) -> IdeResult<()> {
        self.send(CommMsg { comm_id: CommId(comm_id.into()), data: object(data)? }.into()).await
    }

    /// Send a JSON-RPC-shaped comm message whose Jupyter header msg_id equals `id`.
    /// Ark requires that match for RPC parenting; data must also carry the same `id`.
    pub async fn send_rpc(&self, comm_id: &str, id: &str, data: Value) -> IdeResult<()> {
        let mut message: JupyterMessage = CommMsg { comm_id: CommId(comm_id.into()), data: object(data)? }.into();
        message.header.msg_id = id.into();
        self.send(message).await
    }

    pub async fn close(&self, comm_id: &str, data: Value) -> IdeResult<()> {
        self.send(CommClose { comm_id: CommId(comm_id.into()), data: object(data)? }.into()).await
    }

    async fn send(&self, message: JupyterMessage) -> IdeResult<()> {
        if serde_json::to_vec(&message).map_err(|e| IdeError::invalid(e.to_string()))?.len() > 8 * 1024 * 1024 {
            return Err(IdeError::invalid("kernel comm request exceeds 8 MiB"));
        }
        let (reply, result) = oneshot::channel();
        tokio::select! {
            biased;
            _ = self.stop.cancelled() => Err(IdeError::unavailable("kernel comm session closed")),
            result = async {
                self.requests.try_send(CommRequest { message, reply })
                    .map_err(|_| IdeError::unavailable("kernel comm queue full or session closed"))?;
                result.await.unwrap_or_else(|_| Err(IdeError::unavailable("kernel comm task stopped")))
            } => result,
        }
    }
}

fn object(data: Value) -> IdeResult<serde_json::Map<String, Value>> {
    match data {
        Value::Object(data) => Ok(data),
        _ => Err(IdeError::invalid("kernel comm data must be a JSON object")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn channel() -> (KernelComms, mpsc::Receiver<CommRequest>) {
        let (requests, receiver) = mpsc::channel(1);
        let (events, _) = broadcast::channel(1);
        let stop = CancellationToken::new();
        let runtime = super::super::KernelRuntime::python("python");
        let session = crate::session::SessionData::new(
            std::path::PathBuf::from("comm-tests"),
            std::path::PathBuf::from(uuid::Uuid::new_v4().to_string()),
            &runtime,
            stop.clone(),
            requests.clone(),
        );
        (
            KernelComms {
                session,
                requests,
                events,
                stop,
                runtime,
                lsp: Default::default(),
                dap: Default::default(),
                input: mpsc::channel(1).0,
            },
            receiver,
        )
    }

    #[tokio::test]
    async fn closed_generation_rejects_send_and_wakes_subscribers() {
        let (comms, _receiver) = channel();
        let mut events = comms.subscribe();
        comms.stop.cancel();
        assert!(comms.is_closed());
        assert!(events.recv().await.is_err());
        assert!(comms.open("id", "target", json!({})).await.is_err());
        assert!(comms.send_message("id", json!({})).await.is_err());
        assert!(comms.close("id", json!({})).await.is_err());
    }

    #[tokio::test]
    async fn lag_is_reported_and_non_object_data_is_rejected() {
        let (comms, _receiver) = channel();
        assert!(comms.open("id", "target", Value::Null).await.is_err());
        assert!(comms.send_message("id", json!([])).await.is_err());
        assert!(comms.close("id", json!(42)).await.is_err());
        let mut events = comms.subscribe();
        for _ in 0..2 {
            comms
                .events
                .send(CommEvent {
                    kind: "comm_msg".into(),
                    comm_id: "id".into(),
                    parent_id: String::new(),
                    content: json!({}),
                })
                .unwrap();
        }
        assert!(events.recv().await.unwrap_err().message.contains("lagged"));
    }

    #[tokio::test]
    async fn oversized_requests_are_rejected_before_queueing() {
        let (comms, mut receiver) = channel();
        let error = comms.send_message("id", json!({"value":"x".repeat(8 * 1024 * 1024)})).await.unwrap_err();
        assert!(error.message.contains("8 MiB"));
        assert!(receiver.try_recv().is_err());
    }

    #[tokio::test]
    async fn transport_failure_is_returned_to_the_sender_without_retry() {
        let (comms, mut receiver) = channel();
        let sender = tokio::spawn(async move { comms.send_message("id", json!({"x":42})).await });
        let request = receiver.recv().await.unwrap();
        assert_eq!(request.message.header.msg_type, "comm_msg");
        request.reply.send(Err(IdeError::unavailable("test send failure"))).unwrap();
        assert_eq!(sender.await.unwrap().unwrap_err().message, "test send failure");
        assert!(receiver.try_recv().is_err());
    }
    #[tokio::test]
    async fn abandoned_lsp_open_closes_its_comm_and_python_never_opens_one() {
        let (mut comms, mut receiver) = channel();
        assert!(comms.ark_lsp().await.is_err());
        assert!(receiver.try_recv().is_err());
        comms.runtime = super::super::KernelRuntime::Ark { executable: "/ark".into(), r_home: "/R".into() };
        let task = tokio::spawn(async move { comms.ark_lsp().await.map(|_| ()) });
        let open = receiver.recv().await.unwrap();
        assert_eq!(open.message.header.msg_type, "comm_open");
        open.reply.send(Ok(())).unwrap();
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        let close = tokio::time::timeout(std::time::Duration::from_secs(1), receiver.recv()).await.unwrap().unwrap();
        assert_eq!(close.message.header.msg_type, "comm_close");
        close.reply.send(Ok(())).unwrap();
    }
}
