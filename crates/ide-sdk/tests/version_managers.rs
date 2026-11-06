//! mise / asdf installs: detection and the project's pinned versions. One test in its
//! own binary: it points `MISE_DATA_DIR` / `ASDF_DATA_DIR` at a fake layout.
#![cfg(unix)]

use ide_core::settings::Settings;
use ide_run::RunConfig;
use ide_sdk::{Sdk, SdkKind, detect};
use std::collections::BTreeMap;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

/// An executable that prints `out` (a `--version` answer).
fn script(path: &Path, out: &str) {
    write(path, &format!("#!/bin/sh\necho '{out}'\n"));
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

fn find<'a>(sdks: &'a [Sdk], dir: &Path) -> &'a Sdk {
    sdks.iter().find(|s| s.path.starts_with(dir)).unwrap_or_else(|| panic!("{} not in {sdks:#?}", dir.display()))
}

#[test]
fn mise_and_asdf_installs_are_detected_and_pinned_versions_used() {
    let tmp = tempfile::tempdir().unwrap();
    let tmp = dunce::canonicalize(tmp.path()).unwrap();
    let mise = tmp.join("mise");
    let asdf = tmp.join("asdf");
    // SAFETY: this binary contains one test, which owns its fake environment.
    unsafe {
        std::env::set_var("HOME", tmp.join("home"));
        std::env::set_var("MISE_DATA_DIR", &mise);
        std::env::set_var("ASDF_DATA_DIR", &asdf);
        std::env::set_var("MISE_GLOBAL_CONFIG_FILE", tmp.join("no-global.toml"));
    }

    let installs = mise.join("installs");
    for v in ["20.11.1", "22.1.0"] {
        script(&installs.join("node").join(v).join("bin/node"), &format!("v{v}"));
    }
    std::os::unix::fs::symlink("./22.1.0", installs.join("node/22")).unwrap();
    script(&installs.join("python/3.12.1/bin/python3"), "Python 3.12.1");
    let goroot = asdf.join("installs/golang/1.22.1/go");
    write(&goroot.join("VERSION"), "go1.22.1\n");
    script(&goroot.join("bin/go"), "go version go1.22.1");
    let project = tmp.join("project");
    write(&project.join("mise.toml"), "[tools]\nnode = '20'\npython = '3.12'\n");
    write(&project.join(".tool-versions"), "golang 1.22.1\nnodejs 22.1.0\n");

    let nodes = detect(SdkKind::Node, Some(&project));
    assert_eq!(nodes[0].path, installs.join("node/20.11.1/bin/node"), "mise.toml over .tool-versions");
    assert_eq!(find(&nodes, &installs.join("node/22.1.0")).source, "mise");
    assert_eq!(nodes.iter().filter(|s| s.source == "mise").count(), 2, "the `22` alias is not listed again");

    let pythons = detect(SdkKind::Python, Some(&project));
    assert_eq!(find(&pythons, &installs.join("python")).name, "Python 3.12 (mise)");

    let gos = detect(SdkKind::Go, Some(&project));
    let go = find(&gos, &goroot);
    assert_eq!((go.source.as_str(), go.version.as_deref()), ("asdf", Some("1.22.1")));

    // Nothing configured in Settings: the pinned versions apply.
    let s = Settings::default();
    assert_eq!(ide_sdk::apply::python_interpreter(&project, &s), Some(installs.join("python/3.12.1/bin/python3")));

    let run = |kind: &str, command: &str| RunConfig {
        id: format!("{kind}:x"),
        name: "x".into(),
        kind: kind.into(),
        command: command.into(),
        args: vec![],
        cwd: None,
        env: BTreeMap::new(),
        detected: true,
        is_test: false,
        debug_adapter: None,
        allow_parallel: false,
        extras: Default::default(),
    };
    let mut configs = [run("npm", "npm"), run("go", "go")];
    ide_sdk::apply::apply_to_run_configs(&mut configs, &project, &s);
    let path_of = |c: &RunConfig| -> Vec<PathBuf> { std::env::split_paths(&c.env["PATH"]).collect() };
    assert_eq!(path_of(&configs[0])[0], installs.join("node/20.11.1/bin"));
    assert_eq!(configs[1].command, goroot.join("bin/go").to_string_lossy());
    assert_eq!(configs[1].env["GOROOT"], goroot.to_string_lossy());
}
