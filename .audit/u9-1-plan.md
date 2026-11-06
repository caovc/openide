# U9.1 approved plan — checkpoint before source changes

Conclusion: implement only transport-neutral TypeScript contract, validated envelopes, lazy bounded fixture and deterministic conformance tests. No runtime/UI/dependencies/registration. Coordinator override authorizes this directory in the existing worktree; no BOARD edit, worktree, delegation, commit or push.

Read in full: `.audit/u9-license-audit.md`, `.audit/u9-architecture.md` (especially U9.1), `.agents/BOARD.md`, `docs/ds/COLLAB.md`. Existing dirty files belong to other agents and are preserved.

Domain shape:
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- Backend is an opaque bounded string, not an R/Python enum. HostScope identifies project incarnation, calling window, owning document, kernel generation, object revision and viewer. Fixture-issued Handle adds a view token; it is not a production security capability.
- Identity echoes Handle + data/schema revision + query epoch. Every request carries identity and request id; pages/schema responses validate exact correlation before consumption. Scope is supplied separately by the simulated trusted host, never inferred from a name/path/expression.
- Cell tagged unions preserve decimal/integer strings, finite/special floats, Python/R/SQL/SAS missing values (including ._ and .A–.Z), revisioned categories, temporal unit/timezone, bounded previews, error/unsupported and nonrecursive nested summaries. Columns have stable ids and ordinals independent of duplicate/empty names.
- Decimal row counts/offsets remain strings with bounded digit length and explicit checked local conversion. Schema/page/projection sizes and JSON/preview bytes are bounded.
- TableProvider supports lazy schema/page/projection, refresh, close and scope revocation. Sort/filter/profile/export report explicit unsupported. Query changes advance per-view epochs and discard pages; refresh invalidates all views of the object. Awaited work rechecks authorization and identity; AbortSignal/lifecycle cancellation releases in-flight slots and cache.
- Cache stores bounded validated wire strings, with LRU accounting shared by an injected global budget and provider/view budgets. No full logical table materialization, timers or benchmark claims.

Checkpoints:
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
1. This plan + preserve baseline; source only `src/features/ds-data-explorer/**`.
2. Contract/validators + fixture provider + ADAPTER.md describing deferred runtime/security/GUI work.
3. Deterministic conformance: value/missing JSON roundtrips, huge offsets, paging/schema bounds, isolation/forgery, stale epochs/replies, revocation/cancellation, budgets/cleanup, unsupported and malformed envelopes.
4. Run exact required vitest command and pnpm typecheck; use installed oxlint/oxfmt for new files (eslint/prettier not installed). Capture commands/output/exit codes under `.audit/u9-1-*`.
5. Report conclusion first, verification TSV and append-only decision log. Recommend separately approved U9.2 Ark smoke first or bounded pandas adapter; do not begin it.

Completed checkpoint: contract/validators/fixture/ADAPTER and deterministic conformance delivered. Final 127 tests + full typecheck + targeted oxlint/oxfmt pass; exact logs indexed in u9-1-verification.tsv. Baseline 144 existing dirty/untracked files unchanged. U9.2 not started.
