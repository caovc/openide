# U2 — VERIFIED

Local box execution in `/workspace/openide`; no CloudAgent, commit or push.

## API and behavior

- `KernelRuntime::{Python { executable }, Ark { executable, r_home }}`; explicit absolute paths, no fallback. Runtime changes/restart replace the owned process generation.
- Existing `KernelManager::execute(...python...)` delegates to `execute_runtime` and remains source-compatible with host/Tauri callers.
- After a runtime is ready, `manager.comms(notebook)` returns a cloned generation-bound `KernelComms`. Subscribe before `open(id, target, JSON)`, then `send_message` / `close`. Comm subscription exposes kind/id/parent/content, handles unrelated/background parents during execution and idle, and never routes comm as cell output.
- Bounded comm queues, maximum 8 MiB outbound messages; lag, invalid JSON shape, send failures and generation closure are explicit errors. Restart/stop/death invalidates old handles. JSON services only at U2; binary widget comm buffers are not implemented here.
- Ark logs go into the private session directory, avoiding its default stdout traces contaminating notebook output.
- Linux real runtime verification only. Windows Python bootstrap/job path retained; Ark on Windows explicitly fails until native supervision is implemented, rather than reusing Python interrupt handles incorrectly.

## Changed implementation/test files

- `crates/ide-notebook/src/kernel.rs`
- `crates/ide-notebook/src/kernel/process.rs`
- `crates/ide-notebook/src/kernel/transport.rs`
- `crates/ide-notebook/src/kernel/comm.rs` (new)
- `crates/ide-notebook/tests/kernel_runtime.rs`
- `crates/ide-notebook/tests/ark_smoke.rs` (existing U1 predicates retained; shared LSP probe + new product-manager smoke)
- `.agents/BOARD.md` U2 done
- `.audit/ds-ide.tsv` appended design/result; `.audit/u2-*` local evidence

Pre-existing `.gitignore`, `AGENTS.md`, `ENV.md`, `docs/ds/` work retained, not authored by U2. No Notebook UI or `languages/r.toml` edits. No dependency/lockfile changes.

## Reproduce

```bash
export PATH=/home/box/.cargo/bin:/workspace/mamba/envs/r/bin:$PATH
export OPENIDEA_TEST_PYTHON=/workspace/openide/.audit/python-u2/bin/python
export OPENIDEA_TEST_PYTHON_SECOND=/workspace/openide/.audit/python-u2-second/bin/python
cargo test --locked -p ide-notebook
cargo test --locked -p ide-notebook --test kernel_runtime -- --ignored --nocapture
cargo test --locked -p ide-notebook --test ark_smoke -- --ignored --nocapture
cargo clippy --locked -p ide-notebook --all-targets -- -D warnings
cargo fmt -p ide-notebook -- --check
git diff --check
```

Final command exit codes and Asia/Shanghai timestamps: `.audit/u2-verification.tsv` (all 0).
Default suite: 35 passed, 9 opt-in ignored. Real Python: all 7 ignored acceptance tests passed, including comm routing during idle/execution, unrelated parents, notebook isolation, invalidation and direct process-group ESRCH assertions after restart/shutdown. Ark: original U1 and product API smoke both passed execution 42, LSP initialize + `openide_smoke` completion, owned process-group absent and runtime-directory cleanup. Strict clippy passed.
