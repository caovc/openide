//! Session adapter launch contract. SAS deliberately has no runtime adapter.
use crate::kernel::KernelRuntime;
use ide_core::{IdeError, IdeResult};

pub struct SessionAdapter {
    pub language: &'static str,
    pub target: &'static str,
    pub bootstrap: Option<&'static str>,
}

impl SessionAdapter {
    pub fn for_runtime(runtime: &KernelRuntime) -> Self {
        match runtime {
            KernelRuntime::Python { .. } => Self {
                language: "python",
                target: "openide.variables",
                bootstrap: Some(include_str!("session_python.py")),
            },
            KernelRuntime::Ark { .. } => Self { language: "R", target: "positron.variables", bootstrap: None },
        }
    }

    /// Reserved contract entry, not a SAS execution or inspection implementation.
    pub fn sas() -> IdeResult<Self> {
        Err(IdeError::unavailable("SAS session adapter is not implemented"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adapter_capabilities_are_explicit_and_sas_cannot_fall_back() {
        let python = SessionAdapter::for_runtime(&KernelRuntime::python("python"));
        assert_eq!(python.language, "python");
        assert!(python.bootstrap.is_some());
        let r = SessionAdapter::for_runtime(&KernelRuntime::Ark { executable: "ark".into(), r_home: "R".into() });
        assert_eq!(r.target, "positron.variables");
        assert!(r.bootstrap.is_none());
        assert!(SessionAdapter::sas().is_err());
    }
}
