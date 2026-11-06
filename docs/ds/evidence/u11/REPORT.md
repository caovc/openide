# U11 — JVM toolchain removal

The user explicitly requested removal of the entire JVM toolchain while preserving Python, R, Jupyter and shared IDE functionality. This is implementation work against the existing U11 plan, not merely the prior diagnostic visibility toggle.

## Scope and preservation

Removed built-in Java, Kotlin, Scala, Groovy, Clojure and JSP definitions/grammars; JDK/JDT/Lombok/Kotlin installation and embedded JARs; Maven/Gradle project models and execution helpers; Tomcat/JUnit-specific launch helpers; JVM profiling; JDWP/Kotlin/Java HotSwap and JDT-only RPCs; Android/logcat; associated frontend settings, tool windows, run/debug types, class-file decompilation, JVM editor helpers and official Checkstyle/MyBatis plugins. Generated IPC bindings are regenerated from the resulting Rust surface.

Shared SDK installation, language servers, generic DAP, standard LSP virtual documents, Cargo/Go/TypeScript/CMake builds, Python/Node/Ruby/native execution, console/terminal, project roots, coverage and plugin hosting remain. Ark session LSP/DAP modules and Python debug preparation remain. Generic tests that happened to use Java fixtures were migrated to non-JVM examples; tests exclusively for removed behavior were removed with that behavior.

Historical JVM settings are data-only compatibility. Unknown nested legacy keys and raw run TOML records/templates survive unrelated edits. Old JVM run kinds/adapters are refused before local, SSH or container execution. Compound/before-launch dependencies are preflighted; an invalid/removed target does not silently run another command. No user project files, external JDK installations or user caches were deleted.

## Coordination and upstream changes

Implementation was split across language/syntax/core, SDK/tools/host lifecycle, build/run/workspace/profiler, DAP/LSP/host commands, frontend, editor and integration owners. Each agent used an isolated worktree; root integrated and generated bindings.

The remote SAS planning commit `914f2a7` arrived during work. It was fetched and retained via a non-destructive rebase of the unpublished documentation commit; no force push was used. The prior U9 repair milestone `8fe4af5` and feature backlog `a0939dd` were pushed to `main`.

## Environment

The container has no sudo/system development packages. Native GTK/WebKit dependencies were downloaded from Debian trixie, SHA256-verified and extracted into a local sysroot; no system files were changed. Python virtual environments, R 4.5.0 and official Ark 0.1.252 Linux x64 were prepared separately for real integration tests. Ark archive SHA256: `7dda5d05b6c4d67e7ae74e70b6bec5fd3bc526b19e222fa78306e14972cf4495` (matched official release metadata). License/NOTICE retained with the local runtime.

Local reproduction environment:

```bash
source /workspace/tooling/env.sh
source /workspace/work/tauri-sysroot/env.sh
source /workspace/work/ds-runtime/env.sh
```

Environment preparation verified Python and Ark authenticated local Jupyter execution (`1+1 == 2`), pandas/matplotlib imports and R plotting. Those checks alone do not establish the application integration or full debugging UI acceptance.

## Verification status

- Language/syntax tests: 121 passed.
- Execution slice: build 11, profiler 9, workspace 145, run lib/config/detection/import suites passed; strict no-deps clippy for those four crates passed.
- Process suite: 19 passed, 1 ignored, 4 environment failures (two missing real Go toolchain; two tests treat PID-1-owned zombies as running). Production process lifecycle was not changed to hide those failures.
- Integrated `cargo check -p ide-host --all-targets`: passed after resolving removed-interface consumers.
- DS icon tests: 117 passed, repairing pre-existing duplicate tool-window icons and missing SVG mappings.
- Full frontend, generated bindings, remaining Rust tests and real notebook runtime results are recorded below after completion.

This batch does not claim the whole DataSpell/RStudio feature set is finished. Python Notebook debugging, R debugging UI wiring, production data explorer hosting, interactive widgets and package/help workflows remain separately tracked in `FEATURE-BACKLOG.md` with explicit acceptance criteria.

## Integrated verification (current run)

- `cargo test -p openidea --test export_bindings`: 1 passed; generated bindings committed from Rust, not edited by hand. The generator emits one trailing space in a union; the generated file is intentionally excluded from oxfmt.
- All five TypeScript configurations passed; Vite production bundle passed (existing chunk-size/dynamic-import warnings).
- `cargo clippy --workspace --all-targets -- -D warnings`: passed, including native Tauri targets. Removed JVM-specific test calls were migrated to shared Python/LSP scenarios; minor Rust 1.96 boolean simplifications were needed in existing database/smoke helpers.
- `cargo test -p ide-notebook -- --include-ignored --nocapture --test-threads=1`: **68 passed, 0 failed, 0 ignored** with real Python and Ark. Covers Ark DataExplorer, authenticated execution, session LSP, DAP breakpoints/variables/evaluate/step, stdin cancellation, interpreter changes, Python/R variable and plot isolation, restart and shutdown.
- oxlint passed with existing warnings; knip passed with one stale ignore-pattern hint.
- A full frontend pass found only six catalog failures after deleting Spring/preparation UI. The eight now-unused text keys were removed from six locale catalogs, preserving active translations; targeted catalog/remote/run-anything checks passed (131 tests, 6 existing skips). A final full run follows.
- Native GUI/E2E was not verified: this execution container has no DISPLAY or Xvfb, and no Tauri MCP tools are available. Backend/DOM checks do not substitute for that acceptance.

Local log files are under `/workspace/work/u11-*`; this report carries the durable conclusions. Python/R environment management and complete debugging UI remain planned work, now split in the linked research documents; Ark DAP transport passing is not R Notebook debug UI completion.

### Final automated results

- Full frontend: **621 files passed; 6,779 tests passed, 6 existing skipped**, no failures (`u11-full-tests-clean.log`).
- Whole-repository oxfmt check and cargo fmt check passed.
- Thirteen affected Rust library suites: **834 passed, 3 environment failures, 7 ignored** after rerunning the corrected DAP fixture (47/47 passed). Build, DAP, DB, host, language, LSP, profiler, run, SDK, syntax and workspace have no remaining failures in this run.
- The three failures are two `ide-core` process-tree tests and one `ide-tools` cancellation test. `ps` showed the exact asserted child PIDs 135739, 135743 and 137152 as `PPID=1 STAT=Z`: already exited, not reaped by this container's PID 1. No production lifecycle code or liveness assertions were weakened to turn these into passes. These are distinct from the earlier process-integration Go-toolchain limitations above.

Environment planning is now P0 for the shared selection contract, venv, R versions/libraries, renv activation and cross-workflow environment consistency; Conda/Mamba, uv, Poetry and renv lock operations are P1. See `docs/ds/research/2026-11-06-environments.md`.

- Additional integrated host acceptance: `u7_console_real_runtime` passed separately with `OPENIDE_U7_RUNTIME=python` and `ark` (one real test each), covering retained state, parallel Console isolation, stdin reply/close, restart, no notebook file creation and empty kernel runtime directory after close.
- Generic stdio crash diagnostics integration: 2/2 passed after replacing the removed Java classpath request with a Python hover request and checking crash events separately.
