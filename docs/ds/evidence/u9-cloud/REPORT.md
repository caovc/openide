# U9 cloud continuation — 2026-11-06

Base: `86113f6` (`caovc/openide`), integration branch `work`.

The user requested parallel development against the existing plan and progress. This batch follows the cloud handoff's first two priorities: restore the U9.2a source baseline and implement the isolated canvas core (Phase B). It does not complete all of U9.

## Baseline and ownership

The checked-in Rust and TypeScript explorer sources contained unresolved merge markers. Planning documents also contained duplicate conflict sections. Historical `.audit/u9-2-report.md` and `u9-2-verification.tsv` already existed, despite the handoff calling them pending.

Three agents worked in separate worktrees from the same base:

- `ds/u9-rust-repair`: `crates/ide-notebook/**`.
- `ds/u9-ts-repair`: `src/features/ds-data-explorer/ark.ts` and `ark.test.ts`.
- `ds/u9-canvas-core`: new `src/features/ds-data-explorer/canvas/**`.

Cloud Codex coordinated the canonical BOARD, documentation and integration. No generated IPC bindings, production explorer UI activation, Python adapter or package-management implementation is included.

## Runtime limitations

The prior `/workspace/ark` and `/workspace/mamba/envs/r` installations are absent in this cloud environment. Historical Ark smoke PASS is retained as historical evidence only; no new real Ark/R acceptance is claimed. The existing ignored `ark_explorer` test remains the real-runtime verification entry point once dependencies are restored.

Production host/window capability routing, end-to-end cancellation and concurrent Ark view-open correlation still need dedicated runtime validation before explorer activation. U6–U8 GUI verification also remains outstanding from the prior handoff.

## Verification

Integrated verification:

- `pnpm typecheck`: PASS across all five configurations.
- `pnpm build`: PASS; existing bundle-size/dynamic-import warnings remain.
- Targeted Vitest across explorer/canvas, DS session/console/editor run, recovered build/coverage and console copying: **336 tests, 22 files PASS**.
- `cargo test -p ide-notebook`: **52 passed, 16 ignored**; ignored real-runtime probes were not claimed as passes.
- `cargo clippy -p ide-notebook --all-targets --no-deps -- -D warnings`: PASS.
- `cargo fmt -p ide-notebook -p ide-dap -- --check`: PASS.
- Standard dependency-inclusive clippy is blocked by the existing `ide-lsp/src/launch.rs` nonminimal-bool lint.
- `pnpm lint`: PASS with existing warnings. `pnpm knip`: PASS with a configuration hint.

Unit and compile checks do not substitute for native GUI, runtime or large-table performance acceptance.

## Delivered behavior

Rust source conflicts and duplicate module exports are repaired. Production column/range validation rejects negative columns and oversized windows without integer overflow. Ark TableProvider validates scope/handle/revisions and response dimensions, handles exact tail/empty pages and projection, snapshots requests, propagates cancellation and releases closed transports. Its synchronous refresh invalidates the prepared snapshot; changed backend shape still requires re-preparation.

The standalone canvas core uses exact string/BigInt row addresses, preserves typed cell values, bounds the backing store and paints visible cells with existing theme tokens. It is original code, introduces no dependencies and does not copy dbx source. A compressed physical scrollbar necessarily quantizes huge row spaces; explicit row navigation stays exact. React hosting/accessibility/runtime activation and performance acceptance remain later work.

## Missing baseline modules restored

`src/features/build/**` and `src/features/coverage/**` were missing from the initial fork commit despite live imports. Sixteen files were restored byte-for-byte from upstream `ba9ce1d8421060ef656d37fe613d9e6d20d75738`, under its Apache-2.0 license. This restored the application build without empty stubs. U11 will separately remove their JVM-specific integrations while preserving generic build/coverage functionality.

## Full-suite follow-up

The full `pnpm test` run reports failures outside the targeted slice, including legacy JVM settings/run/tool expectations, missing icon assets and the source-text catalog. It is not a green full-suite baseline. These are tracked separately during the newly authorized U11 removal; the passing counts above refer only to the named targeted checks.
