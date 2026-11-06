//! Read-only project metadata. Runtime activation must be verified in the R session separately.

use ide_core::{IdeError, IdeResult};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::io::Read;
use std::path::Path;

const MAX_LOCK_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum RenvStatus {
    NotPresent,
    DetectedInactive,
    Unavailable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RProjectEnvironment {
    pub project_root: String,
    pub renv_status: RenvStatus,
    pub has_lockfile: bool,
    pub has_activate_script: bool,
    pub has_project_profile: bool,
    pub locked_r_version: Option<String>,
    pub locked_package_count: Option<u32>,
    pub diagnostics: Vec<String>,
}

/// Inspect exactly this project root without following ancestor projects or executing R code.
/// This performs filesystem I/O; async command handlers must call it on a blocking worker.
pub fn inspect_r_environment(project_root: &Path) -> IdeResult<RProjectEnvironment> {
    if !project_root.is_absolute() {
        return Err(IdeError::invalid("R project root must be absolute"));
    }
    let root = std::fs::canonicalize(project_root)?;
    if !root.is_dir() {
        return Err(IdeError::invalid("R project root must be a directory"));
    }
    let mut diagnostics = Vec::new();
    let has_lockfile = marker_file(&root, "renv.lock", &mut diagnostics);
    let has_activate_script = marker_file(&root, "renv/activate.R", &mut diagnostics);
    let has_project_profile = marker_file(&root, ".Rprofile", &mut diagnostics);
    let mut locked_r_version = None;
    let mut locked_package_count = None;
    if has_lockfile {
        match read_lock(&root.join("renv.lock")) {
            Ok((version, packages)) => {
                locked_r_version = Some(version);
                locked_package_count = packages;
            }
            Err(error) => diagnostics.push(format!("Cannot inspect renv.lock: {error}")),
        }
    }
    let renv_status = if !diagnostics.is_empty() {
        RenvStatus::Unavailable
    } else if has_lockfile || has_activate_script {
        RenvStatus::DetectedInactive
    } else {
        RenvStatus::NotPresent
    };
    if renv_status == RenvStatus::DetectedInactive && !has_activate_script {
        diagnostics.push(
            "renv.lock is present, but renv/activate.R is missing; activation cannot be verified from these project files."
                .into(),
        );
    }
    Ok(RProjectEnvironment {
        project_root: root.to_string_lossy().into_owned(),
        renv_status,
        has_lockfile,
        has_activate_script,
        has_project_profile,
        locked_r_version,
        locked_package_count,
        diagnostics,
    })
}

fn marker_file(root: &Path, relative: &str, diagnostics: &mut Vec<String>) -> bool {
    let path = root.join(relative);
    match std::fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => {
            diagnostics.push(format!("Cannot inspect {relative}: {error}"));
            false
        }
        Ok(_) => match std::fs::metadata(&path) {
            Ok(metadata) if metadata.is_file() => true,
            Ok(_) => {
                diagnostics.push(format!("{relative} must be a regular file"));
                false
            }
            Err(error) => {
                diagnostics.push(format!("Cannot inspect {relative}: {error}"));
                false
            }
        },
    }
}

fn read_lock(path: &Path) -> Result<(String, Option<u32>), String> {
    let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("must be a regular file".into());
    }
    if metadata.len() > MAX_LOCK_BYTES {
        return Err("exceeds the 4 MiB inspection limit".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_LOCK_BYTES + 1).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_LOCK_BYTES {
        return Err("exceeds the 4 MiB inspection limit".into());
    }
    let lock: serde_json::Value = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    let version = lock
        .get("R")
        .and_then(|r| r.get("Version"))
        .and_then(|version| version.as_str())
        .filter(|version| !version.trim().is_empty() && version.len() <= 128)
        .ok_or("R.Version must be a non-empty version string (at most 128 bytes)")?;
    let packages = lock
        .get("Packages")
        .map(|packages| {
            packages
                .as_object()
                .ok_or_else(|| "Packages must be an object".to_owned())
                .and_then(|packages| u32::try_from(packages.len()).map_err(|_| "too many package entries".into()))
        })
        .transpose()?;
    Ok((version.to_owned(), packages))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn write_lock(root: &Path, value: serde_json::Value) {
        std::fs::write(root.join("renv.lock"), serde_json::to_vec(&value).unwrap()).unwrap();
    }

    #[test]
    fn plain_project_and_profile_are_not_renv_environments() {
        let dir = tempfile::tempdir().unwrap();
        let plain = inspect_r_environment(dir.path()).unwrap();
        assert_eq!(plain.renv_status, RenvStatus::NotPresent);
        assert!(!plain.has_project_profile);
        std::fs::write(dir.path().join(".Rprofile"), "stop('must not execute')").unwrap();
        let profile = inspect_r_environment(dir.path()).unwrap();
        assert_eq!(profile.renv_status, RenvStatus::NotPresent);
        assert!(profile.has_project_profile);
        assert!(profile.diagnostics.is_empty());
    }

    #[test]
    fn lock_reports_metadata_but_never_activation() {
        let dir = tempfile::tempdir().unwrap();
        write_lock(dir.path(), json!({"R": {"Version": "4.5.0"}, "Packages": {"renv": {}, "tibble": {}}}));
        let result = inspect_r_environment(dir.path()).unwrap();
        assert_eq!(result.renv_status, RenvStatus::DetectedInactive);
        assert_eq!(result.locked_r_version.as_deref(), Some("4.5.0"));
        assert_eq!(result.locked_package_count, Some(2));
        assert!(result.has_lockfile);
        assert!(!result.has_activate_script);
        assert_eq!(result.diagnostics.len(), 1);
        assert_eq!(serde_json::to_value(result).unwrap()["renvStatus"], "detected-inactive");
    }

    #[test]
    fn scripts_are_not_executed_and_no_ancestor_environment_is_inherited() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("renv")).unwrap();
        std::fs::create_dir_all(dir.path().join("nested/project")).unwrap();
        let script = "writeLines('ran', 'unexpected-activation'); stop('must not execute')";
        std::fs::write(dir.path().join(".Rprofile"), script).unwrap();
        std::fs::write(dir.path().join("renv/activate.R"), script).unwrap();
        let parent = inspect_r_environment(dir.path()).unwrap();
        assert_eq!(parent.renv_status, RenvStatus::DetectedInactive);
        assert!(parent.has_activate_script && parent.has_project_profile);
        assert_eq!(parent.locked_r_version, None);
        assert!(!dir.path().join("unexpected-activation").exists());
        assert_eq!(
            inspect_r_environment(&dir.path().join("nested/project")).unwrap().renv_status,
            RenvStatus::NotPresent
        );
    }

    #[test]
    fn malformed_lock_is_unavailable_and_not_partial_metadata() {
        let dir = tempfile::tempdir().unwrap();
        for value in
            [json!(null), json!({}), json!({"R": {"Version": ""}}), json!({"R": {"Version": "4.5.0"}, "Packages": []})]
        {
            write_lock(dir.path(), value);
            let result = inspect_r_environment(dir.path()).unwrap();
            assert_eq!(result.renv_status, RenvStatus::Unavailable);
            assert!(result.has_lockfile);
            assert!(result.locked_r_version.is_none() && result.locked_package_count.is_none());
            assert!(!result.diagnostics.is_empty());
        }
        std::fs::write(dir.path().join("renv.lock"), b"{invalid json").unwrap();
        assert_eq!(inspect_r_environment(dir.path()).unwrap().renv_status, RenvStatus::Unavailable);
    }

    #[test]
    fn limits_lock_reads_and_rejects_non_files() {
        let dir = tempfile::tempdir().unwrap();
        let file = std::fs::File::create(dir.path().join("renv.lock")).unwrap();
        file.set_len(MAX_LOCK_BYTES + 1).unwrap();
        let result = inspect_r_environment(dir.path()).unwrap();
        assert_eq!(result.renv_status, RenvStatus::Unavailable);
        assert!(result.diagnostics[0].contains("4 MiB"));
        drop(file);
        std::fs::remove_file(dir.path().join("renv.lock")).unwrap();
        std::fs::create_dir(dir.path().join("renv.lock")).unwrap();
        let result = inspect_r_environment(dir.path()).unwrap();
        assert_eq!(result.renv_status, RenvStatus::Unavailable);
        assert!(!result.has_lockfile);
    }

    #[test]
    fn requires_an_existing_absolute_project_directory() {
        assert!(inspect_r_environment(Path::new("relative")).is_err());
        let dir = tempfile::tempdir().unwrap();
        assert!(inspect_r_environment(&dir.path().join("absent")).is_err());
        std::fs::write(dir.path().join("file"), "").unwrap();
        assert!(inspect_r_environment(&dir.path().join("file")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn broken_marker_symlinks_are_unavailable() {
        let dir = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink("missing.lock", dir.path().join("renv.lock")).unwrap();
        let result = inspect_r_environment(dir.path()).unwrap();
        assert_eq!(result.renv_status, RenvStatus::Unavailable);
        assert!(!result.has_lockfile);
    }
}
