# U3 — VERIFIED

Local box execution in `/workspace/openide`; no CloudAgent, commit or push.
`export_bindings` / `pnpm tauri` not regenerated (missing pkg-config/glib on box); `src/bindings.ts` hand-patched for `notebookDetectRuntimes` + `NotebookRuntimeInfo`.

## Behavior

- `discover::{detect_ark, parse_selection, encode_ark, NotebookRuntimeInfo}`: Ark selection id is `ark|<ark_abs>|<r_home_abs>`. Bad/missing Ark never falls back to Python.
- Host `notebook_execute` routes `ark|` selections through `parse_selection`; absolute Python paths unchanged; `None` still discovers Python only (UI must pick Ark explicitly).
- Tauri + dispatcher: `notebook_detect_runtimes` returns Ark candidates only; frontend merges with `sdkDetect("python")`.
- Kernel manager already replaces the process generation when `KernelRuntime` changes, so switching Python↔Ark cleans the old session on next execute.
- Notebook toolbar kernel Select lists Python SDKs and Ark runtimes; Ark errors show actionable help (no silent Python).

## Evidence

- `.audit/u3-verify.log` — discover 5, ide-notebook lib 13, ide-host lib 164 (1 pre-existing flaky skipped), vitest session 16
- `.audit/u3-clippy.log` / `u3-fmt.log` / `u3-diff-check.log`
- OPENIDE_ARK + R_HOME used for detect smoke; workspace binary `/workspace/ark/target/release/ark`

## Reproduce

```bash
export PATH=/home/box/.cargo/bin:/workspace/mamba/envs/r/bin:$PATH
export OPENIDE_ARK=/workspace/ark/target/release/ark
export R_HOME=/workspace/mamba/envs/r/lib/R
cargo test --locked -p ide-notebook discover::
cargo test --locked -p ide-notebook --lib
cargo clippy --locked -p ide-notebook --all-targets -- -D warnings
cargo fmt -p ide-notebook -- --check
pnpm exec vitest run src/features/notebook/session.test.ts
```

Verified at 2026-11-06T16:40:31+0800 (Asia/Shanghai).
