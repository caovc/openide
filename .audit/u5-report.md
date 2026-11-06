# U5 — Ark DAP + stdin

Status: VERIFIED (real backend/API + stdin DOM; native debugger GUI is outside this acceptance). Local changes only; no commit/push. Times: Asia/Shanghai.

## Implemented

- `crates/ide-dap/src/session_dap.rs`: process-free TCP DAP initialize/attach; generation-bound bounded event subscription; reverse launches rejected. Stop, timeout, cancellation and dropped request futures close transport and fail pending requests. Semantic DAP errors do not unnecessarily close it. DAP `threads` omits arguments (Ark has a serde unit variant).
- `crates/ide-notebook/src/kernel/{comm,transport}.rs`: lazy `KernelComms::ark_dap()` per Ark generation, using `ark_dap` comm and RPC `server_started` notification. Only the owned DAP comm can delegate fixed browser commands n/s/f/c/Q. In notebook mode these map to Jupyter **control debug_request**, not execute_request on the occupied shell.
- `KernelManager::execute_with_stdin`: explicit opt-in; existing execute/execute_runtime retain allow_stdin=false. stdin socket shares the exact shell ZMQ identity. Prompts are execution-parent scoped, UUID one-shot replies; stale/duplicate/late/wrong-generation replies rejected; null means native interrupt/cancellation. Reply size bounded at 1 MiB. Cancel/drain bounded by the existing 5-second interrupt deadline.
- Host/Tauri API: trusted `notebook_dap`, `notebook_dap_events`, `notebook_input_reply`; DAP request allowlist; selection/generation checks. Existing notebook execution now opts in because its UI supports prompts. Transient prompts bypass document outputs/history/save.
- Notebook UI: transient password-aware input form, reply/cancel, lifecycle disabling, duplicate reply suppression, no input content persistence; notebook shortcuts do not steal form keystrokes. New DOM + session tests.
- Updated en/zh strings; removed three obsolete U3 interpreter labels in six non-English catalogs and supplied missing notebook kernel/R-cell zh translations. Concurrent branding changes in other files were preserved.

## Real verification

Final command outcomes: Ark 5, real host Ark 1, real Python 7, default Rust 284, host 165, bindings 1, frontend/catalogs 77 passed (6 skipped); typecheck/format/lint exit 0. Lint retains the existing React useVirtualizer memoization warning. See `u5-verification.tsv`. Re-run environment:

```sh
source ~/.cargo/env
export PATH=/workspace/mamba/envs/r/bin:$PATH
export R_HOME=/workspace/mamba/envs/r/lib/R
export OPENIDE_ARK=/workspace/ark/target/release/ark
export OPENIDEA_TEST_PYTHON=$PWD/.audit/python-u2/bin/python
export OPENIDEA_TEST_PYTHON_SECOND=$PWD/.audit/python-u2-second/bin/python
cargo test -p ide-notebook --test ark_smoke -- --ignored --nocapture --test-threads=1
cargo test -p ide-host --lib ark_stdin_host_api -- --ignored --nocapture
cargo test -p ide-notebook --test kernel_runtime -- --ignored --nocapture --test-threads=1
cargo test -p ide-notebook -p ide-dap -p ide-lsp
cargo test -p ide-host --lib -- --test-threads=1
cargo test -p openidea --test export_bindings
pnpm vitest run src/features/notebook src/platform/locales/textCatalog.test.ts
pnpm typecheck
```

- Real Ark line breakpoint: source debug.R, stop at line 3; scopes/variables x=41; evaluate x+1=42; next advances line 3 -> 4; continue finishes the original cell.
- Real stdin: readline prompt -> reply -> R result `answer-ok`; wrong/duplicate reply rejected. Explicit cancel drains/stops active execution and rejects late replies.
- Real lifecycle: restart while awaiting input, then stop while paused in browser(); original executions resolve, old event subscriptions and DAP/input requests fail, both process groups checked absent with ESRCH; runtime directories empty.
- Real host path: Channel input_request -> host input_reply -> actual notebook output, no persisted prompt; host DAP threads and stop revocation.
- Unit TCP lifecycle probes cover generation-stop and abandoned pending DAP requests, with observed socket EOF (not only logical state).

## Investigation / limits

- Initial assumptions corrected against the running Ark: `positron.ark_dap` is rejected; only `ark_dap` works. DAP uses method/params, unlike LSP's legacy msg_type/content. Sending DAP next's delegated `n` on the shell hangs in notebook mode; control debug_request is required. Source breakpoints need `source(path)` without keep.source argument, which otherwise bypasses Ark's injection hook. Initial host threads `{}` payload also closed Ark's unit-variant decoder; normalized to omitted arguments.
- One parallel run of all five Ark probes had two startup `connection reset by peer` errors; all five pass serialized. Concurrent kernel startup reliability is not claimed by this U5; investigate the existing ephemeral-port/startup seam for multi-session U6. Do not interpret a serialized run as concurrent-start coverage.
- One parallel host default run hit the existing git-index refresh assertion in project.rs; final serial rerun passes all 165 host tests. No unrelated VCS changes were made.
- DAP is verified via real headless Rust/API paths. Full R debugger tool-window integration, notebook-cell gutter/source mapping, and native GUI end-to-end verification are NOT claimed. Breakpoint verification uses a real R file sourced inside the existing notebook Ark generation. stdin UI is directly tested in the DOM, not a native-window screenshot.
- Cancelling/abandoning an in-flight DAP request revokes that generation's DAP transport to guarantee no hanging requests. Reattach recovery requires kernel restart; no automatic replay of debug operations.
- No standalone R adapter process, separate R kernel, Positron UI code, commit, push, or preview-process kill.

Next: U6 — session-isolated variables/plots comm panels via existing tool-window contributions.

## Cleanup and delivery

- All U5/U4 probe groups independently rechecked ESRCH in `u5-processes.log`; no Ark process remains. Real pending-input restart and pending-debug stop both cancel original executions and old subscriptions. Existing preview process was not killed.
- Generated bindings include notebookDap, notebookDapEvents, notebookInputReply. `.agents/BOARD.md` U5 set done only after the above checks. Existing U1–U4 and concurrent branding/performance edits are preserved; this report does not claim ownership of those diffs.
- No commit/push. Completed 2026-11-06T17:43:56.676711+08:00 (Asia/Shanghai).
