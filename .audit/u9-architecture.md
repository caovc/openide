# U9 Phase 0 — thin shared explorer architecture

Status: **proposal only**, 2026-11-06 (Asia/Shanghai, UTC+8). No production UI, adapters, dependencies or BOARD changes in this phase. Session Variables/Plots remain U6; execution remains U7/U8/kernel-owned.

## 1. Placement and boundaries

```text
U6 Variables “Open data” action / future notebook display affordance
  -> contribution/action boundary (opaque session/object identity)
  -> ds-data-explorer view/controller
  -> transport-neutral TableProvider contract + bounded page cache
  -> trusted host explorer broker, same existing NotebookService/KernelManager
      -> R provider: public Ark data-explorer comm adapter
      -> Python provider: app-owned dataframe comm adapter in existing ipykernel
      -> future SAS provider: negotiated broker/transport, unavailable until added
  -> read-only typed table renderer + summary/value views
```

This is not a second interpreter manager, SQL connection, Console document, notebook output buffer, or U6 variable tree. No feature-to-feature import. Register contribution/action descriptors as U8 already does for `ds.console.targets`; use a shared transport/contract module when a future implementation is approved. Do not import `ds-session/store` or `ds-console/session` into the explorer. The U6 action entry and kernel routing will require separately coordinated edits to their owners; **none are changed here**.

Keep the provider independent of renderer choice. The default renderer path is an independently authored shared primitive using the existing TanStack virtualizer and OpenIDE tokens. Grid behavior can be extracted from `database/Grid.tsx` only as a separately approved neutral primitive, with database regressions checked; importing `database/DataView` wholesale would bring string cells and local-only shaping assumptions.

## 2. Proposed model (language-neutral wire contract, not generated code)

<<<<<<< Updated upstream
| Domain value       | Required semantics                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SessionRef         | Host-resolved project incarnation + calling window authorization + authorized notebook/Console document id + kernel generation. Window/project ownership must come from host context, never a client-supplied arbitrary runtime path.                                                                                                                                                                                                                 |
| ObjectRef          | Opaque U6 access-key path plus observed variable revision. No expression text; no `eval`, concatenated R/Python/SAS snippets, or name-based cross-session lookup.                                                                                                                                                                                                                                                                                     |
| TableHandle        | Unforgeable broker-issued id scoped to SessionRef, object version and viewer instance; revoked on lifecycle changes. No global process-wide bare object-id lookup.                                                                                                                                                                                                                                                                                    |
| TableState         | Handle, language/backend label, display title, schema revision, data revision, query revision, row-count variant (`exact`, `estimated`, `unknown`), column count and per-operation capability/status. Row counts/absolute offsets use decimal integer strings at JSON boundaries, checked before local numeric indices.                                                                                                                               |
| Column             | Stable opaque id and source ordinal (names may be duplicate/empty), display name, logical type, original runtime type, nullable/missing metadata, optional units/timezone/ordered levels/label/format. Type is a tagged union: boolean, integer, float, decimal, string, categorical, date, time, timestamp, duration, binary, nested, unknown.                                                                                                       |
| CellValue          | Tagged `value`, `missing`, `unsupported`, or `error`; never conflate loading with null. Integer/decimal payloads are lossless strings; finite float values have a validated numeric encoding; NaN and infinities are explicit variants. Timestamp includes resolution/timezone; category code carries a revisioned dictionary. Display text is separate and bounded. Nested values use safe summaries/child handles, not recursive eager enumeration. |
| MissingValue       | Distinguish Python None/pandas.NA/NaT, R typed NA, IEEE NaN, SQL null where relevant, SAS standard `.` and special `._` / `.A`–`.Z`. Preserve source semantics even if the renderer shares a badge. Empty string and zero are values, never missing.                                                                                                                                                                                                  |
| QuerySpec          | Ordered list of column ids for projection, stable multi-column sort keys with explicit missing ordering, typed filter AST with AND/OR and bounded depth, optional row window. No freeform SQL/eval. Case/locale/timezone comparisons are negotiated, not silently different across languages.                                                                                                                                                         |
| PageRequest / Page | Handle + data/query/schema revision + request id; window offset and bounded row count plus column ids; response echoes identity, actual range, typed column-major values, row labels/keys and truncation/continuation. A page never defines the canonical dataset.                                                                                                                                                                                    |
| Profile            | Column id + data/query revision + dataset/filtered scope; missing/NaN counts, distinct, numeric min/max/mean/quantiles/histogram or categorical frequencies. Result carries exact/sample/approximate status, sample size, algorithm and timestamp. Unsupported and pending are explicit.                                                                                                                                                              |
=======
| Domain value | Required semantics |
| --- | --- |
| SessionRef | Host-resolved project incarnation + calling window authorization + authorized notebook/Console document id + kernel generation. Window/project ownership must come from host context, never a client-supplied arbitrary runtime path. |
| ObjectRef | Opaque U6 access-key path plus observed variable revision. No expression text; no `eval`, concatenated R/Python/SAS snippets, or name-based cross-session lookup. |
| TableHandle | Unforgeable broker-issued id scoped to SessionRef, object version and viewer instance; revoked on lifecycle changes. No global process-wide bare object-id lookup. |
| TableState | Handle, language/backend label, display title, schema revision, data revision, query revision, row-count variant (`exact`, `estimated`, `unknown`), column count and per-operation capability/status. Row counts/absolute offsets use decimal integer strings at JSON boundaries, checked before local numeric indices. |
| Column | Stable opaque id and source ordinal (names may be duplicate/empty), display name, logical type, original runtime type, nullable/missing metadata, optional units/timezone/ordered levels/label/format. Type is a tagged union: boolean, integer, float, decimal, string, categorical, date, time, timestamp, duration, binary, nested, unknown. |
| CellValue | Tagged `value`, `missing`, `unsupported`, or `error`; never conflate loading with null. Integer/decimal payloads are lossless strings; finite float values have a validated numeric encoding; NaN and infinities are explicit variants. Timestamp includes resolution/timezone; category code carries a revisioned dictionary. Display text is separate and bounded. Nested values use safe summaries/child handles, not recursive eager enumeration. |
| MissingValue | Distinguish Python None/pandas.NA/NaT, R typed NA, IEEE NaN, SQL null where relevant, SAS standard `.` and special `._` / `.A`–`.Z`. Preserve source semantics even if the renderer shares a badge. Empty string and zero are values, never missing. |
| QuerySpec | Ordered list of column ids for projection, stable multi-column sort keys with explicit missing ordering, typed filter AST with AND/OR and bounded depth, optional row window. No freeform SQL/eval. Case/locale/timezone comparisons are negotiated, not silently different across languages. |
| PageRequest / Page | Handle + data/query/schema revision + request id; window offset and bounded row count plus column ids; response echoes identity, actual range, typed column-major values, row labels/keys and truncation/continuation. A page never defines the canonical dataset. |
| Profile | Column id + data/query revision + dataset/filtered scope; missing/NaN counts, distinct, numeric min/max/mean/quantiles/histogram or categorical frequencies. Result carries exact/sample/approximate status, sample size, algorithm and timestamp. Unsupported and pending are explicit. |
>>>>>>> Stashed changes

Loading/error/unsupported belong to state variants. Use semantic distinct ids in eventual TypeScript/Rust APIs, schema-derived boundary validation and exhaustive tagged-union handling. Serialize only bounded finite values; do not rely on JSON's lossy float or null behavior.

## 3. Provider operations and query isolation

Conceptual operations:

- `capabilities(SessionRef)` and `open(ObjectRef)` -> scoped TableHandle + initial TableState.
- `schema(handle, columnWindow)` -> bounded column descriptors (wide frames must not dump every label/value).
- `query(handle, QuerySpec, expectedDataRevision)` -> **new query revision or separate immutable query handle**; reject unsupported operators explicitly.
- `page(queryRef, rowWindow, projection)` -> typed bounded data, preserving stable sort tie order.
- `profile(queryRef, columnIds, kinds, budget)` -> job/request id; correlated progress/result/cancel.
- `refresh(handle)` -> new data/schema revision or stale/removed status; `cancel(requestId)`; `close(handle)` idempotently releases handles/caches/comm subscriptions.

Backend sort/filter applies to the **whole dataset** unless clearly labelled “loaded page only”; it must not mutate/rebind the user's dataframe. Keep selected row keys separate from display offsets after sort/filter. Duplicate column names use ids/ordinals, not name lookup. A range selection must not allocate all rows merely to paint a highlight.

Ark's sort/filter RPCs mutate explorer comm state: allocate an isolated backend view/comm per viewer/query where supported. Otherwise serialize changes and reads with a broker-owned query epoch, invalidate pages on any query change, and do not allow two tabs to share mutable state accidentally. Correlate async profile callbacks with both backend request id and frontend query revision. Investigate actual Ark behavior before claiming immutable queries are implemented.

## 4. R and Python adapters; SAS extension

### R / Ark

Use the public MIT-licensed Ark/Amalthea wire schema at U6's pinned source revision, translated to the model above. Candidate RPCs are `get_state`, `get_schema`, `get_data_values`, row labels, `set_row_filters`, `set_sort_columns` and `get_column_profiles`. Negotiate feature statuses, filter types and profile support rather than assuming every dataframe or Ark version supports all operations.

U6 currently subscribes to `positron.variables` and plots, **not** explorer paging. Its opaque variable access keys are only the discovery affordance. Establish how a trusted host resolves that path to an explorer view through the public variable-view/open mechanism; verify target names, comm-open ownership, data encodings, missing sentinels, profile callback correlation and closure against the installed Ark. Do not equate the presence of a generated schema with a working integration. Preserve factors/ordered levels, row names, Date/POSIXct/timezones, integer NA versus NaN; support plain data.frame/tibble first. Lists, custom classes and ALTREP may need restricted/unsupported paths and explicit cost limits.

### Python / ipykernel

Keep selected ipykernel execution ownership unchanged. Add a separate app-owned explorer target/bootstrap only after approval, sharing the safe session/object resolver and host lifecycle rather than replacing `openide.variables`. U6 deliberately does not expand arbitrary Python objects; **do not** expose a general `getattr`/`repr`/property/eval bridge to bypass that.

First capability: installed, explicitly supported pandas DataFrame/Series; no mandatory pandas install and no implicit dependency additions. Prefer exact known concrete types or a validated adapter, with per-type bounded positional column/row access. Subclasses, extension/object dtype contents and third-party protocol providers can execute user code: reject unknown implementations or report unsupported cells instead of claiming arbitrary objects can be safely inspected. Strings/numbers/dates from known scalar types only; never stringify arbitrary object-dtype elements through `repr`. Keep index/MultiIndex metadata separate from columns, preserve nullable dtypes and category dictionaries. NumPy arrays / Polars / Arrow tables are later explicitly negotiated adapters, not silent coercions.

Implement full-data sort/filter/profile in the kernel adapter under cancellation/budget rules; paging alone does not provide those features. Do not copy the full frame into Python lists or JSON. A bounded temporary row-order index may be necessary for sorting; report memory/cost refusal rather than pretending it is free. Requests must coordinate with kernel execution/busy state; do not run callbacks concurrently with user mutations. On execution completion invalidate views even if the variable name did not change: in-place dataframe mutations are possible.

### SAS (future, not an implementation commitment)

Provider registration is language/backend keyed, not a hardcoded R/Python union in table UI. SAS initially returns unavailable (matching U6's reserved adapter), not Python fallback or a launched process. A future provider can speak local/remote SAS dataset access with its own authorization and cancellation policy while satisfying the same handle/query/page/profile model. Preserve dataset/library identity, column labels/formats/informats, length/encoding, character padding, SAS epoch semantics and special numeric missing values. Declare unsupported per-operation capabilities; never infer SAS support from a common grid. Runtime/licensing/remote credential choices are separate approvals.

## 5. Fit with U6/U7/U8 lifecycle and security

Existing evidence: `ds-session/ADAPTER.md`, `ide-host/src/ops/ds_session.rs`, `ide-notebook/src/session_adapter.rs`, and U8 action bridge. U6 uses the unique runtime namespace plus document path, generation/revision guards and trust revalidation; retain those guarantees, do not loosen them for tables.

1. Open from the **explicit** owning notebook/Console, never “the last active Python/R kernel.” U8 editor Run already targets a U7 Console; exploration follows that same document/session, without creating a hidden kernel or `.ipynb`.
2. Host validates trusted calling window/project/document and generation before every operation and **again after** awaited work. Never trust a handle from another window even for the same file path.
3. Kernel restart/stop/death, document close, project replacement, trust revocation and object removal revoke handles and cancel pending work. Old replies must not update new views. U6's selection changes may revoke discovery tokens; a separately opened explorer must either have its own explicitly owned token or become stale, never silently rebind to the new selection.
4. U6 variable revision is a discovery version, **not proof that all dataframe content is unchanged**. Maintain table data/schema/query revisions separately, conservatively invalidate after execution and refresh from the owning adapter. Start with “stale—refresh” semantics, not a promise of transactional snapshots. A coherent page/query must be pinned to a version or rejected when concurrent mutation makes that impossible.
5. The common comm router must route explorer targets independently of execution parents, variables, plots, LSP/DAP and notebook output. Explorer payloads never enter cell output or generic subscriber buses. New registrations require owner coordination; existing U6 polling stays immutable and cheap.
6. Bound paths, projection sizes, filters, replies, jobs and memory. Cancel on close; reject busy/unsupported/timeouts in the UI without executing an alternative interpreter. No network/cloud upload, HTML evaluation, rich object evaluation or automatic export. Render cell text as text; escape clipboard CSV formula payloads under a documented export policy.

## 6. Interaction and performance acceptance requirements (not measured results)

- **Viewport:** row and column virtualization, pinned row headers/selected columns, stable widths, resize/reorder/hide, go-to row/column, page cache and prefetch. Existing grid has row virtualization only; canvas remains optional and replaceable.
- **Shaping:** stable multi-sort, explicit missing ordering, typed numeric/date/text/category filters with AND/OR; server/provider-backed whole-dataset operations; sort/filter resets query cache and selection mapping, not the underlying object.
- **Inspection:** datatype/missing badges, empty/NaN/NA distinction, lossless integer/decimal/value inspector, duplicate names, category levels, long Unicode/multiline values and timezone-aware display. Loading cells must not look like missing data.
- **Exploration:** search scope indicator, Record/Value tabs, column missing/distinct summaries, numeric distributions and categorical frequencies. Label sample versus exact and filtered versus entire dataset; no loaded-page aggregate masquerading as full statistics.
- **IDE UX:** compact OpenIDE token styling, keyboard navigation/range copy, visible focus, accessible grid semantics/screen-reader route, zoom/HiDPI, en/zh text, empty/error/busy/stale/unsupported states. Desktop Linux WebKitGTK, macOS WKWebView and Windows WebView2 need checks; React DOM tests are not desktop acceptance.
- **Read-only first:** no dataframe cell editing, destructive transforms, pivot/report builder, notebook HTML widgets, arbitrary expressions or full export in the first vertical slice. Later clipboard/export must be explicitly user-triggered and streamed/bounded.
- **Proposed initial safeguards**, to validate rather than claim as benchmark results: start pages at 256 rows x 32 columns; cap a decoded response at 2 MiB and cell previews at 4 KiB; 16 MiB LRU per view / 64 MiB broker-wide; at most 2 page requests per view, one cancellable profile job per session and 10s interactive timeout. Enforce encoded bytes and decoded-cache memory accounting, not just row counts. Oversized single values return truncation metadata; no silent partial dataset semantics.
- Test 1M-row / 1k-column **logical** fixtures without eager materialization, wide/narrow screens, fast scroll/cancel/restart and bounded DOM/cache growth. Later measure real pandas/R frames on named hardware, warm/cold runs and each target WebView; publish actual latency/memory/frame evidence and no fabricated “JetBrains-level” speed claim.

## 7. Implementation gates after approval

**U9.1 — smallest unit: contract + conformance fixtures, no production UI and no new npm dependencies.** New neutral contract/provider types, validated envelopes and a bounded fixture provider with R/Python/SAS-representative values. Tests: lossless values/missing variants, duplicate columns, paging, query epochs, handle isolation/revocation, stale responses, bounded cache/cancellation and unsupported capabilities. This unit is not R/Python runtime integration and must not be presented as the explorer shipping.

**U9.2 — separately approved thin read-only vertical slice:** one explicitly selected variable in an existing Python Console and one R/Ark notebook -> schema + bounded page -> small token-themed viewer; capability smoke tests against real ipykernel/Ark; restart/trust/cross-window isolation and native desktop screenshots. Backend/host/session owner edits must be assigned explicitly; no competing edits to U6/U7/U8 files. Existing row virtualizer only; demonstrate limits before choosing canvas.

**U9.3 and beyond:** provider-backed sort/filter, horizontal virtualization and summary jobs; then accessibility/performance acceptance, optional Arrow/canvas spike, advanced exploration, SAS provider. These are a sequence proposal, not BOARD changes or permission to implement.

### Open decisions / blockers

- Verify installed Ark variable-to-explorer opening and supported wire capabilities; Python adapter is new work, not U6 behavior.
- Choose conservative stale views versus explicit snapshots; no false consistency under in-place mutation.
- Clarify a precise Databricks component only if one is required; existing permissible options are sufficient to design the neutral contract.
- New dependency proposal for U9.1: **none**. No dependency installed in Phase 0; all alternatives in the license audit are deferred proposals requiring approval and exact transitive inventory.
