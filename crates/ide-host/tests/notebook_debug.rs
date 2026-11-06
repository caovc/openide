use ide_core::{CancellationToken, NullSink, RequestId, error::ErrorKind};
use ide_host::{
    Host, HostConfig,
    notebook::{NotebookDebugQuery, NotebookService},
    ops,
};
use serde_json::{Value, json};
use std::{path::Path, sync::Arc, time::Duration};

fn host(base: &Path) -> Arc<Host> {
    Arc::new(Host::new(HostConfig {
        config_dir: base.join("config"),
        data_dir: base.join("data"),
        local_data_dir: base.join("data"),
        languages: Arc::new(ide_language::LanguageRegistry::load(None).unwrap()),
        syntax: Arc::default(),
        sink_for: Box::new(|_| Arc::new(NullSink)),
        owner: |window| window,
        runtime: tokio::runtime::Handle::current(),
        project_environment: false,
    }))
}

fn query(token: &str, command: &str, arguments: Value) -> NotebookDebugQuery {
    NotebookDebugQuery { token: token.into(), command: command.into(), arguments }
}

#[tokio::test]
async fn debug_commands_require_trust_without_starting_a_kernel() {
    let temp = tempfile::tempdir().unwrap();
    let host = host(temp.path());
    host.open_project("main", temp.path()).unwrap();
    let document = ops::notebook::open(&host, "main", "openide-console:debug".into()).await.unwrap();
    let capabilities =
        ops::notebook::debug_capabilities(&host, "main", document.id.clone(), "unknown".into()).unwrap_err();
    let request = ops::notebook::debug_request(
        &host,
        "main",
        document.id.clone(),
        query("unknown", "debugInfo", json!({})),
        RequestId::next(),
    )
    .await
    .unwrap_err();
    let events = ops::notebook::debug_events(
        &host,
        "main",
        document.id.clone(),
        "unknown".into(),
        RequestId::next(),
        ops::Channel::new(|_| panic!("restricted subscription must not emit")),
    )
    .await
    .unwrap_err();
    for error in [capabilities, request, events] {
        assert_eq!(error.kind, ErrorKind::Unavailable);
        assert!(error.message.contains("Restricted Mode"));
    }
    assert_eq!(
        serde_json::to_value(&document).unwrap(),
        serde_json::to_value(host.project("main").unwrap().notebooks.get(&document.id).unwrap()).unwrap()
    );
    host.shutdown().await;
}

#[tokio::test]
async fn invalid_or_cancelled_debug_requests_do_not_start_a_kernel() {
    let temp = tempfile::tempdir().unwrap();
    let service = NotebookService::new(temp.path().join("runtime"), Arc::new(NullSink));
    let document = service.open_console(temp.path(), "debug").unwrap();
    for arguments in [Value::Null, json!([]), json!({"code": "x".repeat(1024 * 1024)})] {
        let error = service
            .debug_request(&document.id, query("unknown", "dumpCell", arguments), CancellationToken::new())
            .await
            .unwrap_err();
        assert_eq!(error.kind, ErrorKind::InvalidInput);
    }
    let cancel = CancellationToken::new();
    cancel.cancel();
    assert_eq!(
        service
            .debug_request(&document.id, query("unknown", "debugInfo", json!({})), cancel.clone())
            .await
            .unwrap_err()
            .kind,
        ErrorKind::Cancelled
    );
    assert_eq!(
        service
            .debug_events(
                &document.id,
                "unknown",
                cancel,
                ops::Channel::new(|_| panic!("cancelled subscription must not emit"))
            )
            .await
            .unwrap_err()
            .kind,
        ErrorKind::Cancelled
    );
    assert!(service.debug_capabilities(&document.id, "unknown").is_err());
    assert!(!temp.path().join("runtime").exists());
    service.close(&document.id).await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires explicit Python/ipykernel or Ark/R runtime"]
async fn real_debug_contract_binds_tokens_and_subscribes_before_initialize() {
    let ark = std::env::var("OPENIDE_B1_RUNTIME").unwrap_or_else(|_| "python".into()) == "ark";
    let selection = if ark {
        ide_notebook::discover::encode_ark(
            Path::new(&std::env::var("OPENIDE_ARK").unwrap()),
            Path::new(&std::env::var("R_HOME").unwrap()),
        )
    } else {
        std::env::var("OPENIDEA_TEST_PYTHON").unwrap()
    };
    let temp = tempfile::tempdir().unwrap();
    let host = host(temp.path());
    host.open_project("main", temp.path()).unwrap();
    host.set_project_trust(temp.path(), true, false).await.unwrap();
    let a = ops::notebook::open(&host, "main", "openide-console:debug-a".into()).await.unwrap();
    let b = ops::notebook::open(&host, "main", "openide-console:debug-b".into()).await.unwrap();
    let a_session =
        ops::notebook::start_kernel(&host, "main", a.id.clone(), selection.clone(), RequestId::next()).await.unwrap();
    let b_session =
        ops::notebook::start_kernel(&host, "main", b.id.clone(), selection.clone(), RequestId::next()).await.unwrap();
    let capabilities = ops::notebook::debug_capabilities(&host, "main", a.id.clone(), a_session.token.clone()).unwrap();
    assert!(capabilities.debugger);
    assert_eq!(capabilities.token, a_session.token);
    assert!(capabilities.kernel_info.is_object());
    assert!(ops::notebook::debug_capabilities(&host, "main", b.id.clone(), a_session.token.clone()).is_err());
    assert!(
        ops::notebook::debug_request(
            &host,
            "main",
            b.id.clone(),
            query(&a_session.token, "debugInfo", json!({})),
            RequestId::next()
        )
        .await
        .is_err()
    );
    assert!(
        ops::notebook::debug_events(
            &host,
            "main",
            b.id.clone(),
            a_session.token.clone(),
            RequestId::next(),
            ops::Channel::new(|_| panic!("cross-document token must not emit"))
        )
        .await
        .is_err()
    );
    for (command, arguments) in [
        ("restart", json!({})),
        ("launch", json!({})),
        ("disconnect", json!({"terminateDebuggee":true})),
        ("disconnect", json!({"restart":true})),
    ] {
        assert!(
            ops::notebook::debug_request(
                &host,
                "main",
                a.id.clone(),
                query(&a_session.token, command, arguments),
                RequestId::next()
            )
            .await
            .is_err()
        );
    }
    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
    let subscription_request = RequestId::next();
    let subscription = {
        let host = host.clone();
        let id = a.id.clone();
        let token = a_session.token.clone();
        tokio::spawn(async move {
            ops::notebook::debug_events(
                &host,
                "main",
                id,
                token,
                subscription_request,
                ops::Channel::new(move |event| {
                    let _ = sender.send(event);
                }),
            )
            .await
        })
    };
    let ready = tokio::time::timeout(Duration::from_secs(5), receiver.recv()).await.unwrap().unwrap();
    assert_eq!(ready.event, "ready");
    assert_eq!(ready.sequence, 0);
    assert_eq!(ready.token, a_session.token);
    let initialize = ops::notebook::debug_request(&host, "main", a.id.clone(), query(&a_session.token, "initialize", json!({"clientID":"openide-host-test","adapterID":if ark {"ark"} else {"python"},"linesStartAt1":true,"columnsStartAt1":true})), RequestId::next()).await.unwrap();
    assert_eq!(initialize.token, a_session.token);
    assert_eq!(initialize.response["command"], "initialize");
    assert_eq!(initialize.response["success"], true);
    let attach = if !ark {
        let host = host.clone();
        let id = a.id.clone();
        let token = a_session.token.clone();
        Some(tokio::spawn(async move {
            ops::notebook::debug_request(
                &host,
                "main",
                id,
                query(&token, "attach", json!({"justMyCode":false})),
                RequestId::next(),
            )
            .await
        }))
    } else {
        None
    };
    tokio::time::timeout(Duration::from_secs(15), async {
        let mut sequence = 0;
        loop {
            let event = receiver.recv().await.unwrap();
            assert_eq!(event.token, a_session.token);
            assert!(event.sequence > sequence);
            sequence = event.sequence;
            if event.event == "initialized" {
                break;
            }
        }
    })
    .await
    .unwrap();
    if let Some(attach) = attach {
        let configured = ops::notebook::debug_request(
            &host,
            "main",
            a.id.clone(),
            query(&a_session.token, "configurationDone", json!({})),
            RequestId::next(),
        )
        .await
        .unwrap();
        assert_eq!(configured.response["success"], true);
        let attached = tokio::time::timeout(Duration::from_secs(15), attach).await.unwrap().unwrap().unwrap();
        assert_eq!(attached.response["success"], true);
    }
    host.cancel_request(subscription_request);
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(5), subscription).await.unwrap().unwrap().unwrap_err().kind,
        ErrorKind::Cancelled
    );
    host.project("main").unwrap().notebooks.validate_kernel_session(&a.id, &a_session.token).unwrap();
    // Restart revokes the old token without affecting another document's session.
    ops::notebook::restart(&host, "main", a.id.clone()).await.unwrap();
    let fresh = ops::notebook::start_kernel(&host, "main", a.id.clone(), selection, RequestId::next()).await.unwrap();
    assert_ne!(fresh.token, a_session.token);
    assert!(
        ops::notebook::debug_request(
            &host,
            "main",
            a.id.clone(),
            query(&a_session.token, "debugInfo", json!({})),
            RequestId::next()
        )
        .await
        .is_err()
    );
    assert!(ops::notebook::debug_capabilities(&host, "main", a.id.clone(), a_session.token).is_err());
    assert!(ops::notebook::debug_capabilities(&host, "main", b.id, b_session.token).unwrap().debugger);
    assert_eq!(
        serde_json::to_value(&a).unwrap(),
        serde_json::to_value(host.project("main").unwrap().notebooks.get(&a.id).unwrap()).unwrap()
    );
    host.shutdown().await;
}
