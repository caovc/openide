# DS-01E0/E1/E2 — Environment inspection and selection slice

Date: 2026-11-06 (Asia/Shanghai). Four agents worked in isolated worktrees on Python inspection, read-only R project metadata, frontend selection/details, and protocol/review research. Root owned host/Tauri registration, generated bindings, integration and verification.

## Delivered behavior

- Notebook and Console have lazily loaded environment details and refresh/error states. Python shows the selected executable, version, environment/base prefixes, venv identity and discoverability of ipykernel/debugpy/pip. The existing Python environment settings action provides the management entry; no package install or environment creation is triggered by inspection.
- Python queries use an explicit absolute interpreter, a neutral working directory, `-E`, and the existing bounded query helper (10 seconds). They do not import the probed packages, canonicalize two venvs into one identity, or silently substitute another interpreter. Host invocation requires project trust.
- R details show labeled Ark/R_HOME paths and project-root renv metadata, including the locked R version/package count. Read-only inspection never executes `.Rprofile` or `renv/activate.R`, and never establishes that renv is active in a running session. Missing/malformed/oversized lockfiles have diagnostics; lock reads are bounded to 4 MiB.
- The R host command uses the opened project or the matching workspace member, not a Notebook subdirectory or arbitrary ancestor project. The read-only command is allowed in restricted projects; Python execution-based inspection remains denied there.
- Notebook default interpreter resolution now receives the Notebook file path. New Console choices prefer the effective project Python over the first discovered interpreter. Explicit choices and existing Console sessions are preserved; automatic defaults follow the effective default when the environment list is refreshed. Project changes reset the form and discard previous-project requests, including details for an identical runtime selection.
- Environment details ignore late results from old selections. Inspection does not alter kernel generation, start a kernel, activate renv, or change other sessions.

## Verification

Backend:

- `cargo test -p openidea --test export_bindings`: passed; bindings generated from real Rust IPC types.
- `cargo test -p ide-host --test environments`: 2 passed (trust boundaries, no profile execution, member-project root).
- `cargo test -p ide-sdk --lib python::environment_tests -- --include-ignored --nocapture`: 3 passed, including two real new venvs with isolated module markers and a shadow-PYTHONPATH check. The dependency markers deliberately throw if imported; discovering them succeeds without imports.
- `cargo test -p ide-notebook environment::tests`: 7 passed (read-only metadata, valid/invalid locks, bounded files, fixed roots and broken symlinks).
- Strict clippy for `ide-sdk`, `ide-notebook`, `ide-host`, and native `openidea`, all targets: passed.

Frontend/UI:

- All five TypeScript configurations, production Vite bundle, oxlint, knip and formatting checks passed. Lint/build retain existing warnings; knip retains the existing ignored-glob hint.
- Full Vitest run before the review follow-ups: 623 files, 6,793 passed, 6 existing skipped. Final follow-up results are recorded below.
- Playwright in Chromium over `http://127.0.0.1:1450`, 1400×900: Python and R Console flows passed. This is the real rendered frontend with **mocked native IPC**, not native desktop/kernel execution. Backend tests above independently cover real probes.
- The Python flow selects a project default, switches while its query is pending, rejects the obsolete result, refreshes details/list without losing an explicit choice, and dispatches the existing settings action. The R flow displays locked-version metadata and explicitly unverified activation without calling the Python probe.
- Page identity (`acme-api`), meaningful content, absent Vite overlay and relevant console/page errors were checked. Screenshot review found an undefined spacing token and outer-panel scrolling; these were fixed and the same interaction rerun. The picker/summary remain visible and details scroll internally.

Browser tooling: the listed Browser plugin exposed no callable browser tool. The CUA initialization failed with `the gaas-browser node_repl sandbox cannot be disabled`. The repository's documented Playwright workflow was used with installed `/usr/bin/chromium`; no new browser dependencies were installed. Native Tauri GUI was not validated.

Local evidence: `/workspace/work/env-*.log`, before screenshot `/workspace/work/env-console-before.png`, after screenshots under `/workspace/work/env-e2e-output/`. Screenshots are not committed. Before and after use the same viewport, sample project and Other venv selection. The isolated baseline server/browser were stopped after capture.

## Remaining plan

This completes an inspection/selection slice, not all environment management. Explicit renv startup/activation and runtime `.libPaths()`/R version verification, multiple installed R versions, a complete shared environment descriptor/selection contract, Conda/Mamba/uv/Poetry workflows and end-to-end creation/install/run acceptance remain tracked. Windows/UNC selection parsing is unit-tested; Windows runtime acceptance is not established by Linux tests.

The next Notebook debugging prerequisite is DS-04B0: start/negotiate a kernel without executing a user's cell. See `docs/ds/research/2026-11-06-next-slices.md`; environment diagnostics alone do not prove Jupyter debugger capabilities.

## Final review follow-ups

Independent review found and fixed three issues before submission: automatic default versus explicit Console selection; previous-project forms/pending requests surviving project changes; and a file-only diagnostic that incorrectly asserted renv was not activated. The form now remounts by project root, and diagnostics describe activation as unverified.

- Final targeted Notebook/Console/details/catalog run: **105 passed, 6 existing skipped**, 11 files. Covers default A→B refresh, explicit/deleted choices, cross-project late replies and identical R selections across projects.
- Final browser run: **4 passed**, Python/R flows at **1400×900 and 960×720**. Picker/summary remained usable; details scrolled internally. No relevant console/page errors or Vite overlay occurred.
- Final production bundle and main TypeScript check passed. All five standard typecheck configurations had passed with generated bindings.
- An extra standalone `tsrs -p e2e --noEmit` check exposes existing e2e configuration problems (missing source aliases/Vite declarations and an unknown argument in `icls-php.spec.ts`); this is not one of the repository's five standard configurations. Its obsolete dedicated `linkedGradle.spec.ts` was removed separately in `742cabf`, following U11. The e2e configuration was not weakened to suppress the other errors; actual new Playwright tests pass as recorded above.
