# U9 — t8y2/dbx canvas grid file map

Recorded: 2026-11-06T19:45:00+08:00 (Asia/Shanghai, UTC+8)
Status: **research inventory only**. No production UI, crates, deps, BOARD, commit, or push.
Sibling plan: `.audit/u9-dbx-port-plan.md`
Clone: `/workspace/dbx` @ `01b5452f6e9c79388f3488466c5bd810366c872b` (Apache-2.0)

LOC counted with `wc -l` on this clone. Paths are absolute under `/workspace/dbx`.

## Legend

<<<<<<< Updated upstream
| Tag          | Meaning                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------- |
| **PORT-REF** | Vue-free TS; preferred paint / scroll / theme / selection reference for a future React adapter |
| **REWRITE**  | Vue shell or Vue-importing helper — React rewrite only; do not embed                           |
| **NON-PORT** | DB edit/SQL/export/FK/Tauri/branding — out of scope for OpenIDE explorer                       |

## Snapshot counts

| Area                                            | Count / size                      |
| ----------------------------------------------- | --------------------------------- |
| `apps/desktop/src/lib/dataGrid/*.ts` (non-test) | **119** files; **3** import `vue` |
| `apps/desktop/src/lib/dataGrid/__tests__/*.ts`  | **22** unit tests                 |
| `apps/desktop/src/components/grid/*.vue`        | **51** components                 |
| `DataGrid.vue` alone                            | **18 750** LOC                    |
| `composables/useDataGrid*.ts`                   | **25** files                      |
=======
| Tag | Meaning |
| --- | --- |
| **PORT-REF** | Vue-free TS; preferred paint / scroll / theme / selection reference for a future React adapter |
| **REWRITE** | Vue shell or Vue-importing helper — React rewrite only; do not embed |
| **NON-PORT** | DB edit/SQL/export/FK/Tauri/branding — out of scope for OpenIDE explorer |

## Snapshot counts

| Area | Count / size |
| --- | --- |
| `apps/desktop/src/lib/dataGrid/*.ts` (non-test) | **119** files; **3** import `vue` |
| `apps/desktop/src/lib/dataGrid/__tests__/*.ts` | **22** unit tests |
| `apps/desktop/src/components/grid/*.vue` | **51** components |
| `DataGrid.vue` alone | **18 750** LOC |
| `composables/useDataGrid*.ts` | **25** files |
>>>>>>> Stashed changes

## A. Portable paint core (PORT-REF)

Primary entry: `drawCanvasDataGrid` in the renderer. **No `vue` import.** Depends on sibling `lib/dataGrid/*` + `lib/backend/platform` (`Platform` union only).

<<<<<<< Updated upstream
| LOC | Path                                                                      | Role                                                                                                                       |
| --: | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 902 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/canvasDataGridRenderer.ts`  | Canvas 2D paint, virtual-scroll height/`scrollTop` remappers, DPR/backing-store, `fitCanvasText`, checkbox paint, row fill |
| 348 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridPaintTheme.ts`      | CSS-var theme resolve + canvas-safe color probe                                                                            |
|  53 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/cellValue.ts`               | `CellValue = string\|number\|boolean\|null`; display helpers                                                               |
|  93 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridBooleanColumn.ts`   | Boolean normalize / checkbox metrics                                                                                       |
|  50 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridCellTextVisual.ts`  | Text role / visual hints for paint                                                                                         |
| 379 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridColumnType.ts`      | Column type → visual kind                                                                                                  |
| 139 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridSelectionFrames.ts` | Selection frame geometry for paint                                                                                         |
| 298 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/gridSelection.ts`           | Selection ranges / cell selection types                                                                                    |
|  29 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/gridRowStatus.ts`           | Row status type (dirty/new/deleted — strip for read-only explorer)                                                         |
|  81 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/crosshairHighlight.ts`      | Crosshair target type / helpers (phase-2)                                                                                  |
|  29 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridRowNumber.ts`       | Row-number label resolve                                                                                                   |
=======
| LOC | Path | Role |
| ---: | --- | --- |
| 902 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/canvasDataGridRenderer.ts` | Canvas 2D paint, virtual-scroll height/`scrollTop` remappers, DPR/backing-store, `fitCanvasText`, checkbox paint, row fill |
| 348 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridPaintTheme.ts` | CSS-var theme resolve + canvas-safe color probe |
| 53 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/cellValue.ts` | `CellValue = string\|number\|boolean\|null`; display helpers |
| 93 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridBooleanColumn.ts` | Boolean normalize / checkbox metrics |
| 50 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridCellTextVisual.ts` | Text role / visual hints for paint |
| 379 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridColumnType.ts` | Column type → visual kind |
| 139 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridSelectionFrames.ts` | Selection frame geometry for paint |
| 298 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/gridSelection.ts` | Selection ranges / cell selection types |
| 29 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/gridRowStatus.ts` | Row status type (dirty/new/deleted — strip for read-only explorer) |
| 81 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/crosshairHighlight.ts` | Crosshair target type / helpers (phase-2) |
| 29 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridRowNumber.ts` | Row-number label resolve |
>>>>>>> Stashed changes

Renderer imports (verified): `cellValue`, `dataGridBooleanColumn`, `dataGridCellTextVisual`, `dataGridColumnType`, `dataGridSelectionFrames`, `gridSelection`, `gridRowStatus`, `dataGridPaintTheme`, `crosshairHighlight`, `dataGridRowNumber`, `@/lib/backend/platform`.

## B. Scroll / paging / column layout helpers (PORT-REF pattern)

Useful as math/pattern reference; map OpenIDE paging to `TableProvider.page` (prefer windowed fetch, not append-all).

<<<<<<< Updated upstream
| LOC | Path                                                                       | Role                                             |
| --: | -------------------------------------------------------------------------- | ------------------------------------------------ |
|  94 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridInfiniteScroll.ts`   | Near-bottom / append completion / scroll restore |
| 282 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridPagination.ts`       | Pagination helpers                               |
|  76 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridWheel.ts`            | Wheel scroll handling                            |
| 309 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridViewStateCache.ts`   | View-state cache                                 |
| 155 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridColumnWidth.ts`      | Column width math                                |
| 343 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridColumnWidthState.ts` | Width state                                      |
| 198 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridColumnVisibility.ts` | Visibility                                       |
| 109 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridColumnOrder.ts`      | Column order                                     |

## C. Vue-importing TS under `lib/dataGrid` (REWRITE — not required for paint spike)

| LOC | Path                                                                    |
| --: | ----------------------------------------------------------------------- |
|  35 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataCompareSelection.ts`  |
| 380 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridContextMenu.ts`   |
|  64 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/resultPreviewRegistry.ts` |

## D. Vue shell (REWRITE / NON-PORT for explorer)

|   LOC | Path                                                               | Note                                                                                                                                    |
| ----: | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 18750 | `/workspace/dbx/apps/desktop/src/components/grid/DataGrid.vue`     | Owns canvas mount + `drawCanvasDataGrid` call site (~line 9413); editing, SQL filter/sort, export, insert/delete, FK, search, transpose |
|     — | `/workspace/dbx/apps/desktop/src/components/grid/` (**51** `.vue`) | Dialogs/toolbars/popovers — rewrite thin React host only                                                                                |
=======
| LOC | Path | Role |
| ---: | --- | --- |
| 94 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridInfiniteScroll.ts` | Near-bottom / append completion / scroll restore |
| 282 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridPagination.ts` | Pagination helpers |
| 76 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridWheel.ts` | Wheel scroll handling |
| 309 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridViewStateCache.ts` | View-state cache |
| 155 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridColumnWidth.ts` | Column width math |
| 343 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridColumnWidthState.ts` | Width state |
| 198 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridColumnVisibility.ts` | Visibility |
| 109 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridColumnOrder.ts` | Column order |

## C. Vue-importing TS under `lib/dataGrid` (REWRITE — not required for paint spike)

| LOC | Path |
| ---: | --- |
| 35 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataCompareSelection.ts` |
| 380 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/dataGridContextMenu.ts` |
| 64 | `/workspace/dbx/apps/desktop/src/lib/dataGrid/resultPreviewRegistry.ts` |

## D. Vue shell (REWRITE / NON-PORT for explorer)

| LOC | Path | Note |
| ---: | --- | --- |
| 18750 | `/workspace/dbx/apps/desktop/src/components/grid/DataGrid.vue` | Owns canvas mount + `drawCanvasDataGrid` call site (~line 9413); editing, SQL filter/sort, export, insert/delete, FK, search, transpose |
| — | `/workspace/dbx/apps/desktop/src/components/grid/` (**51** `.vue`) | Dialogs/toolbars/popovers — rewrite thin React host only |
>>>>>>> Stashed changes

Sibling `.vue` names (all under `.../components/grid/`):

`DataGrid.vue`, `DataGridAutoRefreshClock.vue`, `DataGridBulkEditDialog.vue`, `DataGridBusyOverlay.vue`, `DataGridCellDetailDialog.vue`, `DataGridCellDetailHeader.vue`, `DataGridCellDetailHexViewer.vue`, `DataGridCellDetailPanel.vue`, `DataGridCellDetailTextPreview.vue`, `DataGridColumnFilterPopover.vue`, `DataGridColumnHeader.vue`, `DataGridColumnLayoutPopover.vue`, `DataGridColumnWidthModeControl.vue`, `DataGridConditionEditor.vue`, `DataGridCopyColumnNamesDialog.vue`, `DataGridCopyFormatControl.vue`, `DataGridDetailDialogs.vue`, `DataGridDistinctValuePopover.vue`, `DataGridEmptyColumnsControl.vue`, `DataGridExportMenu.vue`, `DataGridExportOptionsControl.vue`, `DataGridExtractorDialog.vue`, `DataGridFilterBuilder.vue`, `DataGridFilterModeOrderDialog.vue`, `DataGridFilterWorkbench.vue`, `DataGridFontFamilyControl.vue`, `DataGridFreezeFirstColumnControl.vue`, `DataGridInsertRowsDialog.vue`, `DataGridMongoJsonPreview.vue`, `DataGridPagination.vue`, `DataGridQueryControls.vue`, `DataGridReadonlyTextSelection.vue`, `DataGridSearchBar.vue`, `DataGridSortBuilder.vue`, `DataGridSortWorkbench.vue`, `DataGridSqlPreviewDialog.vue`, `DataGridStatusSqlControl.vue`, `DataGridTableInfoPanels.vue`, `DataGridTextFilterWorkbench.vue`, `DataGridTextSortWorkbench.vue`, `DataGridToolbar.vue`, `DataGridTypeColorSchemeDialog.vue`, `DataGridValueDiffDialog.vue`, `DataGridValueTransform.vue`, `DataGridVirtualRowIdentifier.vue`, `EnumCellEditor.vue`, `GridSnapshotDialog.vue`, `ImagePreviewDialog.vue`, `LayerPreviewDialog.vue`, `QueryTimingDetails.vue`, `TemporalCellEditor.vue`.

## E. Composables (mostly NON-PORT / DBX lifecycle)

Directory: `/workspace/dbx/apps/desktop/src/composables/` — `useDataGrid*.ts` (**25** files). Canvas-adjacent only for study: `useDataGridCanvasRuntime.ts` (138 LOC), `useDataGridScrollbars.ts` (126). Heavy NON-PORT examples: `useDataGridEditor.ts` (3054), `useDataGridExport.ts` (3144), `useDataGridColumnLayout.ts` (1056), `useDataGridActions.ts` (893), filter/sort/SQL builders.

Do **not** port these into OpenIDE; host scroll/page cache against `TableProvider` instead.

## F. Explicit NON-PORT list

- Entire SQL connection / query / filter / sort workbench UI and composables
- Row insert/delete/bulk edit, dirty/new/deleted chrome, save confirmation
- Export menus, extractors, FK navigation/display, geometry/map/chart previews
- Tauri commands / `src-tauri` / dbx desktop packaging
- Product branding / trademarks (“dbx” marks)
- Vendoring all 119 `lib/dataGrid` files or the 51 grid `.vue` files
- npm dependency on unpublished dbx packages

## G. Suggested minimal port set (future approval)

<<<<<<< Updated upstream
1. `canvasDataGridRenderer.ts` + direct deps in §A
2. Theme bridge rewritten to OpenIDE tokens (from `dataGridPaintTheme.ts` ideas)
3. Optional: infinite-scroll / wheel / column-width math from §B as patterns
4. OpenIDE `Cell` → display-string formatter (new code; do not reuse DBX `CellValue` blindly)
=======
1. `canvasDataGridRenderer.ts` + direct deps in §A  
2. Theme bridge rewritten to OpenIDE tokens (from `dataGridPaintTheme.ts` ideas)  
3. Optional: infinite-scroll / wheel / column-width math from §B as patterns  
4. OpenIDE `Cell` → display-string formatter (new code; do not reuse DBX `CellValue` blindly)  
>>>>>>> Stashed changes
5. Thin React host — **never** `DataGrid.vue`

## Evidence

- Port plan: `/workspace/openide/.audit/u9-dbx-port-plan.md`
- License correction: `/workspace/openide/.audit/u9-t8y2-dbx-correction.md` + license audit append
- License files: `/workspace/dbx/LICENSE`, `/workspace/dbx/NOTICE`, `/workspace/dbx/package.json`
- OpenIDE contract (read-only): `/workspace/openide/src/features/ds-data-explorer/contract.ts`
