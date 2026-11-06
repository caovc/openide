# U8 Editor Run handoff

**Implemented locally; 34 U8 unit/DOM tests and 21 U6/U7 regressions pass (55 total). Full typecheck, lint, build, knip and focused formatting pass. Desktop/real Editor → Console execution remains BLOCKED by local socket EPERM; this is not full runtime acceptance.** Existing catalog check still fails only on the previously reported U6 `Plots` translation. No cloud, subagents, commits, pushes, worktrees, deletion, backend changes, U9 or JVM work.

Root: `/workspace/openide`; branch remains `main`; HEAD remains `ba9ce1d8421060ef656d37fe613d9e6d20d75738`. Read AGENTS, BOARD/COLLAB, U7 report, ROADMAP and existing editor/actions/menu/overlay patterns before editing. The explicit root/path authorization and existing U8 BOARD reservation were used; BOARD/docs were not edited.

## Delivered behavior

Python/R text editors now contribute five actions to Find Action and the editor context menu:

<<<<<<< Updated upstream
| Action                         | Behavior                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `ds.editorRun.selection`       | Run exactly the main selected range; no current-line or whole-file fallback.                                   |
| `ds.editorRun.file`            | Run the entire current in-memory buffer, including unsaved edits, irrespective of selection.                   |
| `ds.editorRun.chooseSelection` | Capture selection now and explicitly choose a Console or create one.                                           |
| `ds.editorRun.chooseFile`      | Capture full buffer now and explicitly choose a Console or create one.                                         |
| `ds.editorRun.cancel`          | Select/show and cancel the latest Console submitted through U8, including while its execute action is pending. |
=======
| Action | Behavior |
| --- | --- |
| `ds.editorRun.selection` | Run exactly the main selected range; no current-line or whole-file fallback. |
| `ds.editorRun.file` | Run the entire current in-memory buffer, including unsaved edits, irrespective of selection. |
| `ds.editorRun.chooseSelection` | Capture selection now and explicitly choose a Console or create one. |
| `ds.editorRun.chooseFile` | Capture full buffer now and explicitly choose a Console or create one. |
| `ds.editorRun.cancel` | Select/show and cancel the latest Console submitted through U8, including while its execute action is pending. |
>>>>>>> Stashed changes

Public `selection`/`file` actions accept an optional full `ConsoleTarget` descriptor as their argument for explicit routing. Ellipsis actions always open the picker. No new default shortcut or native main-menu change. The “Current Buffer” label makes unsaved-file semantics explicit.

Source is captured synchronously from the existing `activeEditor()` CodeMirror state, guarded against non-file tabs, stale handles, embedded/virtual editors and unsupported backend language ids. No save, disk read or backend-document sync is requested. A reversed UTF-16 range is normalized by CodeMirror; whitespace is preserved. Empty/whitespace selections reject, and multiple nonempty disjoint selections reject rather than being silently concatenated. A picker preserves the captured buffer even if the editor subsequently changes. It shows language, path, source line interval and exact submitted source.

Routing uses only a full explicit descriptor, the last U8-used Console for that language, or otherwise the last same-language descriptor in U7's creation-ordered callback. It never infers an active Console from its runtime path. Closing candidates are excluded from automatic routing. A chosen busy target rejects; it does not fall through to another session. Every submission queries descriptors again and checks exact Console id, expected language, immutable runtime selection, generation, busy and closing before execute. An explicit stale/wrong target rejects without fallback or creation. Project identity changes/disposal clear remembered targets, pending picker work and cancel routing. Dismissing/replacing the picker invalidates pending discovery/creation execution.

When no matching Console exists, the picker opens without creating or executing. Discovery queries Python SDKs **only for Python**, Ark runtimes **only for R**. Users must explicitly select a discovered runtime and click **Create Console and Run**. Creation compares fresh before/after descriptor identities and requires exactly one new same-language/same-runtime Console before running. It does not confuse dispatch with successful creation. Missing dependencies/discovery failure have visible guidance and Refresh. A Console explicitly created just before picker dismissal may remain open; dismissal prevents submitting its captured code.

Before submission U8 selects the exact Console tab and shows/focuses the existing Console tool window. Source history, output, kernel errors, stdin and Stop remain owned by U7. U8 reports its own validation errors as Run notifications or picker alerts. There is no “execution succeeded” toast based on the action-dispatch boolean.

## U7 boundary and data shapes

No product or test import of `ds-console` or `ds-session` internals. `bridge.ts` uses the real actions registry (`executeAction`) and a callback:

```ts
interface ConsoleTarget {
  consoleId: string;
  notebookId: string | null;
  language: "python" | "r";
  selection: string;
  generation: number;
  busy: boolean;
  closing: boolean;
}
interface ConsoleRuntime {
  selection: string;
  language: "python" | "r";
  name: string;
}
```

- `ds.console.targets(callback)` supplies descriptors; missing callback data rejects.
- `ds.console.select(consoleId)` selects the tab; U8 then uses the contributed tool-window service to show `ds-console`.
- `ds.console.execute({ id: consoleId, language, source })` submits to the exact validated existing Console. U7 remains the final synchronous admission authority for lifecycle/busy races.
- `ds.console.new({ selection, language, name })` is called only after explicit Create. Python selection is an executable path; R selection is the discovered `ark|...` id. No fallback interpreter.
- `ds.console.cancel(consoleId)` targets the latest U8 submission. Each Console also retains U7's own Stop button. With several pending editor runs, use the individual Console Stop buttons for earlier runs.
- U7 `restart`/`close` are consumed indirectly by fresh descriptors; `reply` stays in the Console. A picker descriptor captured before restart is rejected by generation; a subsequent normal Run queries the current generation.

`executeAction` catches action exceptions and returns a dispatch boolean, not kernel success. U8 only detects unavailable dispatch through that boolean. Execution errors are shown by the selected U7 Console. The callback plus fresh descriptors establish routing, not kernel completion.

## Exact paths and minimal shared wiring

New production files (525 lines including CSS):

- `src/features/ds-editor-run/model.ts`: named source/runtime/target shapes; live-buffer capture and validation.
- `src/features/ds-editor-run/bridge.ts`: callback/action boundary and same-language discovery through existing IPC.
- `src/features/ds-editor-run/controller.ts`: captured requests, target memory, freshness checks, explicit creation and cancel.
- `src/features/ds-editor-run/Picker.tsx` and `Picker.module.css`: accessible existing Dialog, native selects/buttons and tokens/CSS Modules.
- `src/features/ds-editor-run/index.tsx`: five actions, editor menu contribution, overlay, notification handling and project lifecycle.

New tests: `model.test.ts`, `bridge.test.ts`, `controller.test.ts`, `EditorRun.test.tsx` (600 lines). They use a real CodeMirror state/view and real actions/contribution registries with a mocked U7 boundary. No kernel is substituted and described as real.

Existing shared files changed by U8 only:

1. `src/features/index.ts`: one import and one activation immediately after `ds-console`; U6/U7 activation changes preserved.
2. `src/platform/locales/text/en.json`: append 27 new action/menu/UI/diagnostic source strings.
3. `src/platform/locales/text/zh.json`: append the same 27 translations. These catalog additions are the required localization wiring for the new actions and picker.

No editor-core/API/action-registry/contributions implementation changes were needed. No edits under `crates/ide-notebook/**`, `ds-session/**` or `ds-console/**`. SHA-256 comparison of all **134** pre-existing dirty/untracked files found changes only in the three shared files above, no missing files and no other modifications: `.audit/u8-preservation.log`. `.audit/u8-baseline.json` holds the initial hashes. Shared HEAD-relative diff totals include earlier U1–U7 work; do not replace these files from HEAD. Inventory: `.audit/u8-change-inventory.log`.

## Verification

Exact commands, exit codes and retained logs: `.audit/u8-verification.tsv`.

- `pnpm vitest run src/features/ds-editor-run src/features/ds-console src/features/ds-session --reporter=verbose`: **55 passed** (34 U8 + 13 U7 + 8 U6); `.audit/u8-tests.log`. Covers selection/full unsaved buffer, reversed UTF-16 selection, unsupported/stale editor, match/mismatch/missing/closing/busy target, descriptor generation/runtime changes, per-language target memory, picker snapshot, Python/Ark discovery and explicit creation, missing dependencies, Refresh, creation-without-new-descriptor rejection, late callbacks/dismissal, pending execution cancellation, action/menu/overlay activation and disposal. U7 tests independently cover output history and its exact-id action contract with mocked transport.
- Full `pnpm typecheck`: exit 0; `.audit/u8-typecheck.log`.
- Full `pnpm lint`: exit 0; `.audit/u8-lint.log`.
- Focused `pnpm exec oxfmt --check ...`: exit 0; `.audit/u8-format.log`.
- `pnpm build`: exit 0; `.audit/u8-build.log`; existing large-chunk/ineffective-dynamic-import warnings remain.
- `pnpm knip`: exit 0; `.audit/u8-knip.log`; existing ignore-pattern configuration hint remains.
- `pnpm vitest run src/platform/locales/textCatalog.test.ts`: **19 passed, 1 failed, 6 skipped**; `.audit/u8-catalog.log`. Sole missing text is existing `src/features/ds-session/index.ts:19 "Plots"`, already recorded in U7. No U8 text is missing. The unrelated entry was not changed.
- Scoped `git diff --check`: exit 0; `.audit/u8-diff-check.log`.
- Local verify skill preflight: `.agents/skills/verify/SKILL.md`. `pnpm dev:status`: exit 1, bridges `[]`, identifier `ai.l0ng.openidea.dev.wa5c973794d7cf3f0`; `.audit/u8-gui-status.log`. No Tauri MCP tools are available in this session.
- Independent Python socket probe: exit 1, `PermissionError: [Errno 1] Operation not permitted` at `socket.socket()`; `.audit/u8-socket-permission.log`.
- `pnpm dev:app`: exit 1, **`listen EPERM: operation not permitted 127.0.0.1:47544`**, before Vite/desktop startup; `.audit/u8-gui-launch.log`. No started app/launcher was left running, and no existing preview process was stopped. No socket-bypass retry.

Not claimed: real U8 desktop execution/output/cancel, GUI screenshots, password UX, simultaneous-kernel startup or file-mapped traceback navigation. U7 coordinator real host execution was already accepted in `.audit/u7-report.md`; it does not establish U8 GUI acceptance. Browser e2e was not run because the required local listener cannot start. Source executes as a Console submission in the Console's existing project working directory, preserving state, not as a subprocess script. Tracebacks retain Console/cell-relative locations; no synthetic filename, source wrapper, `__file__` or automatic indentation rewrite is introduced.

## Coordinator commands and remaining acceptance

Run these from a shell where local sockets are allowed (not this denied sandbox):

```bash
cd /workspace/openide
export PATH="$HOME/.cargo/bin:/workspace/mamba/envs/r/bin:$PATH"
export OPENIDE_ARK=/workspace/ark/target/release/ark
export R_HOME=/workspace/mamba/envs/r/lib/R
python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()); s.close()'
pnpm dev:app 2>&1 | tee .audit/u8-gui-coord.log
```

In a second shell:

```bash
cd /workspace/openide
export PATH="$HOME/.cargo/bin:$PATH"
pnpm dev:status | tee .audit/u8-gui-coord-status.log
pnpm vitest run src/features/ds-editor-run src/features/ds-console src/features/ds-session --reporter=verbose
```

Use the reported MCP port explicitly as `appIdentifier`, verify `/workspace/openide` and the identifier above, focus the app before screenshots. Open the prepared project `/workspace/openide/.audit/u8-gui-project`, which contains `selection.py` and `selection.R`. No saved file needs modification:

1. Capture a before screenshot without opening a U8 picker (no reverting dirty work). With no Python Console, select `u8_value = 40` in `selection.py` and invoke **Run Selection in Console**. Confirm no Console is silently created. Select the discovered Python runtime, click **Create Console and Run**, then select/run `print(u8_value + 2)`. The same Console must show **42** and preserve `u8_value`.
2. Change the buffer in memory to `u8_value = 41\nprint(u8_value + 2)\n` without explicitly saving. **Run Current Buffer in Console** must show **43** in that Console. Repeat selection and unsaved-buffer checks for R with `<-`, explicitly selecting the discovered Ark runtime; Python's Console must retain its independent history/state.
3. Create two Python Consoles with the same runtime. Use **Run Selection in Console…** to select the older exact id. Run twice and verify the chosen Console remains the target and the other history is unchanged. Picker labels expose full Console ids/runtime selections.
4. Open a picker, then close/restart its selected Console before clicking Run: stale descriptor must reject. To exercise the wrong-language public argument through MCP `execute_js` in dev mode, import `/src/platform/actions.ts`, query `ds.console.targets` with a callback and pass an R descriptor as the argument to `ds.editorRun.file` while a Python editor is active. It must notify language mismatch with no execution/create.
5. Run an unsaved Python buffer `import time\nwhile True: time.sleep(0.1)\n` or R `repeat { Sys.sleep(0.1) }`. Another submission must report busy. Use **Stop Editor Run in Console** or that Console's **Stop** button; confirm busy clears and subsequent `print(42)` works. Capture screenshots of picker, 42/43 output, busy/error and Stop recovery, named `.audit/u8-after-1.png` etc. Check an intentional syntax error appears in the targeted Console.

Record actual results/commands/screenshots in a coordinator acceptance addendum and the verification TSV. Do not mark U8 runtime verified based on the unit/DOM run alone. U9 remains untouched.

## Executor independent review (2026-11-06T18:40:04.509131+08:00, Asia/Shanghai)

Independently reran the 55 focused U8/U7/U6 tests and full configured typecheck, both exit 0. Logs: `/workspace/openide/.audit/u8-executor-tests.log` and `/workspace/openide/.audit/u8-executor-typecheck.log`. Inspected source capture, target freshness/language validation, creation, cancel, editor contribution context and actual U7 action/window identities. No additional code changes. Prove It Works principle kept native GUI/runtime acceptance separate from passing mocked-boundary unit/DOM checks. Native GUI and full Editor-to-kernel acceptance remain pending; coordinator commands above.

<<<<<<< Updated upstream
=======

>>>>>>> Stashed changes
## Coordinator notes (2026-11-06T18:40:44.998462+08:00)

- Re-ran focused frontend suite: **55 passed** (`.audit/u8-coord-frontend.log`).
- Full `pnpm typecheck`: exit 0 (`.audit/u8-coord-typecheck.log`).
- Fixed leftover U6 catalog gap: added zh translations for `Plots` / `Session Variables` / `Session Plots`. Catalog suite now **20 passed | 6 skipped** (`.audit/u8-catalog-coord.log`).
- BOARD U8 marked done (unit/DOM). Native GUI / Editor→kernel checklist in this report remains pending; not claimed verified.
