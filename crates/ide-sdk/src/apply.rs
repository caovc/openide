//! Applying the selected interpreters / toolchains (`languages.*` settings) to
//! language servers, run configurations and terminals.

use crate::discover::{project_venv_python, workspace_tsdk};
use crate::exec::{path_with, search_path};
use crate::{angular, godot, pinned, vue};
use crate::{bin_dir, exe, venv_of};
use ide_core::settings::{LanguageServerSettings, Settings};
use ide_core::version_managers::Tool;
use ide_core::{IdeError, IdeResult};
use ide_language::{LanguageConfig, LanguageServerConfig};
use ide_run::RunConfig;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

fn non_empty(s: &str) -> Option<&str> {
    let s = s.trim();
    (!s.is_empty()).then_some(s)
}

/// Resolves `~/` and project-relative paths of a setting.
pub fn setting_path(root: &Path, s: &str) -> Option<PathBuf> {
    let s = non_empty(s)?;
    let p = match s.strip_prefix("~/") {
        Some(rest) => crate::home_dir()?.join(rest),
        None => PathBuf::from(s),
    };
    Some(if p.is_absolute() { p } else { root.join(p) })
}

fn toml_has_table(file: &Path, table: &str) -> bool {
    let Ok(text) = std::fs::read_to_string(file) else { return false };
    let Ok(value) = toml::from_str::<toml::Value>(&text) else { return false };
    table.split('.').try_fold(&value, |value, key| value.get(key)).is_some_and(toml::Value::is_table)
}

/// The Ruff configuration file selected by `languages.ruff.configurationDirectory`.
/// A file can be chosen directly; a directory resolves `ruff.toml`, `.ruff.toml`,
/// then a `pyproject.toml` containing `[tool.ruff]`.
pub fn ruff_configuration(root: &Path, configured: &str) -> IdeResult<Option<PathBuf>> {
    let Some(path) = setting_path(root, configured) else { return Ok(None) };
    if path.is_file() {
        return Ok(Some(path));
    }
    if !path.is_dir() {
        return Err(IdeError::invalid(format!("Ruff configuration path does not exist: {}", path.display())));
    }
    for name in ["ruff.toml", ".ruff.toml"] {
        let file = path.join(name);
        if file.is_file() {
            return Ok(Some(file));
        }
    }
    let pyproject = path.join("pyproject.toml");
    if toml_has_table(&pyproject, "tool.ruff") {
        return Ok(Some(pyproject));
    }
    Err(IdeError::invalid(format!(
        "Ruff configuration directory has no ruff.toml, .ruff.toml, or pyproject.toml with [tool.ruff]: {}",
        path.display()
    )))
}

/// The project interpreter: the configured one, else a project virtualenv
/// (`.venv`, `venv`, …) in the project root, else the Python the project pins for mise / asdf.
pub fn python_interpreter(root: &Path, s: &Settings) -> Option<PathBuf> {
    setting_path(root, &s.languages.python.interpreter)
        .or_else(|| project_venv_python(root))
        .or_else(|| pinned::pinned_python(root))
}

/// An explicit project interpreter wins; otherwise use the closest virtualenv to the file.
pub fn python_interpreter_near(root: &Path, near: Option<&Path>, s: &Settings) -> Option<PathBuf> {
    if let Some(python) = setting_path(root, &s.languages.python.interpreter) {
        return Some(python);
    }
    let near = near.filter(|dir| dir.starts_with(root)).unwrap_or(root);
    near.ancestors()
        .take_while(|dir| dir.starts_with(root))
        .find_map(project_venv_python)
        .or_else(|| pinned::pinned_python(near))
}

/// The project Ruby: the configured one, else the `.ruby-version` / mise / asdf
/// install, else `ruby` on PATH.
pub fn ruby_interpreter(root: &Path, s: &Settings) -> Option<PathBuf> {
    setting_path(root, &s.languages.ruby.interpreter).or_else(|| crate::ruby::project_ruby(root))
}

/// The configured `node` executable's directory, else the `bin` of the Node.js the
/// project pins for mise / asdf.
pub(crate) fn node_dir(root: &Path, s: &Settings) -> Option<PathBuf> {
    match setting_path(root, &s.languages.node.interpreter) {
        Some(p) => p.parent().map(Path::to_path_buf),
        None => pinned::pinned_install(root, Tool::Node)
            .map(|(dir, _)| dir.join("bin"))
            .filter(|bin| bin.join(exe("node")).is_file()),
    }
}

/// The directory of the configured `php` executable (it also holds the matching `phpize`,
/// `pecl`…): put on the `PATH` so `#!/usr/bin/env php` scripts such as `vendor/bin/phpunit`
/// and Composer run on the selected interpreter.
pub(crate) fn php_dir(root: &Path, s: &Settings) -> Option<PathBuf> {
    setting_path(root, &s.languages.php.interpreter).and_then(|p| p.parent().map(Path::to_path_buf))
}

/// The configured Rust toolchain's `bin` directory and rustup toolchain name.
pub(crate) fn rust_bin(root: &Path, s: &Settings) -> Option<(PathBuf, Option<String>)> {
    let dir = setting_path(root, &s.languages.rust.toolchain)?;
    let bin = if dir.join("bin").join(exe("rustc")).is_file() || dir.join("bin").join(exe("cargo")).is_file() {
        dir.join("bin")
    } else {
        dir
    };
    let home = bin.parent();
    let toolchain = home
        .filter(|h| h.parent().is_some_and(|p| p.ends_with("toolchains")))
        .and_then(|h| h.file_name())
        .map(|n| n.to_string_lossy().into_owned());
    Some((bin, toolchain))
}

/// The configured GOROOT, else the Go the project pins for mise / asdf.
pub(crate) fn goroot(root: &Path, s: &Settings) -> Option<PathBuf> {
    setting_path(root, &s.languages.go.goroot)
        .or_else(|| pinned::pinned_install(root, Tool::Go).and_then(|(dir, _)| pinned::goroot_in_install(&dir)))
}

/// TypeScript `lib` directory for the selected version; `None` = the server's bundled one.
pub fn tsdk(root: &Path, s: &Settings) -> Option<PathBuf> {
    match s.languages.typescript.version.trim() {
        "" | "bundled" => None,
        "workspace" => workspace_tsdk(root),
        custom => {
            let p = setting_path(root, custom)?;
            Some(if p.extension().is_some_and(|e| e == "js") { p.parent()?.to_path_buf() } else { p })
        }
    }
}

const PYTHON_SERVERS: [&str; 7] = ["basedpyright", "pyright", "ty", "pyrefly", "pylsp", "jedi-language-server", "ruff"];

pub(crate) fn merge(base: &mut Value, layer: Value) {
    match (base, layer) {
        (Value::Object(base), Value::Object(layer)) => {
            for (k, v) in layer {
                match base.get_mut(&k) {
                    Some(existing) => merge(existing, v),
                    None => {
                        base.insert(k, v);
                    }
                }
            }
        }
        (base, layer) => *base = layer,
    }
}

pub(crate) fn merge_init_options(cfg: &mut LanguageServerConfig, layer: Value) {
    let mut current =
        cfg.initialization_options.as_ref().and_then(|v| serde_json::to_value(v).ok()).unwrap_or_else(|| json!({}));
    if !current.is_object() {
        current = json!({});
    }
    merge(&mut current, layer);
    match toml::Value::try_from(current) {
        Ok(v) => cfg.initialization_options = Some(v),
        Err(e) => tracing::warn!("{}: cannot apply settings to initialization options: {e}", cfg.name),
    }
}

/// Adjusts a language server's launch configuration from settings: interpreter
/// paths, toolchain `PATH`, env (`GOROOT`, `RUST_SRC_PATH`, `VIRTUAL_ENV`) and
/// server settings (`python.pythonPath`, rust-analyzer `check.command`, `typescript.tsdk`).
/// `root` is the project root, `server_root` the server's workspace root.
/// The executable to launch for `command`: the one chosen in settings, else for
/// commands with well-known install locations (Godot) the one found there.
pub fn tool_command(root: &Path, s: &Settings, command: &str) -> Option<PathBuf> {
    let custom = s.tool_path(command).and_then(|p| setting_path(root, p));
    if command == godot::COMMAND {
        return godot::find(custom);
    }
    custom
}

/// Points a run configuration launching a bare tool name at the executable from
/// [`tool_command`] (Godot apps live outside the search path).
pub fn resolve_run_command(config: &mut RunConfig, root: &Path, s: &Settings) {
    if config.command == godot::COMMAND
        && let Some(path) = tool_command(root, s, &config.command)
    {
        config.command = path.to_string_lossy().into_owned();
    }
}

pub fn configure_server(cfg: &mut LanguageServerConfig, root: &Path, server_root: &Path, s: &Settings) {
    if let Some(custom) = tool_command(root, s, &cfg.command) {
        cfg.command = custom.to_string_lossy().into_owned();
    }
    let mut path_dirs: Vec<PathBuf> = Vec::new();
    let name = cfg.name.clone();
    let name = name.as_str();

    if PYTHON_SERVERS.contains(&name) {
        let python = project_venv_python(server_root)
            .filter(|_| non_empty(&s.languages.python.interpreter).is_none())
            .or_else(|| python_interpreter(root, s));
        if let Some(python) = python {
            let p = python.to_string_lossy().into_owned();
            match name {
                "basedpyright" | "pyright" => merge_init_options(cfg, json!({ "python": { "pythonPath": p } })),
                "pylsp" => merge_init_options(cfg, json!({ "pylsp": { "plugins": { "jedi": { "environment": p } } } })),
                "jedi-language-server" => merge_init_options(cfg, json!({ "workspace": { "environmentPath": p } })),
                _ => {}
            }
            if let Some(venv) = venv_of(&python) {
                cfg.env.insert("VIRTUAL_ENV".into(), venv.to_string_lossy().into_owned());
                path_dirs.push(venv.join(bin_dir()));
            }
        }
    }

    if name == "ruff" {
        match ruff_configuration(root, &s.languages.ruff.configuration_directory) {
            Ok(Some(path)) => {
                let mut settings = cfg.settings.take().filter(Value::is_object).unwrap_or_else(|| json!({}));
                settings["configuration"] = json!(path.to_string_lossy());
                cfg.settings = Some(settings);
            }
            Ok(None) => {}
            Err(e) => cfg.launch_error = Some(e.message),
        }
    }

    if name == "rust-analyzer" {
        let r = &s.languages.rust;
        let extra_args: Vec<&str> = r.rustfmt_args.split_whitespace().collect();
        // Only non-default values: rust-analyzer's own defaults (and the
        // language definition's options) stay untouched otherwise.
        let mut layer = serde_json::Map::new();
        if !r.check_on_save {
            layer.insert("checkOnSave".into(), json!(false));
        }
        if let Some(cmd) = non_empty(&r.check_command).filter(|c| *c != "check") {
            layer.insert("check".into(), json!({ "command": cmd }));
        }
        if !extra_args.is_empty() {
            layer.insert("rustfmt".into(), json!({ "extraArgs": extra_args }));
        }
        if !layer.is_empty() {
            merge_init_options(cfg, Value::Object(layer));
        }
        if let Some((bin, toolchain)) = rust_bin(root, s) {
            path_dirs.push(bin);
            if let Some(t) = toolchain {
                cfg.env.insert("RUSTUP_TOOLCHAIN".into(), t);
            }
        }
        if let Some(src) = setting_path(root, &r.stdlib) {
            cfg.env.insert("RUST_SRC_PATH".into(), src.to_string_lossy().into_owned());
        }
    }

    if name == "gopls" {
        let mut build = crate::go::build_settings(&s.languages.go.build_tags);
        let module_env = crate::go::module_environment(server_root, &s.languages.go.modules);
        for (key, value) in module_env {
            build["env"][key] = json!(value);
        }
        let mut settings = cfg.settings.take().unwrap_or_else(|| json!({}));
        // gopls retains omitted keys on reconfiguration. Explicit empty values
        // restore defaults when the last project constraint is cleared.
        let init = cfg.initialization_options.as_ref().and_then(|v| serde_json::to_value(v).ok());
        for (key, default) in [("buildFlags", json!([])), ("env", json!({}))] {
            if settings.get(key).is_none() {
                settings[key] = init.as_ref().and_then(|v| v.get(key)).cloned().unwrap_or(default);
            }
        }
        merge(&mut settings, build);
        cfg.settings = Some(settings);
        if let Some(goroot) = goroot(root, s) {
            path_dirs.push(goroot.join("bin"));
            cfg.env.insert("GOROOT".into(), goroot.to_string_lossy().into_owned());
        }
        if let Some(gopath) = setting_path(root, &s.languages.go.gopath) {
            cfg.env.insert("GOPATH".into(), gopath.to_string_lossy().into_owned());
        }
    }

    if let Some(lib) = tsdk(server_root, s).or_else(|| tsdk(root, s)) {
        let lib_s = lib.to_string_lossy().into_owned();
        match name {
            "vtsls" => merge_init_options(cfg, json!({ "typescript": { "tsdk": lib_s } })),
            "typescript-language-server" => {
                merge_init_options(cfg, json!({ "tsserver": { "path": lib.join("tsserver.js").to_string_lossy() } }))
            }
            _ => {}
        }
    }
    let vue_command = s.tool_path(vue::SERVER).and_then(|p| setting_path(root, p));
    let vue_command = vue_command.as_deref().map_or(vue::SERVER.into(), Path::to_string_lossy);
    if name == "vtsls"
        && let Some(vue) = vue::server_package(&vue_command, &search_path())
    {
        let plugin = vue::tsserver_plugin(&vue);
        merge_init_options(cfg, json!({ "vtsls": { "tsserver": { "globalPlugins": [plugin] } } }));
    }
    if name == vue::SERVER {
        configure_vue_typescript(cfg, root, server_root, s);
    }

    // Intelephense reads it as `intelephense.environment.phpVersion` (`workspace/configuration`).
    if name == "intelephense"
        && let Some(level) = crate::php::language_level(root, s)
    {
        merge_init_options(cfg, json!({ "environment": { "phpVersion": level.version } }));
    }
    if name == "intelephense" {
        if let Some(stubs) = crate::php::intelephense_stubs(root, s) {
            merge_init_options(cfg, json!({ "stubs": stubs }));
        }
        let include_paths = crate::php::include_paths(root, s);
        if !include_paths.is_empty() {
            merge_init_options(cfg, json!({ "environment": { "includePaths": include_paths } }));
        }
    }

    // Node-based servers (`#!/usr/bin/env node`) run on the selected Node.js.
    if let Some(dir) = node_dir(root, s) {
        path_dirs.push(dir);
    }
    // PHP servers (phpactor, `php intelephense`-style wrappers) on the selected PHP.
    if let Some(dir) = php_dir(root, s) {
        path_dirs.push(dir);
    }

    // Gems install to the Ruby's bindir, which is not always on `PATH` (Homebrew).
    if name == "ruby-lsp"
        && let Some(ruby) = ruby_interpreter(root, s)
    {
        path_dirs.extend(crate::ruby::gem_bin_dirs(&ruby, server_root));
    }

    if !path_dirs.is_empty() {
        let dirs: Vec<&Path> = path_dirs.iter().map(PathBuf::as_path).collect();
        cfg.env.insert("PATH".into(), path_with(&dirs));
    }

    // Last: it finds the server on the `PATH` set above.
    if name == angular::SERVER {
        configure_angular(cfg, root, server_root, s);
    }
}

/// The servers `language` uses after Settings › Language Servers: the
/// definition's ones that aren't disabled, then the ones defined in settings for it.
pub fn language_servers(language: &str, defined: &[LanguageServerConfig], s: &Settings) -> Vec<LanguageServerConfig> {
    let enabled = |name: &str| s.language_servers.get(name).is_none_or(|ls| ls.enabled);
    let mut out: Vec<LanguageServerConfig> = defined.iter().filter(|c| enabled(&c.name)).cloned().collect();
    for (name, ls) in &s.language_servers {
        if ls.enabled && ls.languages.iter().any(|l| l == language) && !out.iter().any(|c| &c.name == name) {
            out.push(custom_server(name, ls));
        }
    }
    if non_empty(&s.languages.ruff.configuration_directory).is_some() {
        for cfg in out.iter_mut().filter(|cfg| cfg.name == "ruff") {
            cfg.require_root_marker = false;
        }
    }
    out
}

/// Adds the servers defined in settings to the languages they serve (to list
/// them with the tools); disabled ones stay so they can be turned back on.
pub fn with_custom_servers(langs: &mut [LanguageConfig], s: &Settings) {
    for (name, ls) in s.language_servers.iter().filter(|(_, ls)| ls.is_custom()) {
        for lang in langs.iter_mut().filter(|l| ls.languages.iter().any(|id| id == l.id.as_str())) {
            if !lang.language_servers.iter().any(|c| &c.name == name) {
                lang.language_servers.push(custom_server(name, ls));
            }
        }
    }
}

fn custom_server(name: &str, ls: &LanguageServerSettings) -> LanguageServerConfig {
    LanguageServerConfig {
        name: name.to_owned(),
        command: ls.command.trim().to_owned(),
        args: Vec::new(),
        env: Default::default(),
        root_markers: ls.root_markers.clone(),
        require_root_marker: false,
        initialization_options: None,
        settings: None,
        install_hint: Some(match ls.command.trim() {
            "" => format!("Set the command of `{name}` in Settings › Language Servers"),
            command => format!("`{command}` was not found: install it, or set its path in Settings › Language Servers"),
        }),
        connect: None,
        fallback: false,
        features: Vec::new(),
        code_action_kinds: Vec::new(),
        launch_error: None,
        tsserver_project: false,
        resync_on_configuration: false,
        pinned: None,
    }
}

/// Command and arguments from Settings › Language Servers; applied before
/// [`configure_server`] so toolchain adjustments (a custom path, JVM args) still follow.
pub fn server_launch_overrides(cfg: &mut LanguageServerConfig, s: &Settings) {
    let Some(ls) = s.language_servers.get(&cfg.name) else { return };
    if let Some(command) = non_empty(ls.command.trim()) {
        cfg.command = command.to_owned();
        // The user's own program, not the one approved for a plugin.
        cfg.pinned = None;
    }
    if let Some(args) = &ls.args {
        cfg.args = args.clone();
    }
}

/// Environment, features, `initializationOptions` and `workspace/configuration`
/// settings from Settings › Language Servers; applied last so they win over derived values.
pub fn server_protocol_overrides(cfg: &mut LanguageServerConfig, s: &Settings) {
    let Some(ls) = s.language_servers.get(&cfg.name) else { return };
    cfg.env.extend(ls.env.iter().map(|(k, v)| (k.clone(), v.clone())));
    if let Some(features) = &ls.features {
        cfg.features = features.clone();
    }
    if let Some(kinds) = &ls.code_action_kinds {
        cfg.code_action_kinds = kinds.clone();
    }
    if let Some(options) = &ls.initialization_options {
        merge_init_options(cfg, options.clone());
    }
    if let Some(settings) = &ls.settings {
        let mut current = cfg.settings.take().filter(Value::is_object).unwrap_or_else(|| json!({}));
        merge(&mut current, settings.clone());
        cfg.settings = Some(current);
    }
}

/// vue-language-server loads TypeScript as a library (`--tsdk`, else its own
/// `require('typescript')`): the selected version, else its own, else the
/// project's — whichever still has the language-service API.
fn configure_vue_typescript(cfg: &mut LanguageServerConfig, root: &Path, server_root: &Path, s: &Settings) {
    let selected = tsdk(server_root, s).or_else(|| tsdk(root, s)).filter(|l| vue::has_ts_api(l));
    let package = vue::server_package(&cfg.command, &search_path());
    let own = package.as_deref().and_then(vue::own_typescript);
    let workspace = || workspace_tsdk(server_root).or_else(|| workspace_tsdk(root)).filter(|l| vue::has_ts_api(l));
    let lib = match selected {
        Some(lib) => Some(lib),
        None if own.is_some() => None,
        None => workspace(),
    };
    match lib {
        Some(lib) => cfg.args.push(format!("--tsdk={}", lib.to_string_lossy())),
        None if own.is_none() && package.is_some() => cfg.launch_error = Some(vue::missing_typescript_message()),
        None => {}
    }
}

/// ngserver loads TypeScript and `@angular/language-service` from probe
/// locations: its own package (it depends on both), then the project. A selected
/// TypeScript version goes first (`--tsdk`); the project's Angular version decides
/// the template syntax. Without its package the server can't start.
fn configure_angular(cfg: &mut LanguageServerConfig, root: &Path, server_root: &Path, s: &Settings) {
    // Found as the launcher finds it; missing, it asks to be installed.
    let path = cfg.env.get("PATH").map_or_else(search_path, OsString::from);
    let Some(bin) = ide_core::tool_path::find_command(&cfg.command, &path, server_root) else { return };
    let Some(package) = angular::server_package(&bin, &path, server_root, &cfg.env) else {
        cfg.launch_error = Some(angular::missing_package_message(&bin));
        return;
    };
    let package = package.to_string_lossy().into_owned();
    // The server splits the list at commas.
    if package.contains(',') {
        cfg.launch_error = Some(angular::comma_message(&package));
        return;
    }
    // Launch the server whose package is probed, not another one on the path.
    cfg.command = bin.to_string_lossy().into_owned();
    let project = server_root.to_string_lossy();
    let probes = if project.contains(',') { package } else { format!("{package},{project}") };
    cfg.args.extend(["--ngProbeLocations".into(), probes.clone(), "--tsProbeLocations".into(), probes]);
    if let Some(lib) = tsdk(server_root, s).or_else(|| tsdk(root, s)) {
        cfg.args.extend(["--tsdk".into(), lib.to_string_lossy().into_owned()]);
    }
    // The project root is an ancestor of the server's.
    if let Some(version) = angular::core_version(server_root) {
        cfg.args.extend(angular::version_args(&version));
    }
}

fn is_python_command(cmd: &str) -> bool {
    let name = Path::new(cmd).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let name = name.strip_suffix(".exe").unwrap_or(&name);
    name == "python"
        || name == "python3"
        || name.strip_prefix("python3.").is_some_and(|v| v.chars().all(|c| c.is_ascii_digit()))
}

const PY_RUNNERS: [&str; 3] = ["uv", "poetry", "pdm"];

/// Points run configurations at the selected toolchains: Python configs use the
/// project interpreter, npm scripts the chosen package manager and Node.js,
/// cargo / go configs the selected toolchain.
pub fn apply_to_run_configs(configs: &mut [RunConfig], root: &Path, s: &Settings) {
    let explicit_python = setting_path(root, &s.languages.python.interpreter);
    let pm = non_empty(&s.languages.node.package_manager);
    let php = setting_path(root, &s.languages.php.interpreter);
    let rust = rust_bin(root, s);
    let gopath = setting_path(root, &s.languages.go.gopath);

    // Module-local toolchains, looked up once per owning module and only for the kinds using them.
    let mut toolchains: HashMap<(&'static str, PathBuf), Option<PathBuf>> = HashMap::new();
    let mut toolchain = |tool: &'static str, owner: &Path| {
        toolchains
            .entry((tool, owner.to_path_buf()))
            .or_insert_with(|| {
                // A module outside the project (an external linked build) keeps the project's choices.
                let near = if owner.starts_with(root) { owner } else { root };
                match tool {
                    "python" => python_interpreter_near(root, Some(near), s),
                    "node" if non_empty(&s.languages.node.interpreter).is_none() => {
                        node_dir(near, s).or_else(|| node_dir(root, s))
                    }
                    "node" => node_dir(root, s),
                    "go" if non_empty(&s.languages.go.goroot).is_none() => goroot(near, s).or_else(|| goroot(root, s)),
                    "go" => goroot(root, s),
                    _ => setting_path(root, &s.languages.ruby.interpreter).or_else(|| ruby_interpreter(near, s)),
                }
            })
            .clone()
    };

    for c in configs.iter_mut() {
        let owner = ide_run::scope::owner(root, c);
        resolve_run_command(c, root, s);
        let mut path_dirs: Vec<PathBuf> = Vec::new();
        match c.kind.as_str() {
            "python" | "pytest" | "django-test" => {
                if let Some(py) = &explicit_python {
                    let runner = PY_RUNNERS.contains(&c.command.as_str());
                    if (c.kind == "python" || c.kind == "django-test") && (runner || is_python_command(&c.command)) {
                        if runner && c.args.first().map(String::as_str) == Some("run") {
                            // `uv run python …` → `<interpreter> …`
                            let skip = if c.args.get(1).is_some_and(|a| is_python_command(a)) { 2 } else { 1 };
                            c.args.drain(..skip.min(c.args.len()));
                        }
                        c.command = py.to_string_lossy().into_owned();
                    } else if c.kind == "pytest" && c.detected {
                        let rest: Vec<String> = match c.args.as_slice() {
                            [run, tool, rest @ ..] if run == "run" && tool == "pytest" => rest.to_vec(),
                            [m, tool, rest @ ..] if m == "-m" && tool == "pytest" => rest.to_vec(),
                            other => other.to_vec(),
                        };
                        c.command = py.to_string_lossy().into_owned();
                        c.args = ["-m".to_owned(), "pytest".to_owned()].into_iter().chain(rest).collect();
                    }
                }
                let python = toolchain("python", &owner);
                if let Some(venv) = python.as_deref().and_then(venv_of)
                    && !c.env.contains_key("VIRTUAL_ENV")
                {
                    c.env.insert("VIRTUAL_ENV".into(), venv.to_string_lossy().into_owned());
                    path_dirs.push(venv.join(bin_dir()));
                }
            }
            "npm" | "node" | "deno" | "bun" => {
                if let Some(pm) = pm
                    && c.kind == "npm"
                    && c.detected
                    && matches!(c.command.as_str(), "npm" | "pnpm" | "yarn" | "bun")
                {
                    c.command = pm.to_owned();
                }
                // The configuration's own Node interpreter, else the project's.
                let own = c.extras.params.get("nodeInterpreter").and_then(|p| setting_path(root, p));
                if let Some(dir) =
                    own.and_then(|p| p.parent().map(Path::to_path_buf)).or_else(|| toolchain("node", &owner))
                {
                    path_dirs.push(dir);
                }
            }
            "php" | "phpunit" | "composer" => {
                if let Some(php) = &php {
                    if c.kind == "php" && c.detected && c.command == "php" {
                        c.command = php.to_string_lossy().into_owned();
                    }
                    path_dirs.extend(php.parent().map(Path::to_path_buf));
                }
            }
            "cargo" => {
                if let Some((bin, toolchain)) = &rust {
                    if c.command == "cargo" && bin.join(exe("cargo")).is_file() {
                        c.command = bin.join(exe("cargo")).to_string_lossy().into_owned();
                    }
                    path_dirs.push(bin.clone());
                    if let Some(t) = toolchain {
                        c.env.entry("RUSTUP_TOOLCHAIN".into()).or_insert_with(|| t.clone());
                    }
                }
            }
            "go" => {
                for (key, value) in crate::go::module_environment(root, &s.languages.go.modules) {
                    c.env.entry(key).or_insert(value);
                }
                if let Some(goroot) = &toolchain("go", &owner) {
                    let bin = goroot.join("bin");
                    if c.command == "go" && bin.join(exe("go")).is_file() {
                        c.command = bin.join(exe("go")).to_string_lossy().into_owned();
                    }
                    c.env.entry("GOROOT".into()).or_insert_with(|| goroot.to_string_lossy().into_owned());
                    path_dirs.push(bin);
                }
                if let Some(gopath) = &gopath {
                    c.env.entry("GOPATH".into()).or_insert_with(|| gopath.to_string_lossy().into_owned());
                }
            }

            "ruby" | "rake" | "rspec" => {
                if let Some(ruby) = &toolchain("ruby", &owner)
                    && let Some(bin) = crate::ruby::bin_dir_of(ruby)
                {
                    // `ruby`, `bundle`, `rake`, `rspec` of the chosen interpreter when installed
                    // alongside it; the rest (a project `bin/rspec` binstub) stays as is.
                    let name = Path::new(&c.command).file_name().map(|n| n.to_string_lossy().into_owned());
                    if let Some(name) = name
                        && matches!(name.as_str(), "ruby" | "bundle" | "rake" | "rspec" | "gem" | "irb")
                        && !c.command.contains('/')
                        && !c.command.contains('\\')
                    {
                        let exe = bin.join(exe(&name));
                        if exe.is_file() {
                            c.command = exe.to_string_lossy().into_owned();
                        }
                    }
                    path_dirs.push(bin);
                }
            }

            _ => {}
        }
        if !path_dirs.is_empty() && !c.env.contains_key("PATH") {
            let dirs: Vec<&Path> = path_dirs.iter().map(PathBuf::as_path).collect();
            c.env.insert("PATH".into(), path_with(&dirs));
        }
    }
}

/// `config` as it should be saved: without what [`apply_to_run_configs`] derives from
/// settings, so a configuration read from the run list, edited and saved keeps following
/// Languages & Frameworks instead of freezing today's toolchain (and the IDE's whole
/// `PATH`) into `run.toml`. A value counts as derived when applying settings to the
/// configuration without it produces it again: an environment entry (`PATH`,
/// `VIRTUAL_ENV`, `GOROOT`, …) or an absolute command its bare name
/// resolves to (the project interpreter, a toolchain's `cargo` / `go`).
pub fn without_derived(config: &RunConfig, root: &Path, s: &Settings) -> RunConfig {
    let applied = |c: &RunConfig| {
        let mut c = c.clone();
        apply_to_run_configs(std::slice::from_mut(&mut c), root, s);
        c
    };
    let mut out = config.clone();
    // Until nothing changes: some entries are derived only once others are gone
    // (the virtualenv's `PATH` is added only without `VIRTUAL_ENV`). An entry derived before
    // the configuration's own choice (an npm script's Node interpreter) is derived too.
    while let Some(key) = out
        .env
        .iter()
        .find(|(key, value)| {
            let mut probe = out.clone();
            probe.env.remove(*key);
            let mut plain = probe.clone();
            plain.extras.params.clear();
            applied(&probe).env.get(*key) == Some(*value) || applied(&plain).env.get(*key) == Some(*value)
        })
        .map(|(key, _)| key.clone())
    {
        out.env.remove(&key);
    }

    let path = Path::new(&config.command);
    if path.is_absolute()
        && let Some(name) = path.file_name().map(|n| n.to_string_lossy().into_owned())
    {
        let mut probe = out.clone();
        probe.command = name.clone();
        if applied(&probe).command == config.command {
            out.command = name;
        }
    }
    out
}

fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

/// Command typed into a new terminal to activate the project virtualenv
/// (Tools › Terminal › "Activate virtualenv"). `shell` must be the resolved PTY shell.
pub fn terminal_activation(root: &Path, s: &Settings, shell: &str) -> Option<String> {
    if !s.languages.python.activate_virtualenv {
        return None;
    }
    let venv = python_interpreter(root, s).as_deref().and_then(venv_of)?;
    if std::env::var_os("VIRTUAL_ENV").is_some_and(|v| Path::new(&v) == venv) {
        return None;
    }
    let name = shell.rsplit(['/', '\\']).next().unwrap_or(shell);
    let name = Path::new(name).file_stem().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    let script = |file: &str| venv.join(bin_dir()).join(file);
    let line = match name.as_str() {
        "fish" => format!("source {}", sh_quote(&script("activate.fish").to_string_lossy())),
        "csh" | "tcsh" => format!("source {}", sh_quote(&script("activate.csh").to_string_lossy())),
        "nu" => format!("overlay use {}", sh_quote(&script("activate.nu").to_string_lossy())),
        "pwsh" | "powershell" => format!("& '{}'", script("Activate.ps1").to_string_lossy().replace('\'', "''")),
        "cmd" => format!("\"{}\"", script("activate.bat").to_string_lossy()),
        "sh" | "bash" | "zsh" | "dash" | "ksh" | "mksh" | "ash" => {
            format!("source {}", sh_quote(&script("activate").to_string_lossy()))
        }
        // Not a shell (e.g. `docker exec` in a terminal tab): type nothing.
        _ => return None,
    };
    let target = match name.as_str() {
        "fish" => "activate.fish",
        "csh" | "tcsh" => "activate.csh",
        "nu" => "activate.nu",
        "pwsh" | "powershell" => "Activate.ps1",
        "cmd" => "activate.bat",
        _ => "activate",
    };
    script(target).is_file().then_some(line)
}

#[cfg(all(test, unix))]
mod ruby_lsp_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn ruby_lsp_is_found_in_the_rubys_gem_bindir_when_that_is_off_path() {
        let tmp = tempfile::tempdir().unwrap();
        let bindir = tmp.path().join("gems/bin");
        std::fs::create_dir_all(&bindir).unwrap();
        // Homebrew's Ruby: `Gem.bindir` is not on `PATH`.
        let ruby = tmp.path().join("ruby");
        std::fs::write(&ruby, format!("#!/bin/sh\necho '{}'\necho '/nonexistent/user/bin'\n", bindir.display()))
            .unwrap();
        std::fs::set_permissions(&ruby, std::fs::Permissions::from_mode(0o755)).unwrap();
        let mut s = Settings::default();
        s.languages.ruby.interpreter = ruby.to_string_lossy().into_owned();
        let mut cfg = custom_server("ruby-lsp", &LanguageServerSettings::default());
        configure_server(&mut cfg, tmp.path(), tmp.path(), &s);
        let path = cfg.env.get("PATH").expect("PATH set");
        let dirs: Vec<PathBuf> = std::env::split_paths(path).collect();
        assert!(dirs.contains(&bindir), "{dirs:?}");
        assert!(!dirs.iter().any(|d| d.starts_with("/nonexistent")), "{dirs:?}");
    }
}
