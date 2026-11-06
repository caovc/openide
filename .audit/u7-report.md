# U7 Console handoff

Implemented locally; runtime/desktop acceptance BLOCKED in the Codex workspace-write sandbox, not verified complete. No cloud agents, nested agents, commit, push, branch/worktree changes, credentials, package installs, or external actions. Base HEAD: `ba9ce1d8421060ef656d37fe613d9e6d20d75738`; current shared dirty U1–U6 APIs were used. User instructions explicitly supersede the worktree/BOARD requirements; BOARD/docs were read and not written.

## Delivered

Bottom Console tool window, discovered Python executable paths and productized `ark|executable|R_HOME` selections. Create multiple consoles and select their tabs. Each owns a separate immutable runtime, UUID and backend document/kernel identity. Execution is interactive and retains the kernel between submissions. No notebook editor opens; no `.ipynb` file is created. Source/output history is per Console. Outputs are bounded to 1 MB of plain text per submission, and the authoritative final snapshot reconciles streamed output. HTML/images/widgets are outside this MVP.

Source form supports multiline input and Ctrl/Cmd+Enter; Run, Stop, lazy Restart, Close and password-aware stdin reply/cancel. Passwords/replies are not added to source/output history. Actions have stable ids. Kernels start on first execute; Restart stops the owned kernel and next execute creates a new generation using the same explicit runtime. History remains visible. No automatic fallback across languages. Discovery refresh and runtime selection use existing notebook catalog labels.

Lifecycle checks cover open/close and open/cancel races, duplicate execution/replies, stale/cross-id output, startup failure recovery, close failure/retry, restart-before-first-execute, restart/close ordering and two-session isolation. A fresh authoritative document revision is fetched before each submission so cancellation/error output revisions do not leave subsequent edits out of sync. Close awaits pending admission, attempts native cleanup and retains a failed-close session for retry. Project-root changes and feature disposal close owned sessions. Native project shutdown remains the final host owner.

## Exact U7 source paths

New files:
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- `src/features/ds-console/backend.ts`
- `src/features/ds-console/session.ts`
- `src/features/ds-console/store.ts`
- `src/features/ds-console/index.ts`
- `src/features/ds-console/ConsoleView.tsx`
- `src/features/ds-console/Console.module.css`
- `src/features/ds-console/session.test.ts`
- `src/features/ds-console/ConsoleView.test.tsx`

Existing files:
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- `src/features/index.ts`: **only** Console import and activation (U6 concurrently added its separate import/activation and it is preserved).
- `crates/ide-host/src/ops/notebook.rs`: existing `notebook_open` recognizes reserved `openide-console:<key>` and delegates creation on the blocking worker. The ordinary filesystem open path is retained.
- `crates/ide-host/src/notebook.rs`: `NotebookService::open_console` wraps public `NotebookDocument::from_text` and the existing managed-document registry/lifecycle. Two U7 tests and their real-execute helper were added in the existing test module. Console keys reject traversal and have bounded ASCII identities. Virtual document paths are inside the project root so kernel cwd is correct. Service registry owns them until existing close/project shutdown.

No U7 edits to Tauri wrappers, generated bindings, contributions, ide-notebook, ds-session, Run, data explorer, localization catalogs, docs or BOARD. Existing host files already contained uncommitted U1–U5 changes; HEAD-relative diff totals include those changes and are not a U7-only patch. Use the named U7 method, reserved-prefix dispatch and test names when collecting this shared-tree change. Do not replace these files wholesale from HEAD.

## Verification

Final indexed commands/exit codes: `.audit/u7-verification.tsv`. Unique final frontend logs use `u7-check-180519-*`. Earlier development rows are archived separately in `u7-verification-development.tsv`; those shared log names were overwritten during iteration and are not immutable evidence. The main TSV indexes the retained final logs only.

- Console unit + DOM: **13 passed** (`u7-check-180519-frontend-tests.log`); mock transport, not runtime proof.
- Host notebook regression: **10 passed, 3 ignored** (`u7-host-notebook-tests.log`); includes transient creation/identity/no-file/cleanup test. Real probes are explicitly ignored in the default run.
- Full `pnpm typecheck`: exit 0.
- Focused oxlint, oxfmt check, Rust file formatting and diff whitespace: exit 0.
- `cargo clippy -p ide-host --lib --no-deps -- -D warnings`: exit 0. The normal dependency-inclusive command fails on existing `nonminimal_bool` findings in `ide-db/src/{clickhouse,split}.rs` and `ide-lsp/src/launch.rs`; these paths were not changed.
- Shared catalog suite: 19 passed, 1 failed, 6 skipped; the final missing literal is **U6 `src/features/ds-session/index.ts` → `Plots`**. No Console literal remains in the missing list. Earlier, before U6's new UI appeared, the combined Console/catalog run passed 32 tests with 6 skipped (`u7-tests-verified.log`). Localization catalogs were not edited. Console labels reuse existing translations, including `New…`; runtime/backend error diagnostics remain English. No new Console en/zh catalog additions are required for these labels.
- Real Python and Ark smoke commands both **exit 101 / BLOCKED**: native kernel setup gets `Operation not permitted (os error 1)` before launch. An independent `socket.socket()` probe also returns EPERM. The Codex workspace-write sandbox denies local sockets. This does not establish whether the coordinator’s normal execution environment has the same restriction; no sandbox-bypass retry was attempted. Environment paths were taken from ENV/U5 audits. No fallback interpreter or ide-notebook change was attempted. These runs do **not** prove runtime execution, stdin, restart, cancellation or process cleanup.
- Followed local verify skill preflight: `.agents/skills/verify/SKILL.md`. `pnpm dev:status` exits 1 with bridges `[]`; no Tauri MCP tools are available in this session. No desktop launch, native GUI verification or screenshot is claimed. The local socket denial also prevents launching a Vite/bridge session. Existing preview processes were not stopped.

The ignored `u7_console_real_runtime` test is ready to rerun with the exact Python/Ark commands in the TSV when local sockets are allowed. It checks state retained to 42, second Console isolation, stdin reply and late reply rejection, close while awaiting input, lazy restart, native close, no notebook files, empty runtime directory. It opens kernels sequentially while keeping two alive; concurrent startup reliability and real password prompts still need additional acceptance. It exercises the real host service, not a desktop/frontend IPC end-to-end flow.

## U8 contract (no feature imports)

Use the actions registry (`executeAction`), not imports from this feature:

1. `ds.console.new` with `{ selection, language: "python" | "r", name }` creates a Console; no arg opens the window for runtime selection. `selection` is an explicit Python executable path or Ark product selection string. Creation rejects language/selection mismatch.
2. `ds.console.targets` with a callback receives target descriptors: `{ consoleId, notebookId, language, selection, generation, busy, closing }`. `notebookId` is null before the first document admission. Do not use runtime selection alone as a session identity: two consoles can share one environment.
3. `ds.console.execute` with `{ id: consoleId, language, source }` targets exactly that existing session; mismatched language is rejected before execution, with no implicit language switch or session creation. This does not implement editor Run/U8.
4. `ds.console.select` takes consoleId. `ds.console.cancel`, `ds.console.restart`, `ds.console.close` take consoleId. `ds.console.reply` takes `{ id: consoleId, value: string | null }`; the current one-shot prompt id stays inside the session.

Existing `executeAction` catches/logs action exceptions and returns an action-dispatch boolean; it is not an execution success result. U8 should query descriptors and keep an explicit user-selected Console id; busy sessions reject another submission. Native notebook id is for shared session panels, while Console routing uses consoleId. Generation increments on lazy restart. Console sessions are project-scoped and ephemeral, with no persistence across app reloads. Public type definitions are currently feature-local; the callback/action contract avoids cross-feature imports.

## Remaining acceptance

Rerun both real runtime probes on a local-socket-capable environment, verify password input and cancellation during real startup, run the Console in the desktop with screenshot evidence, and check two actual simultaneously running consoles (including concurrent startup). Resolve the independent U6 `Plots` catalog entry and unrelated dependency clippy findings through their owners. No requested kernel/backend edits are blocked on ide-notebook; the remaining runtime block is environmental.

## Handoff

U7 | blocked-runtime-verification | local Codex / OpenIDE大师 | branch ds/u7-console (logical ownership only, unchanged shared branch) | ba9ce1d8421060ef656d37fe613d9e6d20d75738 | src/features/ds-console/**; src/features/index.ts Console-only; crates/ide-host/src/{notebook.rs,ops/notebook.rs}; .audit/u7* | Console MVP implemented; real runtime/GUI blocked by local-socket EPERM | 13 frontend + 10 host passed; typecheck/lint/format/host-only clippy 0; real Python/Ark 101 | .audit/u7-report.md; .audit/u7-verification.tsv | real execution/password/process-cleanup/desktop evidence pending; shared U6 catalog failure | coordinator rerun real probes and desktop; U8 use explicit Console id + language actions

Recorded 2026-11-06T18:07:43.987585+08:00 (Asia/Shanghai).

Change inventory and HEAD-relative shared-file diff statistics: `.audit/u7-change-inventory.log`. Eight new Console files, 1002 lines including tests/CSS; existing shared-file totals are 652 insertions / 21 deletions and include U1–U6 work. Current branch remains `main`.

Executor review: independently reran 13 focused Console tests and full pnpm typecheck successfully; inspected Console routing, session lifecycle, native transient-document creation and path ownership. Evidence: `.audit/u7-executor-tests.log`, `.audit/u7-executor-typecheck.log`. Recorded 2026-11-06T18:08:56.188169+08:00 (Asia/Shanghai).

<<<<<<< Updated upstream
=======

>>>>>>> Stashed changes
## Coordinator acceptance (2026-11-06T18:10:57.514325+08:00)

Re-ran ignored `u7_console_real_runtime` outside Codex sandbox (local sockets allowed):

- Python: PASS retained state=42, second Console isolation, stdin reply/close, restart/close, no notebook files, empty runtime dir. Log: `.audit/u7-real-python-coord.log`
- Ark: PASS same predicates with `ark=true`. Log: `.audit/u7-real-ark-coord.log`

Still not claimed: native GUI / screenshot, concurrent dual-kernel startup stress, password prompt UX in desktop. Host/API real-runtime gate for U7 is VERIFIED.

Updated status: **done** (host real-runtime); GUI optional follow-up.
