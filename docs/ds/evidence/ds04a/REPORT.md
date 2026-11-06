# DS-04A — Python script debug environment acceptance

Date: 2026-11-06 (Asia/Shanghai). This is an incremental implementation and real adapter acceptance, not completion of all Python/R debugger UI work.

## Behavior changed

Python debug launch now recognizes Windows backslash paths and UNC paths, preserving the selected interpreter instead of treating its path as a Python module. A path to `pytest.exe` resolves the sibling `python.exe`. Existing bare-name, script/module and uv/Poetry launch behavior is retained. Tests cover the explicit interpreter, arguments containing spaces, cwd and environment propagation.

The ignored real debugpy integration test accepts `OPENIDEA_TEST_PYTHON`, prints the actual interpreter/debugpy version, and fails explicitly if that interpreter cannot import debugpy. A missing dependency is no longer reported as a passing test. It verifies a breakpoint on line 3 at `x=41`, watch `x+1=42`, step to `x=42`, continue with output 42, the actual `sys.executable`, cwd, arguments and environment, and removal of the terminated session. An initial redundant stop after termination was corrected to assert removal: the manager removes a session before emitting its termination event.

## Verification

- Frontend launch suite: **21 passed**; targeted oxlint and TypeScript check passed.
- `cargo test -p ide-dap --test debugpy -- --ignored --nocapture`: **1 passed** with `/workspace/work/ds-runtime/python/bin/python`, debugpy **1.8.22**.
- The same command with `OPENIDEA_TEST_PYTHON=/workspace/work/ds-runtime/python-second/bin/python`: **1 passed**, same debugpy version, actual interpreter verified separately.
- Whole workspace/all-targets strict clippy passed with this patch integrated.
- Windows/UNC behavior is unit-tested; Windows runtime acceptance was not run in the Linux container.

Reproduction in this workspace:

```bash
source /workspace/tooling/env.sh
source /workspace/work/ds-runtime/env.sh
cargo test -p ide-dap --test debugpy -- --ignored --nocapture
OPENIDEA_TEST_PYTHON="$OPENIDEA_TEST_PYTHON_SECOND" cargo test -p ide-dap --test debugpy -- --ignored --nocapture
```

## Remaining scope

The existing script runtime path comes from the run configuration/project SDK; Notebook and Console can independently select environments. This patch validates an explicit script configuration, not a unified environment picker. DS-01E0/E4 must define project defaults and explicit session/configuration overrides without changing other live sessions. GUI breakpoint/watch interaction and environment-picker-to-launch acceptance remain pending. Python Notebook debugging (DS-04B) and R debugging UI (DS-04C/D) remain separate tasks.

See `docs/ds/research/2026-11-06-environments.md` and `docs/ds/research/2026-11-06-debug-capabilities.md` for subsequent contracts and acceptance requirements.
