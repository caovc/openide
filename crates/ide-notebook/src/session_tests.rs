use super::*;

fn data(path: &Path) -> Arc<SessionData> {
    let (send, _receive) = mpsc::channel(1);
    SessionData::new(
        path.parent().unwrap().into(),
        path.into(),
        &KernelRuntime::python("python"),
        CancellationToken::new(),
        send,
    )
}

fn var(key: &str, value: &str) -> Value {
    json!({"access_key":key,"display_name":key,"display_value":value,"display_type":"list","has_children":true})
}

fn event(data: &SessionData, method: &str, params: Value) {
    data.observe("comm_msg", &json!({"comm_id":data.comm_id,"data":{"method":method,"params":params}}), "");
}

#[test]
fn refresh_updates_deletes_and_separates_generations() {
    let root = tempfile::tempdir().unwrap();
    let a = data(&root.path().join("a"));
    let b = data(&root.path().join("b"));
    event(&a, "refresh", json!({"variables":[var("x", "old")],"length":1}));
    event(&b, "refresh", json!({"variables":[var("x", "other")],"length":1}));
    let initial = a.snapshot().unwrap();
    event(&a, "update", json!({"assigned":[var("y", "new")],"removed":["x"]}));
    assert_eq!(
        a.snapshot().unwrap().variables,
        vec![
            serde_json::from_value::<SessionVariable>(
                json!({"key":"y","name":"y","typeName":"list","summary":"new","hasChildren":true})
            )
            .unwrap()
        ]
    );
    assert!(a.validate(&initial.generation, initial.revision).is_err());
    assert_eq!(b.snapshot().unwrap().variables[0].summary, "other");
    a.stop.cancel();
    a.observe("display_data", &json!({"data":{"image/png":"old"}}), "late");
    event(&a, "refresh", json!({"variables":[var("late", "bad")],"length":1}));
    assert!(a.snapshot().is_err());
    assert!(SessionData::for_owner_path(&a.owner, &a.path).unwrap().is_none());
    let restarted = data(&a.path);
    let reset = restarted.snapshot().unwrap();
    assert_ne!(reset.generation, initial.generation);
    assert!(reset.variables.is_empty() && reset.plots.is_empty() && !reset.ready);
    assert_eq!(b.snapshot().unwrap().variables[0].summary, "other");
}

#[test]
fn same_path_managers_fail_closed_and_expired_owners_are_removed() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("shared");
    let a = data(&path);
    let b = data(&path);
    assert!(SessionData::for_owner_path(root.path(), &path).is_err());
    a.stop.cancel();
    assert!(Arc::ptr_eq(&SessionData::for_owner_path(root.path(), &path).unwrap().unwrap(), &b));
    drop(b);
    assert!(SessionData::for_owner_path(root.path(), &path).unwrap().is_none());
}

#[test]
fn same_file_in_different_project_instances_never_borrows_data() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("same.ipynb");
    let (send, _receive) = mpsc::channel(1);
    let a = SessionData::new(
        root.path().join("project-a"),
        path.clone(),
        &KernelRuntime::python("python"),
        CancellationToken::new(),
        send.clone(),
    );
    event(&a, "refresh", json!({"variables":[var("a", "private-a")],"length":1}));
    assert!(SessionData::for_owner_path(&root.path().join("project-b"), &path).unwrap().is_none());
    let b = SessionData::new(
        root.path().join("project-b"),
        path.clone(),
        &KernelRuntime::python("python"),
        CancellationToken::new(),
        send,
    );
    event(&b, "refresh", json!({"variables":[var("b", "private-b")],"length":1}));
    assert_eq!(
        SessionData::for_owner_path(&a.owner, &path).unwrap().unwrap().snapshot().unwrap().variables[0].summary,
        "private-a"
    );
    assert_eq!(
        SessionData::for_owner_path(&b.owner, &path).unwrap().unwrap().snapshot().unwrap().variables[0].summary,
        "private-b"
    );
}

#[test]
fn ark_versions_reject_out_of_order_refresh_and_update() {
    let root = tempfile::tempdir().unwrap();
    let a = data(&root.path().join("a"));
    event(&a, "refresh", json!({"variables":[var("x", "current")],"length":1,"version":3}));
    let revision = a.snapshot().unwrap().revision;
    event(&a, "refresh", json!({"variables":[var("old", "stale")],"length":1,"version":2}));
    event(&a, "update", json!({"assigned":[var("old", "duplicate")],"version":3}));
    assert_eq!(a.snapshot().unwrap().revision, revision);
    assert_eq!(a.snapshot().unwrap().variables[0].summary, "current");
}

#[test]
fn plot_display_updates_history_limits_and_comm_images() {
    let root = tempfile::tempdir().unwrap();
    let a = data(&root.path().join("a"));
    for i in 0..60 {
        a.observe(
            "display_data",
            &json!({"data":{"image/png":"image"},"transient":{"display_id":i.to_string()}}),
            "execution",
        );
    }
    let snapshot = a.snapshot().unwrap();
    assert_eq!(snapshot.plots.len(), MAX_PLOTS);
    assert_eq!(snapshot.plots[0].id, "10");
    a.observe(
        "update_display_data",
        &json!({"data":{"image/png":"changed"},"transient":{"display_id":"59"}}),
        "update",
    );
    assert_eq!(a.snapshot().unwrap().plots.last().unwrap().data, "changed");
    a.observe(
        "update_display_data",
        &json!({"data":{"image/png":"late"},"transient":{"display_id":"evicted"}}),
        "late",
    );
    assert_eq!(a.snapshot().unwrap().plots.len(), MAX_PLOTS);
    a.observe("comm_open", &json!({"comm_id":"arkplot","target_name":"positron.plot","data":{"pre_render":{"mime_type":"image/png","data":"ark-image"}}}), "ark-execution");
    a.observe("comm_msg", &json!({"comm_id":"arkplot","data":{"method":"update","params":{"pre_render":{"mime_type":"image/png","data":"ark-update"}}}}), "ark-update");
    assert_eq!(a.snapshot().unwrap().plots.last().unwrap().data, "ark-update");
    a.plot("large1".into(), "image/png", &"a".repeat(MAX_PLOT_BYTES / 2 + 1), "", false);
    a.plot("large2".into(), "image/png", &"b".repeat(MAX_PLOT_BYTES / 2 + 1), "", false);
    assert_eq!(a.snapshot().unwrap().plots.len(), 1);
    a.plot("script".into(), "text/html", "<script/>", "", false);
    assert_eq!(a.snapshot().unwrap().plots.len(), 1);
}

#[tokio::test]
async fn ark_parent_and_python_data_id_correlate_and_restart_cancels_inspect() {
    let root = tempfile::tempdir().unwrap();
    let (send, mut receive) = mpsc::channel(2);
    let a = SessionData::new(
        root.path().into(),
        root.path().join("a"),
        &KernelRuntime::python("python"),
        CancellationToken::new(),
        send,
    );
    let snapshot = a.snapshot().unwrap();
    for python in [false, true] {
        let copy = a.clone();
        let generation = snapshot.generation.clone();
        let request = tokio::spawn(async move { copy.inspect(&generation, 0, vec!["x".into()]).await });
        let sent = receive.recv().await.unwrap();
        let id = sent.message.header.msg_id;
        let content = serde_json::to_value(&sent.message.content).unwrap();
        assert_eq!(content["data"]["id"], id);
        sent.reply.send(Ok(())).unwrap();
        let mut payload = json!({"method":"InspectReply","result":{"children":[var("child", "42")],"length":1}});
        if python {
            payload["id"] = json!(id);
        }
        a.observe("comm_msg", &json!({"comm_id":"wrong","data":payload}), &id);
        assert!(!request.is_finished());
        a.observe("comm_msg", &json!({"comm_id":a.comm_id,"data":payload}), &id);
        assert_eq!(request.await.unwrap().unwrap().variables[0].summary, "42");
    }
    let copy = a.clone();
    let request = tokio::spawn(async move { copy.inspect(&snapshot.generation, 0, vec!["x".into()]).await });
    let sent = receive.recv().await.unwrap();
    sent.reply.send(Ok(())).unwrap();
    a.stop.cancel();
    assert!(request.await.unwrap().is_err());
    assert!(a.pending.lock().is_empty());
}

#[tokio::test]
async fn in_flight_inspection_rejects_mutated_variables_and_cleans_abandoned_requests() {
    let root = tempfile::tempdir().unwrap();
    let (send, mut receive) = mpsc::channel(2);
    let a = SessionData::new(
        root.path().into(),
        root.path().join("a"),
        &KernelRuntime::python("python"),
        CancellationToken::new(),
        send,
    );
    let generation = a.snapshot().unwrap().generation;
    let copy = a.clone();
    let gen_copy = generation.clone();
    let request = tokio::spawn(async move { copy.inspect(&gen_copy, 0, vec!["x".into()]).await });
    let sent = receive.recv().await.unwrap();
    let id = sent.message.header.msg_id;
    sent.reply.send(Ok(())).unwrap();
    event(&a, "refresh", json!({"variables":[var("new", "value")],"length":1}));
    a.observe(
        "comm_msg",
        &json!({"comm_id":a.comm_id,"data":{"result":{"children":[var("old", "stale")],"length":1}}}),
        &id,
    );
    assert!(request.await.unwrap().is_err());
    let copy = a.clone();
    let request = tokio::spawn(async move { copy.inspect(&generation, 1, vec!["x".into()]).await });
    let sent = receive.recv().await.unwrap();
    sent.reply.send(Ok(())).unwrap();
    request.abort();
    assert!(request.await.unwrap_err().is_cancelled());
    assert!(a.pending.lock().is_empty());
}
