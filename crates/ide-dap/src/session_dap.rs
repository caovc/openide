//! Process-free DAP connection to one existing kernel generation.
use crate::connection::{Connection, Incoming};
use ide_core::{CancellationToken, IdeError, IdeResult};
use serde_json::{Value, json};
use std::time::Duration;
use tokio::sync::broadcast;

pub struct SessionDap {
    connection: Connection,
    events: broadcast::Sender<(String, Value)>,
    closed: CancellationToken,
}

pub struct DapSubscription {
    events: broadcast::Receiver<(String, Value)>,
    closed: CancellationToken,
}

impl DapSubscription {
    pub async fn recv(&mut self) -> IdeResult<(String, Value)> {
        tokio::select! {
            biased;
            _ = self.closed.cancelled() => Err(IdeError::unavailable("kernel DAP session closed")),
            event = self.events.recv() => event.map_err(|e| IdeError::unavailable(format!("DAP event subscription: {e}"))),
        }
    }
}

struct PendingRequest<'a> {
    session: &'a SessionDap,
    completed: bool,
}

impl Drop for PendingRequest<'_> {
    fn drop(&mut self) {
        if !self.completed {
            self.session.connection.close();
            self.session.closed.cancel();
        }
    }
}

impl Drop for SessionDap {
    fn drop(&mut self) {
        self.closed.cancel();
        self.connection.close();
    }
}

impl SessionDap {
    /// DAP wire coordinates are 1-based; callers must convert IDE coordinates.
    pub async fn connect(port: u16, generation: CancellationToken) -> IdeResult<Self> {
        let stream = tokio::select! {
            biased;
            _ = generation.cancelled() => return Err(IdeError::cancelled()),
            stream = tokio::net::TcpStream::connect(("127.0.0.1", port)) => stream.map_err(|e| IdeError::unavailable(e.to_string()))?,
        };
        let (read, write) = stream.into_split();
        let (connection, mut incoming) = Connection::start(read, write);
        let (events, _) = broadcast::channel(64);
        let closed = CancellationToken::new();
        let session = Self { connection: connection.clone(), events: events.clone(), closed: closed.clone() };
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    biased;
                    _ = generation.cancelled() => break,
                    _ = closed.cancelled() => break,
                    message = incoming.recv() => match message {
                        Some(Incoming::Event { event, body }) => { let _ = events.send((event, body)); }
                        Some(Incoming::Request { seq, command, .. }) => {
                            let _ = connection.respond(seq, &command, Err("kernel session cannot launch processes".into()));
                        }
                        Some(Incoming::Closed) | None => break,
                    }
                }
            }
            connection.close();
            closed.cancel();
        });
        session
            .request(
                "initialize",
                json!({"adapterID":"ark", "clientID":"openide", "linesStartAt1":true, "columnsStartAt1":true}),
                CancellationToken::new(),
            )
            .await?;
        session.request("attach", json!({}), CancellationToken::new()).await?;
        Ok(session)
    }

    pub fn subscribe(&self) -> DapSubscription {
        DapSubscription { events: self.events.subscribe(), closed: self.closed.clone() }
    }

    pub fn is_closed(&self) -> bool {
        self.closed.is_cancelled() || self.connection.is_closed()
    }

    /// Cancellation/timeout revokes the transport, so no abandoned DAP request survives.
    pub async fn request(&self, command: &str, arguments: Value, cancel: CancellationToken) -> IdeResult<Value> {
        if self.is_closed() {
            return Err(IdeError::unavailable("kernel DAP session closed"));
        }
        if serde_json::to_vec(&arguments).map_err(|e| IdeError::invalid(e.to_string()))?.len() > 8 * 1024 * 1024 {
            return Err(IdeError::invalid("DAP arguments exceed 8 MiB"));
        }
        // Ark uses a unit enum variant for threads; an arguments object is invalid on that wire.
        let arguments = if command == "threads" { Value::Null } else { arguments };
        let mut pending = PendingRequest { session: self, completed: false };
        let result = tokio::select! {
            biased;
            _ = self.closed.cancelled() => Err(IdeError::unavailable("kernel DAP session closed")),
            _ = cancel.cancelled() => Err(IdeError::cancelled()),
            result = self.connection.request_timeout(command, arguments, Duration::from_secs(30)) => result.map_err(IdeError::from),
        };
        pending.completed =
            result.as_ref().err().is_none_or(|error| error.kind == ide_core::error::ErrorKind::InvalidInput);
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ide_jsonrpc::framing;
    use tokio::io::{AsyncReadExt, BufReader};

    async fn server() -> (u16, tokio::task::JoinHandle<()>, tokio::sync::oneshot::Receiver<()>) {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (sent, received) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (read, mut write) = stream.into_split();
            let mut read = BufReader::new(read);
            for command in ["initialize", "attach"] {
                let request: Value =
                    serde_json::from_slice(&framing::read_message(&mut read).await.unwrap().unwrap()).unwrap();
                assert_eq!(request["command"], command);
                let reply = json!({"seq":1,"type":"response","request_seq":request["seq"],"command":command,"success":true,"body":{}});
                framing::write_message(&mut write, &serde_json::to_vec(&reply).unwrap()).await.unwrap();
            }
            let request = framing::read_message(&mut read).await.unwrap().unwrap();
            assert!(!request.is_empty());
            let _ = sent.send(());
            let mut byte = [0];
            assert_eq!(read.read(&mut byte).await.unwrap(), 0, "TCP transport survived cancellation");
        });
        (port, task, received)
    }

    #[tokio::test]
    async fn generation_stop_cancels_pending_request_and_closes_socket() {
        let (port, server, received) = server().await;
        let generation = CancellationToken::new();
        let dap = SessionDap::connect(port, generation.clone()).await.unwrap();
        let request = dap.request("threads", json!({}), CancellationToken::new());
        let stop = async {
            received.await.unwrap();
            generation.cancel();
        };
        let (result, ()) =
            tokio::time::timeout(Duration::from_secs(2), async { tokio::join!(request, stop) }).await.unwrap();
        assert!(result.is_err());
        assert!(dap.is_closed());
        tokio::time::timeout(Duration::from_secs(2), server).await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn dropped_request_revokes_transport_and_pending_requests() {
        let (port, server, received) = server().await;
        let dap = std::sync::Arc::new(SessionDap::connect(port, CancellationToken::new()).await.unwrap());
        let running = dap.clone();
        let request =
            tokio::spawn(async move { running.request("threads", json!({}), CancellationToken::new()).await });
        received.await.unwrap();
        request.abort();
        assert!(request.await.unwrap_err().is_cancelled());
        assert!(dap.is_closed());
        assert!(dap.request("threads", json!({}), CancellationToken::new()).await.is_err());
        tokio::time::timeout(Duration::from_secs(2), server).await.unwrap().unwrap();
    }
}
