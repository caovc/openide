use ide_core::NullSink;
use ide_host::{Host, HostConfig, ops};
use std::path::Path;
use std::sync::Arc;

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

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn python_inspection_requires_trust_but_renv_metadata_does_not_execute_profiles() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("project");
    std::fs::create_dir_all(root.join("notebooks")).unwrap();
    std::fs::write(root.join("renv.lock"), r#"{"R":{"Version":"4.5.0"},"Packages":{}}"#).unwrap();
    std::fs::write(root.join(".Rprofile"), "stop('must not run')").unwrap();
    let host = host(&temp.path().join("app"));
    assert!(!host.open_project("main", &root).unwrap().is_trusted());
    assert!(host.authorize_command("main", "sdk_python_environment").is_err());
    assert!(ops::sdk::sdk_python_environment(&host, "main", root.join("python")).await.is_err());
    host.authorize_command("main", "notebook_project_environment").unwrap();
    let info =
        ops::notebook::project_environment(&host, "main", Some(root.join("notebooks/analysis.ipynb"))).await.unwrap();
    assert_eq!(info.project_root, root.canonicalize().unwrap().to_string_lossy());
    assert_eq!(info.locked_r_version.as_deref(), Some("4.5.0"));
    assert_eq!(serde_json::to_value(info.renv_status).unwrap(), "detected-inactive");
    host.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn renv_metadata_uses_the_workspace_member_not_the_notebook_subdirectory() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("workspace");
    let member = temp.path().join("member");
    std::fs::create_dir_all(member.join("notebooks")).unwrap();
    std::fs::write(member.join("renv.lock"), r#"{"R":{"Version":"4.4.3"},"Packages":{"testpkg":{}}}"#).unwrap();
    ide_workspace::workspace::Workspace::save(&root, "Science", vec![member.clone()], true).unwrap();
    let host = host(&temp.path().join("app"));
    host.open_project("main", &root).unwrap();
    let info =
        ops::notebook::project_environment(&host, "main", Some(member.join("notebooks/analysis.ipynb"))).await.unwrap();
    assert_eq!(info.project_root, member.canonicalize().unwrap().to_string_lossy());
    assert_eq!(info.locked_package_count, Some(1));
    let fallback = ops::notebook::project_environment(&host, "main", None).await.unwrap();
    assert_eq!(fallback.project_root, root.canonicalize().unwrap().to_string_lossy());
    assert!(!fallback.has_lockfile);
    host.shutdown().await;
}
