# U4 — Ark execution-session LSP for notebook R cells

Status: VERIFIED for the notebook-cell path, using real Ark + NotebookService and actual CodeMirror unit tests. No commit or push. All work stayed in `/workspace/openide`; actual branch remains `main`, with reserved BOARD branch note `ds/u4-ark-session-lsp`. Base HEAD: `ba9ce1d8421060ef656d37fe613d9e6d20d75738`.

## Existing wiring and chosen seam

Ordinary files: `languages/*.toml` → LanguageRegistry → `ide_lsp::LspManager` → `Launcher` (`ProcessLauncher`, stdio or configured TCP) → `ide_jsonrpc::Peer`; the main editor routes feature requests through document IDs. Notebook `CellEditor` is an independent CodeMirror editor, with no main-editor DocId/LSP wiring. Its execution already belongs to NotebookService → KernelManager → generation-bound KernelComms.

The narrow bridge is therefore `ide_lsp::session::SessionLsp`, a process-free TCP Peer, initialized only from the selected running kernel's `positron.lsp` comm. KernelComms caches one connection in a shared OnceCell per generation. This avoids a global/project R server and avoids routing a cell to a different notebook's execution environment.

## Changes

- `crates/ide-lsp/src/session.rs`: attach loopback TCP to already-running Ark, verify Ark server identity/UTF-16, full cell didOpen/didChange, hover/completion normalization, snippet/range support, bounded source and requests, generation cancellation/transport teardown. No process spawning. Existing LspManager/Launcher behavior for other languages is unchanged.
- `crates/ide-notebook/src/kernel/{comm,transport}.rs`: runtime identity on comm handles; lazy `ark_lsp()`; subscribe before comm_open; abandoned initialization closes its comm. Python comm handles reject Ark-LSP requests.
- `crates/ide-host/src/{notebook,ops/notebook}.rs`: typed NotebookLspQuery, check notebook/cell incarnation and selected runtime, trust/project-request cancellation, synthetic file-URI R cell documents. `notebook_stop_kernel` cancels the old generation without discarding source or reloading the notebook.
- Tauri thin adapters/registration and hand-updated bindings expose `notebook_lsp` and `notebook_stop_kernel`.
- `CellEditor` selects R syntax and adds session-only CodeMirror hover/completion when Ark is selected. `arkLsp.ts` uses current cell source + UTF-16 coordinates; applies main edits and LSP snippets with the existing snippet converter; renders hover as safe plain text. NotebookSession cancels/drops old feature requests on switch/close/restart and drains source edits before stopping the old selected kernel.
- `languages/r.toml`: removed the independent `languageserver::run()` default. No silent R-LSP fallback.
- Real Ark bridge/service tests, TCP cancellation/identity tests, CodeMirror completion/snippet/UTF-16 tests, frontend session lifecycle tests. Added R cell source label in en/zh.

## Real evidence

`u4-ark-all.log`: all 3 real Ark probes pass. The new bridge executes `openide_session_only <- function(z) z + 41` and gets 42; completion in a separate real `.R` document includes that execution-only function, not just a document-defined variable. Hover returns `mean` documentation; didChange updates completion. Restart makes the old bridge fail and the replacement session no longer sees the old function. Both generation process groups are absent (ESRCH), runtime directory empty.

`u4-host-ark.log`: NotebookService executes an actual notebook R cell to 42, then the editor-cell feature route returns an execution-only `openide_host_only` completion and `mean` hover. A mismatched Ark runtime is rejected. Selection-stop preserves source, revokes LSP, and close rejects late requests.

`u4-rust-regression.log`: 226 default ide-lsp/ide-notebook tests pass. The 3 new TCP tests prove pending request cancellation closes TCP on generation stop, caller cancellation sends `$/cancelRequest` without killing the session, and a non-Ark endpoint is rejected. The new notebook comm test proves canceled initialization closes its comm and Python never opens one.

`u4-python-regression.log`: all 7 real Python kernel regression tests pass. `u4-host-regression.log`: 165 host tests pass. `u4-frontend-regression.log`: 134 tests in 9 files pass, including actual CodeMirror acceptance of Ark function snippets and UTF-16 edit ranges, session cancellation/drop of stale results, and source-preserving selection changes. Typecheck, changed-file oxlint, diff whitespace checks pass. See `u4-verification.tsv` for commands and logs.

## Scope and limitations (not silently claimed)

- This implements the permitted notebook R-cell path, not standalone `.R` tabs bound to an arbitrarily chosen notebook. Run a cell with the selected Ark runtime first. No extra kernel is started by hover/completion.
- Only hover/completion is wired here; diagnostics, DAP, and panels are not U4 scope. Individual cell documents are independent; execution globals are shared through their owning Ark session.
- No native GUI/screenshot validation was performed. Native Tauri build/bindings export remains blocked by missing `pkg-config` for glib-sys (`u4-bindings-export.log`). Bindings were patched to match the Rust types and pass TypeScript checks; regenerate them on a fully provisioned desktop before release.
- Rust 1.96 strict clippy reports existing `nonminimal_bool` in unchanged `ide-lsp/src/launch.rs:149`, `ide-db/src/clickhouse.rs:290`, and `ide-db/src/split.rs:159`. All changed packages/targets pass with that baseline lint explicitly allowed; no unrelated source edits were made to silence it.
- The optional textCatalog regression run finds 7 existing U3 notebook-kernel rename/translation failures (stale Python interpreter strings in six locales, four missing new kernel strings in zh). The new R-cell label is not among failures. This is recorded, not reported as a green whole-app frontend run.

## Reproduction

```sh
source ~/.cargo/env
export OPENIDE_ARK=/workspace/ark/target/release/ark
export R_HOME=/workspace/mamba/envs/r/lib/R
export PATH=/workspace/mamba/envs/r/bin:$PATH
cargo test -p ide-notebook --test ark_smoke -- --ignored --nocapture
cargo test -p ide-host --lib ark_notebook_cell_lsp_uses_execution_session -- --ignored --nocapture
cargo test -p ide-lsp -p ide-notebook
cargo test -p ide-host --lib
export OPENIDEA_TEST_PYTHON=$PWD/.audit/python-u2/bin/python
export OPENIDEA_TEST_PYTHON_SECOND=$PWD/.audit/python-u2-second/bin/python
cargo test -p ide-notebook --test kernel_runtime -- --ignored --nocapture
pnpm exec vitest run src/features/notebook src/editor/lsp/availability.test.ts src/editor/lsp/completion.test.ts src/editor/lsp/hoverPrecedence.test.ts src/editor/lsp/snippet.test.ts
pnpm typecheck
```

The dirty working tree already contained U1–U3 changes when U4 started. Whole-tree git diff/stat includes those pre-existing changes; do not treat it as a U4-only diff. New U4 files: `crates/ide-lsp/src/session.rs`, `crates/ide-lsp/tests/session_lsp.rs`, `src/features/notebook/arkLsp.ts`, `src/features/notebook/arkLsp.test.ts`. Existing U1–U3 edits were preserved.
