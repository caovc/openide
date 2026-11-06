# U9 — t8y2/dbx canvas grid port plan

Recorded: 2026-11-06T19:42:01+08:00 (Asia/Shanghai, UTC+8)
Status: **research only**. No production UI, crates, deps, BOARD, commit, or push in this unit.
Sibling: U9.2a / Ark rebuild owned by another executor — **do not block or edit that work**.

## Source snapshot

<<<<<<< Updated upstream
| Item             | Value                                                                         |
| ---------------- | ----------------------------------------------------------------------------- |
| Repo             | https://github.com/t8y2/dbx (user clarification; **not** Databricks Labs CLI) |
| Local clone      | `/workspace/dbx` (shallow `--depth 1`)                                        |
| Commit           | `01b5452f6e9c79388f3488466c5bd810366c872b`                                    |
| Tip subject      | `fix(desktop): route Linux compositor close through tray settings`            |
| Declared version | `package.json` `"version": "0.6.67"`, `"license": "Apache-2.0"`               |
| Stack            | Tauri 2 + **Vue 3** + TypeScript + Rust; pnpm workspace                       |
=======
| Item | Value |
| --- | --- |
| Repo | https://github.com/t8y2/dbx (user clarification; **not** Databricks Labs CLI) |
| Local clone | `/workspace/dbx` (shallow `--depth 1`) |
| Commit | `01b5452f6e9c79388f3488466c5bd810366c872b` |
| Tip subject | `fix(desktop): route Linux compositor close through tray settings` |
| Declared version | `package.json` `"version": "0.6.67"`, `"license": "Apache-2.0"` |
| Stack | Tauri 2 + **Vue 3** + TypeScript + Rust; pnpm workspace |
>>>>>>> Stashed changes

## License conclusion

**GO for study / selective port under Apache-2.0**, with attribution.

Evidence (this clone):

- Root `LICENSE` = Apache License Version 2.0 (full text).
- Root `package.json` `"license": "Apache-2.0"`.
- README § License → `[Apache-2.0](LICENSE)`.
- Root `NOTICE` only calls out PL/SQL debugger third-party provenance (OceanBase ODC, also Apache-2.0) — **not** a grid restriction.

Obligations if OpenIDE later ships derived code:

1. Keep Apache-2.0 notice / LICENSE excerpt for any copied or substantially derived files.
2. Preserve or extend NOTICE with t8y2/dbx attribution (and any nested NOTICE entries that travel with copied modules).
3. Do **not** copy trademarks / product branding (“dbx” product marks) into OpenIDE chrome.
4. Prefer a **clean-room React port** of the canvas paint + scroll math over wholesale file copies when possible; if files are copied, run a NOTICE inventory before merge.

Prior U9-P0 **NO-GO on Databricks `dbx` 0.8.19** remains correct for that package; it was the wrong referent (see `.audit/u9-t8y2-dbx-correction.md`).

## Key source paths (canvas / data-grid)

### Portable-ish TypeScript core (no `vue` import)

Primary paint entry:

- `apps/desktop/src/lib/dataGrid/canvasDataGridRenderer.ts` (~902 LOC)
  - Exports: `drawCanvasDataGrid`, virtual-scroll height/`scrollTop` remappers, DPR/backing-store helpers, `fitCanvasText`, boolean checkbox paint, row fill resolution.
  - **No Vue import.** Depends only on sibling `lib/dataGrid/*` types + `lib/backend/platform` (`Platform` union).

Direct renderer deps (also Vue-free):

- `cellValue.ts` — `CellValue = string \| number \| boolean \| null`; display/limit helpers.
- `dataGridBooleanColumn.ts`, `dataGridCellTextVisual.ts`, `dataGridColumnType.ts`
- `dataGridSelectionFrames.ts`, `gridSelection.ts`, `gridRowStatus.ts`
- `dataGridPaintTheme.ts` — CSS-var aware theme resolve + canvas-safe color probe (~348 LOC)
- `crosshairHighlight.ts`, `dataGridRowNumber.ts`

Paging / scroll helpers useful as reference:

- `dataGridInfiniteScroll.ts` — near-bottom checks, append completion, scroll restore (~94 LOC, Vue-free)
- `dataGridPagination.ts`, `dataGridWheel.ts`, `dataGridViewStateCache.ts`
- `dataGridColumnWidth.ts` / `dataGridColumnWidthState.ts`, `dataGridColumnVisibility.ts`, `dataGridColumnOrder.ts`

`apps/desktop/src/lib/dataGrid/` ≈ **141** `.ts` files; only **3** import Vue (`dataCompareSelection.ts`, `resultPreviewRegistry.ts`, `dataGridContextMenu.ts`) — none are required for a read-only paint spike.

Unit tests under `apps/desktop/src/lib/dataGrid/__tests__/` cover boolean/pagination/row-number/etc.; canvas paint itself is exercised mainly via Vue component specs (`DataGridCanvasZoom.spec.ts`, etc.).

### Vue shell (rewrite, do not embed)

- `apps/desktop/src/components/grid/DataGrid.vue` (~**18 750** LOC) — owns canvas mount, DPR, `drawCanvasDataGrid({...})` call site (~line 9413), editing, SQL filter/sort workbenches, export, insert/delete, FK navigation, search, transpose, …
- ~**51** sibling `.vue` dialogs/toolbars/popovers under `apps/desktop/src/components/grid/`
- Composables under `apps/desktop/src/composables/useDataGrid*.ts` — DBX query/edit lifecycle, not OpenIDE TableProvider

**Conclusion:** treat `canvasDataGridRenderer.ts` + a small paint/scroll/theme cluster as the reusable **reference core**; treat `DataGrid.vue` + DB editing/SQL chrome as **out of scope** for OpenIDE explorer.

## Vue vs portable core

<<<<<<< Updated upstream
| Layer                              | Shape                               | OpenIDE reuse                                                      |
| ---------------------------------- | ----------------------------------- | ------------------------------------------------------------------ |
| Canvas paint + virtual scroll math | Pure TS, canvas 2D                  | **Reusable as reference / port target**                            |
| Paint theme resolve                | Pure TS; reads CSS vars / color-mix | Reusable idea; rebind to OpenIDE tokens                            |
| Selection / row status types       | Pure TS                             | Partial — drop dirty/new/deleted edit flags for read-only explorer |
| Infinite-scroll append helpers     | Pure TS over opaque row arrays      | Pattern only — map to `TableProvider.page`                         |
| `DataGrid.vue` + composables       | Vue 3 + Tauri + SQL backends        | **React rewrite** of a thin host; do not mount Vue                 |
| Edit/export/FK/SQL builders        | Vue + Rust query stack              | **NON-goal** for U9 explorer                                       |
=======
| Layer | Shape | OpenIDE reuse |
| --- | --- | --- |
| Canvas paint + virtual scroll math | Pure TS, canvas 2D | **Reusable as reference / port target** |
| Paint theme resolve | Pure TS; reads CSS vars / color-mix | Reusable idea; rebind to OpenIDE tokens |
| Selection / row status types | Pure TS | Partial — drop dirty/new/deleted edit flags for read-only explorer |
| Infinite-scroll append helpers | Pure TS over opaque row arrays | Pattern only — map to `TableProvider.page` |
| `DataGrid.vue` + composables | Vue 3 + Tauri + SQL backends | **React rewrite** of a thin host; do not mount Vue |
| Edit/export/FK/SQL builders | Vue + Rust query stack | **NON-goal** for U9 explorer |
>>>>>>> Stashed changes

There is **no React package** and **no published npm “canvas-grid” library** — reuse is source-level, not a dependency bump.

## Suggested thin adapter vs U9.1 `TableProvider`

Contract source (read-only this unit): `src/features/ds-data-explorer/contract.ts`.

Relevant surface:

- `TableProvider.open / state / schema / page / query / profile / export / refresh / close / revoke`
- Typed `Cell` tagged union (boolean, integer/decimal strings, float specials, missing systems, category, temporal, nested, preview, …)
- `PageRequest` / `Page` with decimal-string `offset`, `limit`, column-major `values`, `hasMore`
- `capabilities.unsupported` for sort/filter/profile/export until backends negotiate them
- Host axes: `HostScope` (`project`, `window`, `document`, `generation`, `objectId`, `objectRevision`, `viewer`)

### Adapter sketch (future unit; not implemented here)

```text
React explorer host (OpenIDE tokens)
  -> viewport controller (scroll, column widths, abort)
  -> PageCache keyed by Identity + offset/limit/columns
  -> TableProvider.page / schema  (U9.1 fixture now; Ark/Python later)
  -> Cell[][]  --map-->  CanvasDataGridRow[] + formatCell()
  -> drawCanvasDataGrid(options)   // ported paint fn
```

Mapping notes:

1. **`CellValue` mismatch:** DBX uses `string|number|boolean|null`. OpenIDE `Cell` is richer. Adapter must:
   - supply `formatCell` that renders OpenIDE `Cell` → display string (respect `Preview.truncated`, missing badges, temporal formatting);
   - treat `kind: "missing"` via `isNullValue` / dedicated paint — do not collapse to JS `null` unless intentional;
   - never pass OpenIDE integers as IEEE floats through DBX’s numeric path.
2. **`rowAt(index)`:** implement from cached pages only; return `undefined` for unloaded rows so paint can skip/skeleton. Trigger `provider.page` when virtual scroll approaches gaps (DBX `isDataGridNearScrollBottom` / viewport windowing — prefer **windowed** fetch over DBX-style append-all for session objects).
3. **Identity / revision:** every paint batch must use `Page.identity`; on mismatch drop cache and re-request (align with U9.1 fixture guards). Abort in-flight with `AbortSignal` on scroll cancel / `close` / `revoke`.
4. **Sort/filter:** call `provider.query`; if `Unsupported`, keep client chrome disabled (DBX filter builder is SQL — do not port). Capabilities already list unsupported ops.
5. **Edit/dirty/new/deleted row chrome:** omit from OpenIDE explorer (read-only). Strip `isDirtyCol` / draft insert paths from the React host options even if paint APIs accept them.
6. **Theme:** replace DBX CSS vars with OpenIDE design tokens when calling `resolveDataGridPaintTheme` equivalent; keep DPR / `MAX_CANVAS_DATA_GRID_SCROLL_HEIGHT` (16e6) math.
7. **Frozen columns / search / crosshair:** optional phase-2; not required for first Ark/Python smoke GUI.

Keep provider independent of renderer (already stated in `.audit/u9-architecture.md`). The canvas port must not import `ds-session/store` or console session modules.

## Phased plan

### Phase A — Research (this unit) ✅

- [x] Shallow clone t8y2/dbx → `/workspace/dbx` @ `01b5452…`
- [x] License + NOTICE inventory for grid path
- [x] Identify canvas entry + Vue shell boundary
- [x] Map to U9.1 `TableProvider` / `Cell` / paging
- [x] Record plan + `ds-ide.tsv` line
- [ ] **NON-goal here:** GUI, npm deps, crates, Ark rebuild, BOARD

### Phase B — React port sketch (separate approval; after or parallel to U9.2a smoke, still no production activation)

1. Extract/port a **minimal paint module** under a new sandbox path (e.g. future `src/features/ds-data-explorer/canvas/` **only after approval**):
   - `drawCanvasDataGrid` + scroll height remappers + `fitCanvasText` + backing-store metrics
   - OpenIDE `Cell` → display string formatter
   - Theme bridge to existing tokens
2. Vitest: paint with fixture pages from U9.1 `fixture.ts` (jsdom canvas mock or node-canvas if already available) — no Tauri, no Vue.
3. NOTICE / attribution draft for any retained DBX-derived lines.
4. Explicitly **do not** copy `DataGrid.vue`, SQL editors, export menus, or Tauri commands.

### Phase C — Wire to explorer (after U9.2a Ark smoke + approval)

1. Thin React host: canvas + DOM scroller + column header strip using OpenIDE chrome.
2. Page cache + `AbortSignal` wired to `TableProvider.page` / `schema`.
3. First live backend: R Ark explorer (U9.2 path); Python later.
4. Keep TanStack virtualizer fallback path documented until canvas spike proves win on wide/tall frames.
5. Still no sort/filter/profile GUI until provider capabilities flip off `unsupported`.

## Explicit NON-goals (this unit and until U9.2a clears)

- No production UI under `src/features/**` except **reading** `ds-data-explorer/contract.ts` (and related fixture/tests for research).
- No edits under `/workspace/openide/crates`.
- No fighting / coordinating writes with the U9.2a Ark rebuild executor.
- No Vue runtime, no embedding DBX desktop app, no Tauri from dbx.
- No vendoring entire `lib/dataGrid` or `components/grid`.
- No SQL connection client, row editing, insert/delete, FK navigate, export menus, or DBX query backend.
- No npm dependency on unpublished dbx packages; no BOARD / commit / push.
- No claiming runtime GUI acceptance from this research doc alone.

## Risks / blockers

<<<<<<< Updated upstream
| Risk                                     | Mitigation                                                |
| ---------------------------------------- | --------------------------------------------------------- |
| U9.2a Ark smoke still in flight          | Stay docs-only; Phase B waits for approval / smoke        |
| `Cell` model richer than DBX `CellValue` | Adapter formatter; never coerce through DBX types blindly |
| Paint theme tied to DBX CSS vars         | Reimplement theme resolve against OpenIDE tokens          |
| 18k-LOC Vue shell temptation             | Hard NON-goal; port paint only                            |
| Scroll height clamp / DPR edge cases     | Port the tested remappers + keep their comments/tests     |
| Accidental Databricks-dbx confusion      | Keep correction note; cite t8y2 commit in audits          |
| Attribution miss on copy                 | NOTICE inventory before any source copy lands             |
=======
| Risk | Mitigation |
| --- | --- |
| U9.2a Ark smoke still in flight | Stay docs-only; Phase B waits for approval / smoke |
| `Cell` model richer than DBX `CellValue` | Adapter formatter; never coerce through DBX types blindly |
| Paint theme tied to DBX CSS vars | Reimplement theme resolve against OpenIDE tokens |
| 18k-LOC Vue shell temptation | Hard NON-goal; port paint only |
| Scroll height clamp / DPR edge cases | Port the tested remappers + keep their comments/tests |
| Accidental Databricks-dbx confusion | Keep correction note; cite t8y2 commit in audits |
| Attribution miss on copy | NOTICE inventory before any source copy lands |
>>>>>>> Stashed changes

## Evidence index

- Clone: `/workspace/dbx` @ `01b5452f6e9c79388f3488466c5bd810366c872b`
- License: `/workspace/dbx/LICENSE`, `/workspace/dbx/NOTICE`, `/workspace/dbx/package.json`
- Renderer: `/workspace/dbx/apps/desktop/src/lib/dataGrid/canvasDataGridRenderer.ts`
- Vue shell: `/workspace/dbx/apps/desktop/src/components/grid/DataGrid.vue`
- OpenIDE contract: `/workspace/openide/src/features/ds-data-explorer/contract.ts`
- Prior correction: `/workspace/openide/.audit/u9-t8y2-dbx-correction.md`
- Architecture frame: `/workspace/openide/.audit/u9-architecture.md`
- File map: `/workspace/openide/.audit/u9-dbx-file-map.md`
