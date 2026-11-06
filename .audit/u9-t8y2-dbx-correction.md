# U9 correction — user-specified dbx is t8y2/dbx

Recorded: 2026-11-06T19:08:25.222374+08:00 (Asia/Shanghai)

## Clarification

User pointed to https://github.com/t8y2/dbx — **not** Databricks Labs `dbx` CLI.

## Facts (public sources this turn)

<<<<<<< Updated upstream
| Item                 | Value                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo                 | https://github.com/t8y2/dbx                                                                                                                                         |
| License              | Apache-2.0 (GitHub API + README License section)                                                                                                                    |
| Stack                | Tauri 2 + **Vue 3** + TypeScript + Rust                                                                                                                             |
| Relevant UI          | Virtual-scrolled Data Grid; canvas renderer at `apps/desktop/src/lib/dataGrid/canvasDataGridRenderer.ts`; Vue shell `apps/desktop/src/components/grid/DataGrid.vue` |
| Features of interest | Large result sets, filters/sort, column resize, pagination, cell detail, export — DataGrip-like DB client grid                                                      |
=======
| Item | Value |
| --- | --- |
| Repo | https://github.com/t8y2/dbx |
| License | Apache-2.0 (GitHub API + README License section) |
| Stack | Tauri 2 + **Vue 3** + TypeScript + Rust |
| Relevant UI | Virtual-scrolled Data Grid; canvas renderer at `apps/desktop/src/lib/dataGrid/canvasDataGridRenderer.ts`; Vue shell `apps/desktop/src/components/grid/DataGrid.vue` |
| Features of interest | Large result sets, filters/sort, column resize, pagination, cell detail, export — DataGrip-like DB client grid |
>>>>>>> Stashed changes

## Implication for OpenIDE U9

- **License GO** for studying / porting patterns under Apache-2.0 (retain NOTICE/attribution; do not copy trademarks).
- **Not a drop-in**: OpenIDE frontend is **React**, t8y2/dbx grid is **Vue**. Whole-app embedding is wrong shape.
- **Recommended reuse path**: treat canvas renderer + paging/filter interaction as a **reference implementation**; port a React-facing typed grid that speaks U9.1 `TableProvider` (session R/Python/SAS), keep OpenIDE tokens / JetBrains-dense chrome.
- Prior Phase 0 NO-GO on Databricks `dbx` remains correct for that package; it was the wrong referent.
- U9.1 contract stays; U9.2 Ark smoke continues; after smoke, schedule **U9.3 canvas port spike** from t8y2/dbx renderer (separate approval, NOTICE inventory).

## Evidence

- README: https://raw.githubusercontent.com/t8y2/dbx/main/README.md
- API: https://api.github.com/repos/t8y2/dbx (`license.spdx_id` = Apache-2.0)
- Canvas path documented in public tree: `apps/desktop/src/lib/dataGrid/canvasDataGridRenderer.ts`
