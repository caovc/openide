use ide_core::{CancellationToken, Pos};
use ide_jsonrpc::framing::{read_message, write_message};
use ide_lsp::session::{SessionFeature, SessionLsp};
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};
use tokio::{io::BufReader, net::TcpListener, sync::mpsc, time::timeout};

async fn endpoint(name: &'static str) -> (u16, mpsc::Receiver<Value>, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let (tx, rx) = mpsc::channel(16);
    let task = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let (read, mut write) = stream.into_split();
        let mut read = BufReader::new(read);
        while let Some(body) = read_message(&mut read).await.unwrap() {
            let message: Value = serde_json::from_slice(&body).unwrap();
            if message["method"] == "initialize" {
                write_message(&mut write, &serde_json::to_vec(&json!({"jsonrpc":"2.0","id":message["id"],"result":{"serverInfo":{"name":name},"capabilities":{}}})).unwrap()).await.unwrap();
            }
            tx.send(message).await.unwrap();
        }
    });
    (port, rx, task)
}

async fn until(rx: &mut mpsc::Receiver<Value>, method: &str) -> Value {
    timeout(Duration::from_secs(2), async {
        loop {
            let message = rx.recv().await.unwrap();
            if message["method"] == method {
                return message;
            }
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn session_stop_cancels_pending_query_and_closes_tcp_without_a_child() {
    let (port, mut rx, task) = endpoint("Ark R Kernel").await;
    let stop = CancellationToken::new();
    let client = Arc::new(SessionLsp::connect(port, stop.clone()).await.unwrap());
    let request = {
        let client = client.clone();
        tokio::spawn(async move {
            client
                .query("file:///cell.R", "mean(1)", Pos::new(0, 1), SessionFeature::Hover, CancellationToken::new())
                .await
        })
    };
    until(&mut rx, "textDocument/hover").await;
    stop.cancel();
    assert!(timeout(Duration::from_secs(2), request).await.unwrap().unwrap().is_err());
    timeout(Duration::from_secs(2), task).await.unwrap().unwrap();
    assert!(
        client
            .query("file:///cell.R", "mean(1)", Pos::new(0, 1), SessionFeature::Hover, CancellationToken::new())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn caller_cancel_sends_cancel_request_but_keeps_session_open() {
    let (port, mut rx, task) = endpoint("Ark R Kernel").await;
    let stop = CancellationToken::new();
    let client = Arc::new(SessionLsp::connect(port, stop.clone()).await.unwrap());
    let cancel = CancellationToken::new();
    let request = {
        let client = client.clone();
        let cancel = cancel.clone();
        tokio::spawn(async move {
            client.query("file:///cell.R", "mean(1)", Pos::new(0, 1), SessionFeature::Hover, cancel).await
        })
    };
    let request_id = until(&mut rx, "textDocument/hover").await["id"].clone();
    cancel.cancel();
    assert!(timeout(Duration::from_secs(2), request).await.unwrap().unwrap().is_err());
    assert_eq!(until(&mut rx, "$/cancelRequest").await["params"]["id"], request_id);
    assert!(!task.is_finished());
    stop.cancel();
    timeout(Duration::from_secs(2), task).await.unwrap().unwrap();
}

#[tokio::test]
async fn non_ark_endpoint_is_rejected_and_disconnected() {
    let (port, _rx, task) = endpoint("unbound R languageserver").await;
    assert!(SessionLsp::connect(port, CancellationToken::new()).await.is_err());
    timeout(Duration::from_secs(2), task).await.unwrap().unwrap();
}
