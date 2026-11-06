//! Python environments: creating virtualenvs and managing packages with pip
//! (or `uv pip` for environments created by uv, which ship without pip).

use crate::exec::{query_in, stream, which};
use crate::{Sdk, bin_dir, exe, venv_of};
use ide_core::{CancellationToken, IdeError, IdeResult};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonPackage {
    pub name: String,
    pub version: String,
}

/// The selected interpreter's own identity and discoverable dependencies.
/// Dependency flags do not imply that importing or running a package succeeds.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PythonEnvironmentInfo {
    pub executable: String,
    pub version: String,
    pub prefix: String,
    pub base_prefix: String,
    pub is_virtualenv: bool,
    pub ipykernel: bool,
    pub debugpy: bool,
    pub pip: bool,
}

const ENVIRONMENT_MARKER: &str = "__OPENIDE_PYTHON_ENV__";
const ENVIRONMENT_PROBE: &str = r#"
import importlib.util, json, sys
print("__OPENIDE_PYTHON_ENV__" + json.dumps({
    "executable": sys.executable,
    "version": sys.version.split()[0],
    "prefix": sys.prefix,
    "basePrefix": sys.base_prefix,
    "isVirtualenv": sys.prefix != sys.base_prefix,
    "ipykernel": importlib.util.find_spec("ipykernel") is not None,
    "debugpy": importlib.util.find_spec("debugpy") is not None,
    "pip": importlib.util.find_spec("pip") is not None,
}))
"#;

/// Inspects an explicitly selected interpreter without importing the probed packages.
/// A neutral cwd and `-E` exclude project modules/PYTHONPATH while preserving user-site packages.
/// The caller must require project trust and run this bounded query off the UI thread.
pub fn inspect_environment(python: &Path) -> IdeResult<PythonEnvironmentInfo> {
    if !python.is_absolute() {
        return Err(IdeError::invalid("Python environment inspection requires an absolute interpreter path"));
    }
    if !python.is_file() {
        return Err(IdeError::not_found(format!("Python interpreter not found: {}", python.display())));
    }
    let dir = neutral_dir().ok_or_else(|| IdeError::internal("cannot create a neutral Python inspection directory"))?;
    let output = query_in(python, &["-E", "-c", ENVIRONMENT_PROBE], Some(dir.path()), &[], Duration::from_secs(10))
        .ok_or_else(|| {
            IdeError::unavailable(format!(
                "cannot inspect Python environment at {}: interpreter failed or exceeded the 10-second deadline",
                python.display()
            ))
        })?;
    parse_environment(&output).map_err(|error| {
        IdeError::unavailable(format!("invalid Python environment response from {}: {error}", python.display()))
    })
}

fn parse_environment(output: &str) -> Result<PythonEnvironmentInfo, String> {
    let json = output
        .lines()
        .rev()
        .find_map(|line| line.strip_prefix(ENVIRONMENT_MARKER))
        .ok_or_else(|| "missing environment record".to_owned())?;
    let info: PythonEnvironmentInfo = serde_json::from_str(json).map_err(|error| error.to_string())?;
    if [&info.executable, &info.version, &info.prefix, &info.base_prefix].iter().any(|value| value.is_empty()) {
        return Err("incomplete interpreter identity".to_owned());
    }
    Ok(info)
}

/// Creates a virtualenv at `location` with `base -m venv` and returns its interpreter.
pub fn create_venv(
    base: &Path,
    location: &Path,
    cancel: &CancellationToken,
    on_line: &dyn Fn(String),
) -> IdeResult<Sdk> {
    if location.join("pyvenv.cfg").is_file() {
        return Err(IdeError::new(
            ide_core::error::ErrorKind::AlreadyExists,
            format!("{} already contains a virtual environment", location.display()),
        ));
    }
    if let Some(parent) = location.parent() {
        std::fs::create_dir_all(parent)?;
    }
    stream(base, &venv_args(location), None, &[], cancel, on_line)?;
    let python = location.join(bin_dir()).join(exe("python"));
    crate::discover::python_sdk(&python, "venv", location.parent().and_then(Path::parent))
        .ok_or_else(|| IdeError::internal(format!("{} was not created", python.display())))
}

/// Arguments of `base -m venv location`. `-I` (isolated mode) keeps the working
/// directory off `sys.path`: a project's `logging.py` or `typing.py` there would
/// otherwise shadow the standard library modules venv imports. (`-P` does just
/// that but needs Python 3.11.)
pub(crate) fn venv_args(location: &Path) -> Vec<String> {
    vec!["-I".to_owned(), "-m".to_owned(), "venv".to_owned(), location.to_string_lossy().into_owned()]
}

/// A fresh, empty, private directory to run `python -m …` / `python -c …` in. Python
/// puts the working directory first on `sys.path` for those, and the IDE's own (or a
/// project's) could hold modules that shadow the standard library or pip. Not `-I`:
/// that also drops the user site, hiding `pip install --user` packages. `None` (the
/// inherited directory) if it cannot be created.
pub(crate) fn neutral_dir() -> Option<tempfile::TempDir> {
    tempfile::Builder::new().prefix("openidea-python-").tempdir().ok()
}

/// How packages of an interpreter are managed.
enum Installer {
    Pip,
    /// `uv pip … --python <interpreter>`.
    Uv(PathBuf),
}

fn has_pip(python: &Path) -> bool {
    let dir = neutral_dir();
    query_in(python, &["-m", "pip", "--version"], dir.as_ref().map(|d| d.path()), &[], Duration::from_secs(10))
        .is_some()
}

fn installer(python: &Path) -> IdeResult<Installer> {
    if has_pip(python) {
        return Ok(Installer::Pip);
    }
    if let Some(uv) = which("uv") {
        return Ok(Installer::Uv(uv));
    }
    Err(IdeError::unavailable(format!(
        "pip is not available for {} (install it with `{} -m ensurepip`, or install uv)",
        python.display(),
        python.display()
    )))
}

/// `(program, args)` for a pip sub-command.
fn pip_command(python: &Path, installer: &Installer, sub: &[&str]) -> (PathBuf, Vec<String>) {
    match installer {
        Installer::Pip => {
            let mut args = vec!["-m".into(), "pip".into()];
            args.extend(sub.iter().map(|s| (*s).to_owned()));
            args.push("--disable-pip-version-check".into());
            (python.to_path_buf(), args)
        }
        Installer::Uv(uv) => {
            let mut args =
                vec!["pip".to_owned(), sub[0].to_owned(), "--python".into(), python.to_string_lossy().into_owned()];
            // uv has no `-y`: uninstall never prompts.
            args.extend(sub[1..].iter().filter(|s| **s != "-y").map(|s| (*s).to_owned()));
            (uv.clone(), args)
        }
    }
}

/// Environment for pip runs: the venv activated, so console scripts land in it.
fn pip_env(python: &Path) -> Vec<(String, String)> {
    venv_of(python).map(|v| vec![("VIRTUAL_ENV".to_owned(), v.to_string_lossy().into_owned())]).unwrap_or_default()
}

/// Installed packages (`pip list --format=json`), sorted by name.
pub fn list_packages(python: &Path, cancel: &CancellationToken) -> IdeResult<Vec<PythonPackage>> {
    if !python.is_file() {
        return Err(IdeError::not_found(format!("{} does not exist", python.display())));
    }
    let installer = installer(python)?;
    let (program, args) = pip_command(python, &installer, &["list", "--format", "json"]);
    let dir = neutral_dir();
    let out = stream(&program, &args, dir.as_ref().map(|d| d.path()), &pip_env(python), cancel, &|_| {})?;
    let mut packages = parse_pip_list(&out)?;
    packages.sort_by_key(|p| p.name.to_lowercase());
    Ok(packages)
}

pub(crate) fn parse_pip_list(out: &str) -> IdeResult<Vec<PythonPackage>> {
    // Skip the echoed command line and any warnings before the JSON array.
    let json = out.lines().find(|l| l.trim_start().starts_with('[')).unwrap_or("[]");
    serde_json::from_str(json).map_err(|e| IdeError::internal(format!("unexpected pip output: {e}")))
}

/// A requirement naming a local path (`.`, `./pkg`, `../lib[dev]`) made absolute
/// against `base` (the project root): pip runs in [`neutral_dir`], not the project.
pub(crate) fn resolve_requirement(requirement: &str, base: Option<&Path>) -> IdeResult<String> {
    if !requirement.starts_with('.') {
        return Ok(requirement.to_owned());
    }
    let base = base.ok_or_else(|| IdeError::invalid("a relative path needs an open project"))?;
    Ok(base.join(requirement).to_string_lossy().into_owned())
}

/// Installs (or upgrades, with `upgrade`) a requirement such as `requests` or `django==5.0`;
/// relative paths (`./pkg`) are resolved against `project_root`.
pub fn install_package(
    python: &Path,
    requirement: &str,
    upgrade: bool,
    project_root: Option<&Path>,
    cancel: &CancellationToken,
    on_line: &dyn Fn(String),
) -> IdeResult<()> {
    let requirement = requirement.trim();
    if requirement.is_empty() || requirement.starts_with('-') {
        return Err(IdeError::invalid("enter a package name or requirement"));
    }
    let requirement = resolve_requirement(requirement, project_root)?;
    let installer = installer(python)?;
    let mut sub = vec!["install"];
    if upgrade {
        sub.push("--upgrade");
    }
    sub.push(&requirement);
    let (program, args) = pip_command(python, &installer, &sub);
    let dir = neutral_dir();
    stream(&program, &args, dir.as_ref().map(|d| d.path()), &pip_env(python), cancel, on_line).map(|_| ())
}

pub fn uninstall_package(
    python: &Path,
    name: &str,
    cancel: &CancellationToken,
    on_line: &dyn Fn(String),
) -> IdeResult<()> {
    let name = name.trim();
    if name.is_empty() || name.starts_with('-') {
        return Err(IdeError::invalid("no package selected"));
    }
    let installer = installer(python)?;
    let (program, args) = pip_command(python, &installer, &["uninstall", "-y", name]);
    let dir = neutral_dir();
    stream(&program, &args, dir.as_ref().map(|d| d.path()), &pip_env(python), cancel, on_line).map(|_| ())
}

#[cfg(test)]
mod environment_tests {
    use super::*;

    #[test]
    fn inspection_rejects_relative_and_missing_interpreters() {
        let error = inspect_environment(Path::new("python")).unwrap_err();
        assert_eq!(error.kind, ide_core::error::ErrorKind::InvalidInput);
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing-python");
        let error = inspect_environment(&missing).unwrap_err();
        assert_eq!(error.kind, ide_core::error::ErrorKind::NotFound);
        assert!(error.message.contains(missing.to_string_lossy().as_ref()));
    }

    #[test]
    fn inspection_record_preserves_environment_identity_and_tolerates_startup_noise() {
        let record = serde_json::json!({
            "executable": "/project with spaces/.venv/bin/python",
            "version": "3.12.0", "prefix": "/project with spaces/.venv", "basePrefix": "/usr",
            "isVirtualenv": true, "ipykernel": true, "debugpy": false, "pip": true,
        });
        let output = format!("startup message\n{ENVIRONMENT_MARKER}{record}\nshutdown message\n");
        let info = parse_environment(&output).unwrap();
        assert_eq!(info.executable, "/project with spaces/.venv/bin/python");
        assert_eq!(info.prefix, "/project with spaces/.venv");
        assert_eq!(info.base_prefix, "/usr");
        assert!(info.is_virtualenv && info.ipykernel && info.pip && !info.debugpy);
        assert!(parse_environment("Python 3.12").is_err());
        assert!(parse_environment(&format!("{ENVIRONMENT_MARKER}{{}}")).is_err());
        let mut incomplete = record;
        incomplete["executable"] = serde_json::json!("");
        assert!(parse_environment(&format!("{ENVIRONMENT_MARKER}{incomplete}")).is_err());
    }

    #[test]
    #[ignore = "requires OPENIDEA_TEST_PYTHON with stdlib venv; creates two real isolated environments"]
    fn real_environment_inspection_preserves_venvs_and_does_not_import_packages() {
        let base = std::env::var_os("OPENIDEA_TEST_PYTHON").expect("set OPENIDEA_TEST_PYTHON");
        let base = PathBuf::from(base);
        let base_info = inspect_environment(&base).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let mut infos = Vec::new();
        for (name, package) in [("environment A", "ipykernel"), ("environment B", "debugpy")] {
            let location = dir.path().join(name);
            let mut args = venv_args(&location);
            args.push("--without-pip".into());
            stream(&base, &args, None, &[], &CancellationToken::new(), &|_| {}).unwrap();
            let python = location.join(bin_dir()).join(exe("python"));
            let site = query_in(
                &python,
                &["-I", "-c", "import sysconfig; print(sysconfig.get_path('purelib'))"],
                Some(dir.path()),
                &[],
                Duration::from_secs(10),
            )
            .expect("venv purelib");
            std::fs::write(
                Path::new(&site).join(format!("{package}.py")),
                "raise RuntimeError('must not import probe dependencies')\n",
            )
            .unwrap();
            let info = inspect_environment(&python).unwrap();
            assert_eq!(info.executable, python.to_string_lossy());
            assert_eq!(Path::new(&info.prefix), location);
            assert_eq!(info.base_prefix, base_info.base_prefix);
            assert!(info.is_virtualenv);
            assert!(!info.pip);
            assert_eq!(info.ipykernel, package == "ipykernel");
            assert_eq!(info.debugpy, package == "debugpy");
            infos.push(info);
        }
        assert_ne!(infos[0].prefix, infos[1].prefix);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let shadow = dir.path().join("shadow modules");
            std::fs::create_dir(&shadow).unwrap();
            std::fs::write(shadow.join("json.py"), "raise RuntimeError('project module must not execute')\n").unwrap();
            let quoted = |path: &Path| format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"));
            let wrapper = dir.path().join("python-wrapper");
            std::fs::write(
                &wrapper,
                format!("#!/bin/sh\nexport PYTHONPATH={}\nexec {} \"$@\"\n", quoted(&shadow), quoted(&base)),
            )
            .unwrap();
            std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o700)).unwrap();
            let inspected = inspect_environment(&wrapper).unwrap();
            assert_eq!(inspected, base_info);
        }
        eprintln!("VERIFIED two distinct venvs, dependency isolation and discovery without package imports");
    }
}
