#[allow(unused_imports)]
use super::*;
use crate::Host;
use crate::rpc::Dispatcher;
use ide_core::{IdeError, IdeResult};
use ide_run::RunConfig;
use ide_run::import::{RunImport, RunImportSource};

pub async fn run_dotnet_resolve(host: &Host, window: &str, config: RunConfig, debug: bool) -> IdeResult<RunConfig> {
    host.require_trust(window)?;
    if !matches!(config.kind.as_str(), "dotnet" | "dotnet-test")
        || config.extras.target.as_ref().is_some_and(|s| !s.is_empty())
    {
        return Err(IdeError::invalid(".NET Project requires the local machine"));
    }
    let project = host.project(window)?;
    let mut config = host.blocking(move || ide_run::dotnet::resolve(&project.root, config)).await?;
    if debug {
        let root = host.project(window)?.root.clone();
        let target = ide_run::dotnet::target_path(&root, &config).await?;
        config.extras.params.insert("targetPath".into(), target);
    }
    Ok(config)
}

/// Configuration templates: per-type defaults applied to new configurations.
pub fn run_templates(host: &Host, window: &str) -> IdeResult<Vec<RunConfig>> {
    let root = host.project(window)?.root.clone();
    ide_run::load_templates(&root)
}

pub fn run_save_templates(host: &Host, window: &str, templates: Vec<RunConfig>) -> IdeResult<()> {
    let root = host.project(window)?.root.clone();
    ide_run::save_templates(&root, &templates)
}

/// Project files run configurations can be imported from (`.vscode/launch.json`).
pub fn run_import_sources(host: &Host, window: &str) -> IdeResult<Vec<RunImportSource>> {
    let root = host.project(window)?.root.clone();
    Ok(ide_run::import::available(&root))
}

/// Configurations read from `source`, not saved; names already in `existing` (the
/// configurations being edited) are skipped.
pub fn run_import_configs(
    host: &Host,
    window: &str,
    source: RunImportSource,
    existing: Vec<RunConfig>,
) -> IdeResult<RunImport> {
    host.require_trust(window)?;
    let root = host.project(window)?.root.clone();
    ide_run::import_configs(&root, source, &existing)
}

/// The environment runs inherit when "Include system environment variables" is on.
pub fn run_system_env(_host: &Host, _window: &str) -> std::collections::BTreeMap<String, String> {
    ide_run::system_env()
}

/// Commands of this module the remote server answers.
pub(crate) fn register(d: &mut Dispatcher) {
    d.add("run_dotnet_resolve", |c| async move {
        run_dotnet_resolve(&c.host, &c.window, c.arg("config")?, c.arg("debug")?).await
    });
    d.add("run_templates", |c| async move { run_templates(&c.host, &c.window) });
    d.add("run_save_templates", |c| async move { run_save_templates(&c.host, &c.window, c.arg("templates")?) });
    d.add("run_import_sources", |c| async move { run_import_sources(&c.host, &c.window) });
    d.add("run_import_configs", |c| async move {
        run_import_configs(&c.host, &c.window, c.arg("source")?, c.arg("existing")?)
    });
    d.add("run_system_env", |c| async move { Ok(run_system_env(&c.host, &c.window)) });
}
