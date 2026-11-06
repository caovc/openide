# U6 — shared R/Python Session Variables + Plots

Status: **implemented and real-runtime verified; native GUI acceptance pending**.

Shared Variables/Plots windows are registered and connected to actual R (Ark) and Python notebook kernels. Real tests pass for variable names/types/summaries, two-level lazy expansion, PNG output/history, dual same-language sessions, mixed R/Python isolation, stale-revision rejection, restart clearing and shutdown cleanup. Native GUI was not launched or visually verified; do not claim screenshots or complete native end-to-end acceptance.

Owner: OpenIDE大师. Logical unit branch: `ds/u6-session-vars`; actual shared branch remains `main`. Base/HEAD: `ba9ce1d8421060ef656d37fe613d9e6d20d75738`. No commit, push, branch switch, worktree or cloud agent. Implementation used local Codex CLI, followed by coordinator-run real runtime checks. Dirty U1–U5/Java/U7 work was preserved. U7/U8/U9 were not implemented by this task.

## What landed

- Variables and Plots tool windows use the existing contribution API, shared session selection, CSS Modules/existing tokens, native accessible controls, lazy expansion and previous/next plot history.
- Per-project-runtime namespace + document path + kernel generation ownership. Restart revokes old state immediately; frontend generation/revision/epoch guards reject stale requests. Closed documents are removed on polling.
- Python: selected existing ipykernel, isolated history-free comm helper, post-execution variable refresh, safe builtin dict/list/tuple traversal without expression evaluation. Ark: public MIT `positron.variables` refresh/update/inspect protocol, including RPC correlation via Jupyter parent header and version guards.
- Jupyter PNG/JPEG/SVG outputs and public Ark plot pre-renders feed bounded history: 50 images / 16 MiB per generation. No HTML execution; SVG is displayed in an image element.
- Feature-owned variable/plot comms are consumed before the general subscription bus. Existing LSP/DAP/stdin routing is preserved. The existing custom-comm regression additionally filters by its own comm ID instead of assuming every broadcast belongs to that test.
- Adapter contract and explicit unavailable SAS stub: `src/features/ds-session/ADAPTER.md`. No SAS implementation, proprietary Positron UI source, or new application dependency.

## Real evidence (no mock runtime)

All paths below are relative to `/workspace/openide`. Exact commands, environment, timestamps (Asia/Shanghai / UTC+8), exits and log paths are in `.audit/u6-verification.tsv`; execution records are appended to `.audit/ds-ide.tsv`.

<<<<<<< Updated upstream
| Final check                                                                                   | Actual result                                                                                                                             | Evidence                                                                         |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `cargo test -p ide-notebook --test session_runtime -- --ignored --nocapture --test-threads=1` | exit 0; **3 real tests pass**: Ark, Python and simultaneous mixed-language sessions                                                       | `.audit/u6-runtime-acceptance-delivery.log`                                      |
| `cargo test -p ide-notebook --test kernel_runtime -- --ignored --nocapture --test-threads=1`  | exit 0; **7 real Python regressions pass** including interrupt, cancellation, process death, restart, interpreter change and comm routing | `.audit/u6-python-regression-delivery.log`                                       |
| `cargo test -p ide-notebook --test ark_smoke -- --ignored --nocapture --test-threads=1`       | exit 0; **5 real Ark regressions pass**, including U4 session LSP and U5 breakpoint/step/evaluate/stdin/pending-stop/process cleanup      | `.audit/u6-ark-regression-delivery.log`                                          |
| `cargo test -p ide-notebook`                                                                  | exit 0; **49 non-runtime tests pass** (22 unit + 25 document + 2 admission); 15 opt-in runtime tests separately covered above             | `.audit/u6-notebook-unit-delivery.log`                                           |
| `pnpm vitest run src/features/ds-session src/features/notebook`                               | exit 0; **65 tests / 8 files**; includes store isolation/race guards and panel DOM behavior, not native GUI evidence                      | `.audit/u6-frontend-delivery.log`                                                |
| `pnpm typecheck`                                                                              | exit 0, all configurations                                                                                                                | `.audit/u6-typecheck-delivery.log`                                               |
| `pnpm build`                                                                                  | exit 0; existing chunk/dynamic-import warnings                                                                                            | `.audit/u6-build-final.log`                                                      |
| `pnpm gen:bindings`                                                                           | exit 0; generated bindings, no manual binding edits                                                                                       | `.audit/u6-bindings-final.log`                                                   |
| `cargo test -p ide-host --lib ops::ds_session::tests`                                         | exit 0; project registration weak-ownership test                                                                                          | `.audit/u6-host-registration.log`                                                |
| `cargo clippy -p ide-notebook --all-targets --no-deps -- -D warnings`                         | exit 0                                                                                                                                    | `.audit/u6-clippy-no-deps-final.log`                                             |
| scoped oxlint / oxfmt / new-Rust rustfmt / Python syntax                                      | exit 0                                                                                                                                    | `.audit/u6-{lint-final,format-check-final,rust-format,python-helper-syntax}.log` |
| `git diff --check`                                                                            | exit 0                                                                                                                                    | `.audit/u6-diff-check-host-delivery.log`                                         |
=======
| Final check | Actual result | Evidence |
| --- | --- | --- |
| `cargo test -p ide-notebook --test session_runtime -- --ignored --nocapture --test-threads=1` | exit 0; **3 real tests pass**: Ark, Python and simultaneous mixed-language sessions | `.audit/u6-runtime-acceptance-delivery.log` |
| `cargo test -p ide-notebook --test kernel_runtime -- --ignored --nocapture --test-threads=1` | exit 0; **7 real Python regressions pass** including interrupt, cancellation, process death, restart, interpreter change and comm routing | `.audit/u6-python-regression-delivery.log` |
| `cargo test -p ide-notebook --test ark_smoke -- --ignored --nocapture --test-threads=1` | exit 0; **5 real Ark regressions pass**, including U4 session LSP and U5 breakpoint/step/evaluate/stdin/pending-stop/process cleanup | `.audit/u6-ark-regression-delivery.log` |
| `cargo test -p ide-notebook` | exit 0; **49 non-runtime tests pass** (22 unit + 25 document + 2 admission); 15 opt-in runtime tests separately covered above | `.audit/u6-notebook-unit-delivery.log` |
| `pnpm vitest run src/features/ds-session src/features/notebook` | exit 0; **65 tests / 8 files**; includes store isolation/race guards and panel DOM behavior, not native GUI evidence | `.audit/u6-frontend-delivery.log` |
| `pnpm typecheck` | exit 0, all configurations | `.audit/u6-typecheck-delivery.log` |
| `pnpm build` | exit 0; existing chunk/dynamic-import warnings | `.audit/u6-build-final.log` |
| `pnpm gen:bindings` | exit 0; generated bindings, no manual binding edits | `.audit/u6-bindings-final.log` |
| `cargo test -p ide-host --lib ops::ds_session::tests` | exit 0; project registration weak-ownership test | `.audit/u6-host-registration.log` |
| `cargo clippy -p ide-notebook --all-targets --no-deps -- -D warnings` | exit 0 | `.audit/u6-clippy-no-deps-final.log` |
| scoped oxlint / oxfmt / new-Rust rustfmt / Python syntax | exit 0 | `.audit/u6-{lint-final,format-check-final,rust-format,python-helper-syntax}.log` |
| `git diff --check` | exit 0 | `.audit/u6-diff-check-host-delivery.log` |
>>>>>>> Stashed changes

The real acceptance logs assert R plot PNG payload (6134 bytes) and Python matplotlib PNG payload (25744 bytes), live variable mutation from 41 to 42, nested children, per-session plot history, rejection of stale generations/revisions, and connection-file cleanup. Separate Ark regressions verify actual debug stack/scopes/variables/evaluate, line advancement, stdin reply/cancellation and process-group absence.

### Sandbox attempts versus successful coordinator reruns

The local Codex subprocess sandbox could not create loopback sockets (EPERM). Its earlier runtime failures remain in the TSV/logs as historical evidence, not the final outcome. Coordinator Shell successfully ran the same real native kernel tests on this box without changing application transports or substituting responses. This was a local runner limitation, not a product or machine-wide runtime blocker.

An initial real Ark inspect timeout was fixed by public-protocol parent-header correlation; an initial Python custom-comm assertion was corrected to isolate its target comm. Final delivery logs above supersede those initial failed attempts.

Python `.audit/u6-python` was equipped successfully by coordinator Shell with ipykernel and matplotlib (installation: `.audit/u6-python-install-host.log`, versions: `.audit/u6-python-equipped-host.log`). The failed sandbox install is historical; matplotlib is **not** still missing. Existing `.audit/python-u2` was preserved and supplies the second interpreter for the interpreter-switch regression.

## Source files / path ownership

Every new source file (15) is enumerated in `.audit/u6-new-files.txt`:

- `crates/ide-notebook/src/session.rs`
- `crates/ide-notebook/src/session_adapter.rs`
- `crates/ide-notebook/src/session_python.py`
- `crates/ide-notebook/src/session_tests.rs`
- `crates/ide-notebook/tests/session_runtime.rs`
- `crates/ide-host/src/ops/ds_session.rs`
- `src-tauri/src/commands/ds_session.rs`
- `src/features/ds-session/ADAPTER.md`
- `src/features/ds-session/Panels.test.tsx`
- `src/features/ds-session/Panels.tsx`
- `src/features/ds-session/Session.module.css`
- `src/features/ds-session/index.ts`
- `src/features/ds-session/runtime.ts`
- `src/features/ds-session/store.test.ts`
- `src/features/ds-session/store.ts`

Minimal changes to existing files:

- `crates/ide-notebook/src/lib.rs`: module exports.
- `crates/ide-notebook/src/kernel.rs`: crate-visible comm module for session request plumbing.
- `crates/ide-notebook/src/kernel/comm.rs`: generation-owned SessionData handle/accessor and test construction. This was already an untracked U1–U5 file; it was not replaced.
- `crates/ide-notebook/src/kernel/transport.rs`: generation state, adapter initialization, independent variables/plot observation, feature-owned comm handling.
- `crates/ide-notebook/tests/kernel_runtime.rs`: custom-comm test filters its own `echo-id` (no product behavior change).
- `crates/ide-host/src/ops/mod.rs`: module registration.
- `crates/ide-host/src/project.rs`: **only two factory substitutions**, registering existing NotebookService with its project runtime namespace; necessary to authorize same-path multi-project state without touching U7 notebook files.
- `src-tauri/src/commands/mod.rs`: additive module + two command registrations only.
- `src/features/index.ts`: ds-session import/activation only; U7 registration preserved.
- `src/bindings.ts`: generated by existing generator, including concurrent U7 additions.

U6 did not edit `src/features/ds-console/**`, existing host/Tauri notebook files, Editor Run, JVM hard-delete, DAP/stdin implementation, roadmap, product or BOARD. Existing `src/workbench/contributions.ts` registration APIs sufficed; U6 did not change it.

Dirty-tree evidence: `.audit/u6-initial-status.txt`, `.audit/u6-initial-owned.diff`, `.audit/u6-final-status.txt`, `.audit/u6-shared-diff-stat.txt`, `.audit/u6-owned-diff-stat.txt`. Diffs against HEAD include earlier U1–U5 and concurrent U7 edits and must not all be attributed to U6. The initial Codex-only report is retained as `.audit/u6-codex-report-initial.md`; this report is the reconciled delivery outcome.

## Runtime / provenance

- Ark `/workspace/ark/target/release/ark`, **0.1.252**, public MIT source commit `670a4946d8c3887e04591e4103b21fdba503afa3` (read-only research; no UI source copied).
- R **4.5.3**, `R_HOME=/workspace/mamba/envs/r/lib/R`, executable from `/workspace/mamba/envs/r/bin`.
- Explicit Python `/workspace/openide/.audit/u6-python/bin/python`, versions in `.audit/u6-python-equipped-host.log`.
- Runtime commands use `PATH="$HOME/.cargo/bin:/workspace/mamba/envs/r/bin:$PATH"`; full environment is recorded in delivery logs/TSV. No interpreter fallback.

## Remaining gaps / next

1. **Native GUI not launched/verified**; no screenshot evidence. Rebuild native backend and inspect Variables/Plots in real R/Python notebooks; switch sessions, expand, navigate history, restart, capture screenshots. U7 Console shares KernelManager/document routing but its native GUI integration is not claimed by this unit.
2. **Localization**: local English strings remain because locale paths were outside U6 ownership. Locale owner must add en/zh catalog entries.
3. Python expands builtin dict/list/tuple only; arbitrary objects, dataframe/table exploration, widgets and interactive plots are later units. Roots/children capped at 200 entries. Ark delta totals reflect retained bounded view.
4. Webview reload rediscovery waits for the next lifecycle/execution event; polling transfers full bounded snapshots/images. Incremental image transfer is not implemented.
5. Full-workspace CI/e2e not run. Dependency-inclusive clippy fails on pre-existing out-of-scope `crates/ide-lsp/src/launch.rs:149` nonminimal_bool; the owned crate passes scoped `--no-deps` clippy.

## Handoff

U6 | implemented/runtime-verified; GUI pending | OpenIDE大师 | branch ds/u6-session-vars (logical; actual main unchanged) | base SHA ba9ce1d8421060ef656d37fe613d9e6d20d75738 | paths src/features/ds-session/**; crates/ide-notebook variable/plot plumbing + runtime tests; NEW crates/ide-host/src/ops/ds_session.rs + src-tauri/src/commands/ds_session.rs; minimal project/module/command/feature registration; generated bindings | conclusion shared R/Python Variables+Plots landed locally, real execution/expand/plots/isolation/reset verified, no commit/push | verify real session 3=0; Python regression 7=0; Ark regression 5=0; notebook non-runtime 49=0; frontend 65=0; typecheck/build/bindings/host registration/scoped clippy=0 | evidence /workspace/openide/.audit/u6-report.md; /workspace/openide/.audit/u6-verification.tsv; /workspace/openide/.audit/u6-runtime-acceptance-delivery.log; /workspace/openide/.audit/u6-new-files.txt | unfinished native GUI/screenshots, locale catalogs, pre-existing dependency clippy lint | next coordinator verifies native notebook panels and updates canonical BOARD; U7/U8/U9 remain separately owned.
