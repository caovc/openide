//! Build Project with the selected non-JVM toolchain.
use crate::Host;
use crate::ops::Channel;
use crate::rpc::Dispatcher;
use ide_build::compile::{self, BuildEvent, BuildKind, BuildResult};
use ide_core::settings::Settings;
use ide_core::{IdeError, IdeEvent, IdeResult, RequestId};
use std::path::Path;

fn join_err(e: tokio::task::JoinError) -> IdeError {
    IdeError::internal(e.to_string())
}

fn prepare_plan(mut plan: compile::BuildPlan, root: &Path, settings: &Settings) -> compile::BuildPlan {
    let kind = match plan.system {
        compile::BuildSystem::Cargo => "cargo",
        compile::BuildSystem::Go => "go",
        compile::BuildSystem::TypeScript => "npm",
        _ => return plan,
    };
    for step in &mut plan.steps {
        let mut config = ide_run::RunConfig {
            id: String::new(),
            name: String::new(),
            kind: kind.into(),
            command: step.program.clone(),
            args: step.args.clone(),
            cwd: Some(step.cwd.clone().into()),
            env: step.env.clone(),
            detected: true,
            is_test: false,
            debug_adapter: None,
            allow_parallel: false,
            extras: Default::default(),
        };
        config.extras.module = Some(ide_core::ipc_path::to_ipc(&step.cwd));
        ide_sdk::apply::apply_to_run_configs(std::slice::from_mut(&mut config), root, settings);
        if kind == "go" {
            config.extras.params.insert("useTags".into(), "true".into());
            ide_sdk::go::apply_to_run(&mut config, &settings.languages.go.build_tags);
        }
        step.program = config.command;
        step.args = config.args;
        step.env = config.env;
    }
    plan
}

pub async fn build_run(
    host: &Host,
    window: &str,
    kind: BuildKind,
    file: Option<std::path::PathBuf>,
    request: RequestId,
    clear: Vec<std::path::PathBuf>,
    on_event: Channel<BuildEvent>,
) -> IdeResult<BuildResult> {
    host.require_trust(window)?;
    let project = host.project(window)?;
    let (root, sink) = (project.root.clone(), project.sink.clone());
    let settings = project.settings.effective();
    let config_dir = host.config_dir.clone();
    let token = host.begin_project_request(window, request);
    let result = tokio::task::spawn_blocking(move || {
        for path in clear {
            sink.emit(IdeEvent::Diagnostics {
                path: path.into(),
                source: compile::DIAGNOSTICS_SOURCE.into(),
                items: Vec::new(),
            });
        }
        let plan = if let Some(workspace) = ide_workspace::workspace::Workspace::load(&root)? {
            let mut combined: Option<compile::BuildPlan> = None;
            for member in workspace.projects.iter().filter(|p| file.as_ref().is_none_or(|f| f.starts_with(p))) {
                let settings = ide_workspace::SettingsStore::load(&config_dir, Some(member)).effective();
                let plan = prepare_plan(
                    compile::plan(member, kind, file.as_deref(), settings.cmake.profiles.as_deref())?,
                    member,
                    &settings,
                );
                match &mut combined {
                    Some(combined) => combined.steps.extend(plan.steps),
                    None => combined = Some(plan),
                }
            }
            let mut plan = combined.ok_or_else(|| IdeError::invalid("No workspace project to build"))?;
            plan.title = workspace.name;
            plan
        } else {
            prepare_plan(
                compile::plan(&root, kind, file.as_deref(), settings.cmake.profiles.as_deref())?,
                &root,
                &settings,
            )
        };
        let result = compile::run(&root, &plan, &token, &|e| {
            let _ = on_event.send(e);
        })?;
        for (path, items) in compile::diagnostics(&result.messages) {
            sink.emit(IdeEvent::Diagnostics { path: path.into(), source: compile::DIAGNOSTICS_SOURCE.into(), items });
        }
        Ok(result)
    })
    .await
    .map_err(join_err);
    host.end_request(request);
    result?
}

pub(crate) fn register(d: &mut Dispatcher) {
    d.add("build_run", |c| async move {
        build_run(
            &c.host,
            &c.window,
            c.arg("kind")?,
            c.arg("file")?,
            c.arg("request")?,
            c.arg("clear")?,
            c.sender("onEvent")?,
        )
        .await
    });
}

#[cfg(test)]
mod gradle_settings_tests {
    use super::*;

    #[test]
    fn builds_apply_the_same_explicit_toolchains_as_runs() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let tool = |name: &str| format!("{name}{}", std::env::consts::EXE_SUFFIX);
        for name in ["cargo", "go"] {
            let path = root.join("sdk").join("bin").join(tool(name));
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "").unwrap();
        }
        let mut settings = Settings::default();
        settings.languages.rust.toolchain = "sdk".into();
        settings.languages.go.goroot = "sdk".into();
        settings.languages.go.build_tags.custom = "integration".into();
        settings.languages.node.package_manager = "yarn".into();
        for (marker, source, program) in [
            (
                "Cargo.toml",
                "[package]\nname='demo'\nversion='0.1.0'",
                root.join("sdk").join("bin").join(tool("cargo")).to_string_lossy().into_owned(),
            ),
            ("go.mod", "module demo", root.join("sdk").join("bin").join(tool("go")).to_string_lossy().into_owned()),
            ("package.json", r#"{"scripts":{"build":"echo built"},"packageManager":"pnpm@10"}"#, "yarn".into()),
        ] {
            let dir = root.join(marker.replace('.', "-"));
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join(marker), source).unwrap();
            let plan = prepare_plan(compile::plan(&dir, BuildKind::Artifacts, None, None).unwrap(), root, &settings);
            assert_eq!(plan.steps[0].program, program);
            assert_eq!(plan.steps[0].cwd, dir);
            if marker == "go.mod" {
                assert!(plan.steps[0].args.contains(&"-tags=integration".into()));
            }
        }
    }
}
