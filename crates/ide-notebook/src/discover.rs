//! Discover notebook kernel runtimes (Python is still via ide-sdk; Ark lives here).

use ide_core::{IdeError, IdeResult};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::{Path, PathBuf};

/// Opaque selection passed through the existing `notebook_execute` python parameter.
/// Python: absolute interpreter path (unchanged).
/// Ark: `ark|<ark_abs>|<r_home_abs>` (pipe-separated; paths must be absolute).
pub const ARK_SELECTION_PREFIX: &str = "ark|";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NotebookRuntimeInfo {
    /// Value to pass to notebook execute / store in UI state.
    pub id: String,
    /// `python` or `ark`.
    pub kind: String,
    pub name: String,
    pub path: String,
    pub home: Option<String>,
}

/// Parse the execute selection string into a concrete runtime.
pub fn parse_selection(selection: &str) -> IdeResult<crate::kernel::KernelRuntime> {
    let selection = selection.trim();
    if selection.is_empty() {
        return Err(IdeError::invalid("select a notebook kernel"));
    }
    if let Some(rest) = selection.strip_prefix(ARK_SELECTION_PREFIX) {
        let mut parts = rest.splitn(2, '|');
        let ark = parts.next().unwrap_or_default();
        let r_home = parts.next().unwrap_or_default();
        if ark.is_empty() || r_home.is_empty() {
            return Err(IdeError::invalid("ark kernel selection requires ark path and R_HOME"));
        }
        let executable = PathBuf::from(ark);
        let r_home = PathBuf::from(r_home);
        if !executable.is_absolute() || !r_home.is_absolute() {
            return Err(IdeError::invalid("ark kernel paths must be absolute"));
        }
        if !executable.is_file() {
            return Err(IdeError::unavailable(format!("ark executable not found: {}", executable.display())));
        }
        if !r_home.is_dir() {
            return Err(IdeError::unavailable(format!("R_HOME not found: {}", r_home.display())));
        }
        return Ok(crate::kernel::KernelRuntime::Ark { executable, r_home });
    }
    let executable = PathBuf::from(selection);
    if !executable.is_absolute() {
        return Err(IdeError::invalid("python interpreter path must be absolute"));
    }
    Ok(crate::kernel::KernelRuntime::python(executable))
}

pub fn encode_ark(ark: &Path, r_home: &Path) -> String {
    format!("{ARK_SELECTION_PREFIX}{}|{}", ark.display(), r_home.display())
}

/// Find Ark + R_HOME candidates. Never invents a Python fallback.
pub fn detect_ark() -> Vec<NotebookRuntimeInfo> {
    let mut out: Vec<NotebookRuntimeInfo> = Vec::new();
    let mut push = |ark: PathBuf, r_home: PathBuf, source: &str| {
        if !ark.is_file() || !r_home.is_dir() {
            return;
        }
        let Ok(ark) = std::fs::canonicalize(&ark) else { return };
        let Ok(r_home) = std::fs::canonicalize(&r_home) else { return };
        let id = encode_ark(&ark, &r_home);
        if out.iter().any(|item: &NotebookRuntimeInfo| item.id == id) {
            return;
        }
        out.push(NotebookRuntimeInfo {
            id,
            kind: "ark".into(),
            name: format!("Ark R ({source})"),
            path: ark.to_string_lossy().into_owned(),
            home: Some(r_home.to_string_lossy().into_owned()),
        });
    };

    if let Ok(ark) = std::env::var("OPENIDE_ARK") {
        let ark = PathBuf::from(ark);
        if let Some(r_home) = resolve_r_home(None) {
            push(ark, r_home, "OPENIDE_ARK");
        }
    }

    if let Some(ark) = which("ark")
        && let Some(r_home) = resolve_r_home(None)
    {
        push(ark, r_home, "path");
    }

    // Dev default used on this box when building from source.
    let default = PathBuf::from("/workspace/ark/target/release/ark");
    if default.is_file()
        && let Some(r_home) = resolve_r_home(Some(Path::new("/workspace/mamba/envs/r/lib/R")))
    {
        push(default, r_home, "workspace");
    }

    out
}

fn resolve_r_home(preferred: Option<&Path>) -> Option<PathBuf> {
    if let Some(path) = preferred
        && path.is_dir()
    {
        return std::fs::canonicalize(path).ok();
    }
    if let Ok(home) = std::env::var("R_HOME") {
        let home = PathBuf::from(home);
        if home.is_dir() {
            return std::fs::canonicalize(home).ok();
        }
    }
    if let Some(r) = which("R") {
        // `R RHOME` is authoritative when R is on PATH.
        let output = std::process::Command::new(&r).arg("RHOME").output().ok()?;
        if !output.status.success() {
            return None;
        }
        let home = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        let home = PathBuf::from(home);
        return home.is_dir().then(|| std::fs::canonicalize(home).ok()).flatten();
    }
    None
}

fn which(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::KernelRuntime;

    #[test]
    fn rejects_empty_and_relative_python() {
        assert!(parse_selection("").is_err());
        assert!(parse_selection("venv/bin/python").is_err());
    }

    #[test]
    fn rejects_incomplete_ark_without_python_fallback() {
        let err = parse_selection("ark|/no/such/ark|/no/such/R").unwrap_err();
        assert!(!err.to_string().to_lowercase().contains("python"));
        assert!(matches!(
            parse_selection("ark|only-one-part").unwrap_err().kind,
            ide_core::error::ErrorKind::InvalidInput
        ));
    }

    #[test]
    fn encodes_and_parses_roundtrip_shape() {
        let ark = PathBuf::from("/tmp/does-not-need-to-exist-for-encode");
        let home = PathBuf::from("/tmp/rhome");
        let id = encode_ark(&ark, &home);
        assert!(id.starts_with(ARK_SELECTION_PREFIX));
        // parse checks file existence — missing files are Unavailable, not Python.
        let err = parse_selection(&id).unwrap_err();
        assert!(matches!(err.kind, ide_core::error::ErrorKind::Unavailable | ide_core::error::ErrorKind::InvalidInput));
    }

    #[test]
    fn python_absolute_parses() {
        // Existence not required for Python parse (kernel spawn validates later), only absolute.
        match parse_selection("/usr/bin/python3").unwrap() {
            KernelRuntime::Python { executable } => assert_eq!(executable, PathBuf::from("/usr/bin/python3")),
            KernelRuntime::Ark { .. } => panic!("expected python"),
        }
    }

    #[test]
    fn detect_finds_workspace_or_env_ark() {
        // Prefer env override used on this box; skip when neither env nor workspace binary exists.
        let workspace = PathBuf::from("/workspace/ark/target/release/ark");
        let has_env = std::env::var_os("OPENIDE_ARK").is_some();
        if !has_env && !workspace.is_file() {
            eprintln!("skip: no OPENIDE_ARK and no workspace ark binary");
            return;
        }
        let found = detect_ark();
        assert!(!found.is_empty(), "detect_ark returned no runtimes");
        assert!(found.iter().all(|item| item.kind == "ark"));
        assert!(found.iter().all(|item| item.id.starts_with(ARK_SELECTION_PREFIX)));
        let first = &found[0];
        match parse_selection(&first.id).unwrap() {
            KernelRuntime::Ark { executable, r_home } => {
                assert!(executable.is_file());
                assert!(r_home.is_dir());
            }
            KernelRuntime::Python { .. } => panic!("ark selection must not parse as Python"),
        }
    }
}
