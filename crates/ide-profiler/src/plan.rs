//! Which profiler samples a configuration, and how its command line changes.

use crate::{ProfilePrepared, ProfileSpec, ProfilerInstall};
use ide_run::RunConfig;
use ide_run::wrap::{self, program_name};
use std::path::{Path, PathBuf};

const PY_SPY_HOME: &str = "https://github.com/benfred/py-spy";

fn s(v: &str) -> String {
    v.to_owned()
}

fn path(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn unsupported(reason: impl Into<String>) -> ProfilePrepared {
    ProfilePrepared::Unsupported { reason: reason.into() }
}

fn ready(profiler: &str, launch: RunConfig, spec: ProfileSpec) -> ProfilePrepared {
    ProfilePrepared::Ready { profiler: profiler.to_owned(), launch: Box::new(launch), spec }
}

/// Appends `value` to the space-separated option variable `key` of `config`'s environment.
fn append_env(config: &mut RunConfig, key: &str, value: &str) {
    let base = config.env.get(key).cloned().or_else(|| std::env::var(key).ok()).unwrap_or_default();
    let joined = if base.trim().is_empty() { value.to_owned() } else { format!("{base} {value}") };
    config.env.insert(key.to_owned(), joined);
}

/// How to run `config` under a sampling profiler. `out` is an existing empty
/// directory for the profile. Probes tools: call from a blocking thread.
pub fn prepare(root: &Path, config: &RunConfig, out: &Path) -> ProfilePrepared {
    if ide_run::is_removed_jvm_config(config) {
        return unsupported("JVM run configurations are no longer supported.");
    }
    let dir = wrap::run_dir(root, config);
    let program = program_name(&config.command);
    match program.as_str() {
        "node" | "npx" | "tsx" | "ts-node" | "npm" | "pnpm" | "yarn" => node(root, config, out),
        "cargo" => cargo(config, &dir, out),
        "bun" | "deno" => unsupported(format!("Profiling {program} programs is not supported.")),
        _ if config.kind == "native" => native(config, &dir, out),
        _ => match wrap::python_command(config) {
            Some(py) => python(root, config, &dir, out, py),
            None => unsupported(format!("No profiler is known for '{}'.", config.name)),
        },
    }
}

fn node(root: &Path, config: &RunConfig, out: &Path) -> ProfilePrepared {
    let mut launch = config.clone();
    // Every Node.js process of the run writes a profile when it exits.
    append_env(&mut launch, "NODE_OPTIONS", &format!("--cpu-prof --cpu-prof-dir={}", quote_opt(&path(out))));
    ready(
        "node --cpu-prof",
        launch,
        ProfileSpec::CpuProfiles { dir: out.to_path_buf().into(), root: root.to_path_buf().into() },
    )
}

/// `NODE_OPTIONS` values are split on spaces; quote paths that have them.
fn quote_opt(v: &str) -> String {
    if v.contains(' ') { format!("\"{v}\"") } else { v.to_owned() }
}

fn python(root: &Path, config: &RunConfig, dir: &Path, out: &Path, py: wrap::PythonCommand) -> ProfilePrepared {
    if py.target.is_empty() {
        return unsupported("Profiling needs a Python script or module to run.");
    }
    // py-spy installed into the interpreter's environment lives next to it.
    let beside =
        Path::new(&py.interpreter[0]).parent().map(|d| d.join(if cfg!(windows) { "py-spy.exe" } else { "py-spy" }));
    let Some(py_spy) = beside.filter(|p| p.is_file()).or_else(|| wrap::find_tool("py-spy", config, dir, root)) else {
        let install = (py.manager.is_none()).then(|| {
            let mut argv = py.interpreter.clone();
            argv.extend([s("-m"), s("pip"), s("install"), s("py-spy")]);
            let (command, args) = argv.split_first().map(|(c, a)| (c.clone(), a.to_vec())).unwrap_or_default();
            ProfilerInstall { command, args, cwd: Some(dir.to_path_buf().into()) }
        });
        return ProfilePrepared::MissingTool {
            tool: s("py-spy"),
            message: s("Profiling Python needs py-spy."),
            install,
            homepage: Some(PY_SPY_HOME.into()),
        };
    };
    let mut args = vec![
        s("record"),
        s("--format"),
        s("raw"),
        s("--function"),
        s("--subprocesses"),
        s("-o"),
        path(&out.join("profile.txt")),
        s("--"),
    ];
    args.extend(py.interpreter.iter().cloned());
    args.extend(py.target.iter().cloned());
    let launch = RunConfig { command: path(&py_spy), args, ..config.clone() };
    let spec = ProfileSpec::Folded {
        profiler: s("py-spy"),
        dir: out.to_path_buf().into(),
        ext: s("txt"),
        base: dir.to_path_buf().into(),
    };
    ready("py-spy", launch, spec)
}

fn perf(config: &RunConfig) -> Result<PathBuf, Box<ProfilePrepared>> {
    if !cfg!(target_os = "linux") {
        return Err(Box::new(unsupported(
            "Native programs are profiled with Linux perf; on this system there is no sampling profiler OpenIDEA can drive without root.",
        )));
    }
    ide_run::which::find_executable("perf", &wrap::search_path(config)).ok_or_else(|| {
        Box::new(ProfilePrepared::MissingTool {
            tool: s("perf"),
            message: s("Profiling native programs needs perf (linux-tools / linux-perf package)."),
            install: None,
            homepage: Some(s("https://perfwiki.github.io/main/")),
        })
    })
}

fn record_args(data: &Path) -> Vec<String> {
    vec![s("record"), s("-F"), s("999"), s("-g"), s("-o"), path(data)]
}

fn perf_spec(perf: &Path, data: PathBuf, dir: &Path, config: &RunConfig) -> ProfileSpec {
    ProfileSpec::Perf { perf: path(perf), data: data.into(), cwd: dir.to_path_buf().into(), env: config.env.clone() }
}

fn native(config: &RunConfig, dir: &Path, out: &Path) -> ProfilePrepared {
    let perf = match perf(config) {
        Ok(p) => p,
        Err(e) => return *e,
    };
    let data = out.join("perf.data");
    let mut args = record_args(&data);
    args.push(s("--"));
    args.push(config.command.clone());
    args.extend(config.args.iter().cloned());
    let launch = RunConfig { command: path(&perf), args, ..config.clone() };
    ready("perf", launch, perf_spec(&perf, data, dir, config))
}

fn cargo(config: &RunConfig, dir: &Path, out: &Path) -> ProfilePrepared {
    let toolchain = config.args.iter().take_while(|a| a.starts_with('+')).count();
    if config.args.get(toolchain).map(String::as_str) != Some("run") {
        return unsupported("Profiling runs `cargo run` configurations.");
    }
    let perf = match perf(config) {
        Ok(p) => p,
        Err(e) => return *e,
    };
    let data = out.join("perf.data");
    // Only the program runs under perf (not the build): perf becomes cargo's target runner.
    let runner: Vec<String> =
        std::iter::once(path(&perf)).chain(record_args(&data)).chain(std::iter::once(s("--"))).collect();
    let toml = runner.iter().map(|a| format!("'{}'", a.replace('\'', ""))).collect::<Vec<_>>().join(",");
    let mut args: Vec<String> = config.args[..toolchain].to_vec();
    args.push(s("--config"));
    args.push(format!("target.'cfg(all())'.runner=[{toml}]"));
    args.extend(config.args[toolchain..].iter().cloned());
    let launch = RunConfig { args, ..config.clone() };
    ready("perf", launch, perf_spec(&perf, data, dir, config))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn cfg(kind: &str, command: &str, args: &[&str]) -> RunConfig {
        RunConfig {
            id: "t".into(),
            name: "t".into(),
            kind: kind.into(),
            command: command.into(),
            args: args.iter().map(|s| s.to_string()).collect(),
            cwd: None,
            env: BTreeMap::new(),
            detected: true,
            is_test: false,
            debug_adapter: None,
            allow_parallel: false,
            extras: Default::default(),
        }
    }

    #[test]
    fn node_runs_with_cpu_prof() {
        let dir = tempfile::tempdir().unwrap();
        let mut c = cfg("node", "node", &["index.js"]);
        c.env.insert("NODE_OPTIONS".into(), "--max-old-space-size=4096".into());
        match prepare(dir.path(), &c, dir.path()) {
            ProfilePrepared::Ready { launch, spec, .. } => {
                let opts = &launch.env["NODE_OPTIONS"];
                assert!(opts.starts_with("--max-old-space-size=4096 --cpu-prof --cpu-prof-dir="));
                assert_eq!(launch.args, ["index.js"]);
                assert!(matches!(spec, ProfileSpec::CpuProfiles { .. }));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn python_uses_py_spy_or_asks_for_it() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("venv/bin");
        std::fs::create_dir_all(&bin).unwrap();
        let python = bin.join("python");
        std::fs::write(&python, "").unwrap();
        let mut c = cfg("python", &python.to_string_lossy(), &["main.py"]);
        c.env.insert("PATH".into(), dir.path().join("nothing").to_string_lossy().into_owned());
        match prepare(dir.path(), &c, dir.path()) {
            ProfilePrepared::MissingTool { tool, install: Some(i), .. } => {
                assert_eq!(tool, "py-spy");
                assert_eq!(i.args, ["-m", "pip", "install", "py-spy"]);
            }
            other => panic!("{other:?}"),
        }
        let spy = bin.join(if cfg!(windows) { "py-spy.exe" } else { "py-spy" });
        std::fs::write(&spy, "").unwrap();
        match prepare(dir.path(), &c, dir.path()) {
            ProfilePrepared::Ready { launch, .. } => {
                assert_eq!(launch.command, spy.to_string_lossy());
                assert_eq!(&launch.args[..4], ["record", "--format", "raw", "--function"]);
                let dash = launch.args.iter().position(|a| a == "--").unwrap();
                assert_eq!(&launch.args[dash + 1..], [python.to_string_lossy().as_ref(), "main.py"]);
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn cargo_and_unknown() {
        let dir = tempfile::tempdir().unwrap();
        assert!(matches!(
            prepare(dir.path(), &cfg("cargo", "cargo", &["test"]), dir.path()),
            ProfilePrepared::Unsupported { .. }
        ));
        assert!(matches!(
            prepare(dir.path(), &cfg("make", "make", &[]), dir.path()),
            ProfilePrepared::Unsupported { .. }
        ));
        if !cfg!(target_os = "linux") {
            assert!(matches!(
                prepare(dir.path(), &cfg("cargo", "cargo", &["run"]), dir.path()),
                ProfilePrepared::Unsupported { .. }
            ));
        }
    }
}
