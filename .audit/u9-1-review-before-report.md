CONCLUSION: APPROVED U9.1 is implemented and fixture-conformance verified. Final 127 tests, full repository typecheck, targeted repository lint and format checks pass (exit 0). This is transport-neutral groundwork only: NO real R/Python/SAS runtime, production security, performance or native GUI acceptance is claimed. U9.2 has not started.

## Files delivered

All six new source/documentation files are under `src/features/ds-data-explorer/`:

<<<<<<< Updated upstream
| File                  | Purpose                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `contract.ts`         | Backend-keyed JSON domain, precise cell/missing unions, scope/identity, schema/page/query/profile requests and TableProvider interface      |
| `validation.ts`       | Self-contained strict unknown-envelope validation, copying, checked decimal conversion, response correlation, size and finite-number checks |
| `cache.ts`            | Shared fixture LRU, view/provider/global retained-payload accounting and cleanup                                                            |
| `fixture.ts`          | Lazy 1,000,000-row x 1,000-column fixture, lifecycle/epoch guards, bounded requests, AbortSignal and explicit unsupported results           |
| `conformance.test.ts` | 127 deterministic conformance tests, including 58 representative value roundtrips                                                           |
| `ADAPTER.md`          | Contract conventions, bounds, fixture-only authority, accounting limits and deferred adapter gates                                          |
=======
| File | Purpose |
| --- | --- |
| `contract.ts` | Backend-keyed JSON domain, precise cell/missing unions, scope/identity, schema/page/query/profile requests and TableProvider interface |
| `validation.ts` | Self-contained strict unknown-envelope validation, copying, checked decimal conversion, response correlation, size and finite-number checks |
| `cache.ts` | Shared fixture LRU, view/provider/global retained-payload accounting and cleanup |
| `fixture.ts` | Lazy 1,000,000-row x 1,000-column fixture, lifecycle/epoch guards, bounded requests, AbortSignal and explicit unsupported results |
| `conformance.test.ts` | 127 deterministic conformance tests, including 58 representative value roundtrips |
| `ADAPTER.md` | Contract conventions, bounds, fixture-only authority, accounting limits and deferred adapter gates |
>>>>>>> Stashed changes

Audit delivery: `.audit/u9-1-plan.md` (written before source), this report, `.audit/u9-1-verification.tsv`, `.audit/u9-1-final-*.log`, tool-availability log, before/after status, preservation/source SHA-256 logs and retained iteration logs. One append-only U9.1 decision entry is added to `.audit/ds-ide.tsv`.

No source outside the allowed new directory was edited. No feature activation, contributions/tool window, dependency manifest, bindings, BOARD or worktree changes. No runtime/session/console/editor-run source needed to be read or edited. No cloud tools, subagents, installs, commits or pushes. The baseline comparison checks all 144 pre-existing dirty/untracked files and reports zero content changes; `.audit/u9-1-preservation.log` is the evidence. `git diff --stat` omits these untracked additions and includes other agents' existing work, so use the six-file list and `.audit/u9-1-source-sha256.log` for this delivery.

## Decisions and behavior

- No directly available runtime schema dependency was present; use local validators with no `any`, suppression or unchecked type assertions. Literal `as const` declarations retain enum literals. Strict object keys and dense arrays reject malformed envelopes, including sparse JavaScript arrays that `map` would otherwise skip.
- Backend identifiers are bounded opaque strings. HostScope carries project incarnation, calling window, owning document, generation, object revision and viewer; no names, paths or expressions resolve objects. The fixture's predictable tokens and host callback demonstrate isolation behavior only. They are explicitly NOT production authorization capabilities.
- Integers/decimals retain strings (including decimal scale). Finite floats reject NaN/infinities/negative zero; separate tags encode these values losslessly. Missing data covers all 39 supported variants: Python 3, R 7, SQL 1, SAS 28 (including `._` and `.A`–`.Z`). SAS strings are data, never executable SAS. Category dictionary revisions, temporal resolution/timezone/origin, bounded previews, errors/unsupported and nonrecursive nested summaries stay typed.
- Duplicate/empty display names use stable column ids/ordinals. Row counts and offsets stay canonical decimal strings up to 128 digits. Huge valid offsets are preserved and return an empty fixture page without unsafe Number conversion. Exact/estimated/unknown row count shapes validate.
- Data/schema/query revisions and complete response identity/request/range/projection correlation reject stale envelopes. Query projection is per-view; changes cancel/evict its work. Refresh invalidates all existing viewers of the same scoped object; other objects remain isolated. Inputs and returned/cache objects are copied.
- Open never materializes the logical table. Pages cap at 256 x 32; schema caps at 32 columns, complete responses at 2 MiB and previews at 4 KiB. Incremental payload accounting refuses oversized page generation; no silent partial dataset is returned. Smaller valid budgets can intentionally refuse requests.
- The injected shared LRU enforces view/provider/global budgets. It retains validated wire strings and charges UTF-16 payload plus UTF-8 bytes, key storage and a bookkeeping reserve; no decoded graph is retained. This bounds accounted retained payload, not exact engine heap or consumer allocations. Defaults are 16/64/64 MiB. Per-view in-flight schema/page requests cap at 2; per-provider default is 8. AbortSignal, close, revoke, refresh and query changes settle pending reads even if the fixture seam ignores cancellation, and cleanup releases slots/cache. No timers run.
- Sort/filter/profile/export return explicit unsupported results without query mutation. A bounded typed equality predicate and sort keys are negotiation shapes, not an implemented query engine. No fake full-data summaries or export behavior.

## Verification evidence

Commands were run from `/workspace/openide` without installation:

<<<<<<< Updated upstream
| Exact command                                           | Result                          | Full log                             |
| ------------------------------------------------------- | ------------------------------- | ------------------------------------ |
| `pnpm vitest run src/features/ds-data-explorer`         | exit 0; 127 passed              | `.audit/u9-1-final-vitest.log`       |
| `pnpm typecheck`                                        | exit 0; all configured projects | `.audit/u9-1-final-typecheck.log`    |
| `pnpm exec oxlint src/features/ds-data-explorer`        | exit 0                          | `.audit/u9-1-final-lint.log`         |
| `pnpm exec oxfmt --check src/features/ds-data-explorer` | exit 0; six files               | `.audit/u9-1-final-format-check.log` |
=======
| Exact command | Result | Full log |
| --- | --- | --- |
| `pnpm vitest run src/features/ds-data-explorer` | exit 0; 127 passed | `.audit/u9-1-final-vitest.log` |
| `pnpm typecheck` | exit 0; all configured projects | `.audit/u9-1-final-typecheck.log` |
| `pnpm exec oxlint src/features/ds-data-explorer` | exit 0 | `.audit/u9-1-final-lint.log` |
| `pnpm exec oxfmt --check src/features/ds-data-explorer` | exit 0; six files | `.audit/u9-1-final-format-check.log` |
>>>>>>> Stashed changes

ESLint/Prettier local executables are unavailable; used the existing repository oxlint/oxfmt tools only on new files. Exact availability commands/statuses are in `.audit/u9-1-tool-availability.log`. Iteration failures were corrected and retained logs/TSV distinguish them from final checks. The tests use controlled promises, not timers or speed assertions.

Coverage includes lossless JSON roundtrips and huge offsets/counts; every missing variant; duplicate/empty columns; schema and first/middle/last/out-of-range pages; ordered projections and preview byte limits; six scope axes plus foreign/forged handles; authorization recheck after awaiting; revocation/close/refresh/query during pending work; stale responses after refresh/query; caller mutation; per-view/provider in-flight caps and duplicate ids; cancellation and transport failure cleanup; LRU eviction, shared/global/provider/view budgets and lifecycle release; invalid config, malformed/sparse envelopes and nonfinite payload rejection; explicit unsupported operations.

## Known gaps and handoff

No runtime transport/broker, host capability issuance, native GUI, grid, real Ark/ipykernel/pandas/SAS data access, actual backend job cancellation or runtime mutation consistency has been exercised. The host must supply lifecycle notifications and keep obsolete scopes denied. Fixture revoke releases existing handles, not a permanent authorization deny list. Validators assume plain JSON data, not hostile proxies/accessors. Incoming transport framing/byte limits and decoded consumer memory are future adapter responsibilities; cache accounting is not an exact heap measurement. Dictionary-level paging/labels, row keys/index metadata, nested expansion, full query/profile/export results, timeout policy, streaming, UI localization/accessibility and performance acceptance remain deferred in ADAPTER.md.

Recommend separately approved **U9.2 R Ark variable-to-explorer capability smoke first**, then a bounded read-only adapter slice with explicit host/session owner coordination. A bounded known-concrete-type Python pandas adapter is the alternative first slice if selected. Do not install pandas or change ipykernel ownership implicitly. Neither path, nor SAS runtime work, starts in U9.1.
