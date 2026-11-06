# Java / JVM soft-hide (phase A)

Status: verified source + automated UI/runtime regressions. No commit/push. No phase B deletion. Base HEAD: `ba9ce1d8`.

## Default DS surface

- `LanguageRegistry::load` excludes the embedded `java`, `kotlin`, `scala`, `groovy`, `jsp`, `clojure` definitions. All TOMLs stay on disk and are still checked for validity; Python/R and other non-JVM definitions are unchanged. Explicit user language TOMLs remain supported.
- `src/platform/productProfile.ts` owns reversible frontend exclusion lists. Run-type pickers/templates hide Application, Spring Boot, Tomcat, Maven, Gradle, Remote JVM, Java/Kotlin/Scala/Groovy/Clojure run kinds and JVM debugger adapters. Saved/detected/pinned/recent/temporary configurations are filtered from picker/edit-tree presentation, without deleting or rewriting stored configurations. Existing contributions stay registered for diagnosis and backwards-compatible parsing.
- Caret/file/gutter producers reject JVM source paths and exclude JVM build configurations from context/directory production. Python and R file production is covered by tests.
- Debug-adapter form omits `java-debug` and `kotlin-debug-adapter`; language-server/tool settings hide JDT LS, Lombok, Kotlin servers/debugger, Clojure/Metals/Groovy tools, and tools dedicated exclusively to JVM languages.
- Settings/search registry omits Java, Maven, Gradle pages. New Projects Settings now lands on Python Interpreter, not JDK setup. Generic Project Structure remains (also needed for Python and other projects).
- Welcome has no JVM-specific plugin entries: retain the generic Plugins contribution. Welcome DOM tests remain green; no welcome implementation edits.
- Scope is soft hiding, not a security boundary or hard removal. Native menus/actions or direct internal API calls are not a blanket JVM execution prohibition; retained runtime/Android/JDT resources are phase B work.

## Diagnostic opt-in

Launch/rebuild with both variables, e.g. `OPENIDE_JVM=1 VITE_OPENIDE_JVM=1 pnpm tauri dev`.

- Backend: `OPENIDE_JVM=1` when `LanguageRegistry::load` executes restores embedded JVM definitions (requires relaunch of an already running backend).
- Frontend: `VITE_OPENIDE_JVM=1` at Vite/build startup restores JVM presentation. Restart Vite for an already running dev preview; do not set this for normal DS builds.
- For a single backend language definition, explicitly copy its retained TOML into the configured user language override directory; UI JVM filters remain unless the frontend opt-in is also enabled.
- Legacy JVM-focused frontend test suites run with `VITE_OPENIDE_JVM=1`; dedicated DS-profile tests exercise the default exclusion and opt-in restoration.

## Verification

All final commands below exited 0. Installed Rust must be selected via `PATH="$HOME/.cargo/bin:$PATH"` (system default Cargo invokes unsupported rustc 1.85.1).

<<<<<<< Updated upstream
| Command                                                                                                                                                                                                                                                  | Result                                                                    | Log                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------- |
| `pnpm typecheck`                                                                                                                                                                                                                                         | all project configurations pass                                           | `.audit/java-typecheck.log`             |
| `PATH="$HOME/.cargo/bin:$PATH" cargo test -p ide-language --lib`                                                                                                                                                                                         | 99 passed (registry 22 included)                                          | `.audit/java-language-full.log`         |
| `pnpm vitest run src/features/run/dsProfile.test.tsx src/features/settings/__tests__/dsProfile.test.ts src/features/welcome/welcome.test.tsx src/features/notebook`                                                                                      | 72 passed / 9 files; includes actual adapter form DOM and tools filtering | `.audit/java-frontend-tests.log`        |
| `VITE_OPENIDE_JVM=1 pnpm vitest run src/features/run/runConfigTypes.test.tsx src/features/run/producers.test.ts src/features/run/configs.test.ts src/features/run/jvmTypes.test.ts src/features/run/remote.test.tsx`                                     | 186 passed / 5 files                                                      | `.audit/java-legacy-tests.log`          |
| `PATH="$HOME/.cargo/bin:$PATH" OPENIDEA_TEST_PYTHON="$PWD/.audit/python-u2/bin/python" OPENIDEA_TEST_PYTHON_SECOND="$PWD/.audit/python-u2-second/bin/python" cargo test -p ide-notebook --test kernel_runtime -- --ignored --nocapture --test-threads=1` | real Python 7 passed                                                      | `.audit/java-python-runtime.log`        |
| `PATH="$HOME/.cargo/bin:/workspace/mamba/envs/r/bin:$PATH" R_HOME=/workspace/mamba/envs/r/lib/R OPENIDE_ARK=/workspace/ark/target/release/ark cargo test -p ide-notebook --test ark_smoke -- --ignored --nocapture --test-threads=1`                     | real Ark 5 passed, LSP/DAP/stdin + process cleanup ESRCH                  | `.audit/java-ark-runtime.log`           |
| `VITE_OPENIDE_JVM=1 pnpm vitest run src/features/settings/__tests__/dialog.test.tsx src/features/tools/__tests__/tools.test.tsx`                                                                                                                         | 49 passed / 2 files; jsdom emits non-fatal canvas getContext notice       | `.audit/java-legacy-settings-tests.log` |
| `pnpm exec oxlint <14 touched TS/TSX paths>`                                                                                                                                                                                                             | 0 errors/warnings                                                         | `.audit/java-lint.log`                  |
| `git diff --check`                                                                                                                                                                                                                                       | pass                                                                      | terminal                                |
=======
| Command | Result | Log |
| --- | --- | --- |
| `pnpm typecheck` | all project configurations pass | `.audit/java-typecheck.log` |
| `PATH="$HOME/.cargo/bin:$PATH" cargo test -p ide-language --lib` | 99 passed (registry 22 included) | `.audit/java-language-full.log` |
| `pnpm vitest run src/features/run/dsProfile.test.tsx src/features/settings/__tests__/dsProfile.test.ts src/features/welcome/welcome.test.tsx src/features/notebook` | 72 passed / 9 files; includes actual adapter form DOM and tools filtering | `.audit/java-frontend-tests.log` |
| `VITE_OPENIDE_JVM=1 pnpm vitest run src/features/run/runConfigTypes.test.tsx src/features/run/producers.test.ts src/features/run/configs.test.ts src/features/run/jvmTypes.test.ts src/features/run/remote.test.tsx` | 186 passed / 5 files | `.audit/java-legacy-tests.log` |
| `PATH="$HOME/.cargo/bin:$PATH" OPENIDEA_TEST_PYTHON="$PWD/.audit/python-u2/bin/python" OPENIDEA_TEST_PYTHON_SECOND="$PWD/.audit/python-u2-second/bin/python" cargo test -p ide-notebook --test kernel_runtime -- --ignored --nocapture --test-threads=1` | real Python 7 passed | `.audit/java-python-runtime.log` |
| `PATH="$HOME/.cargo/bin:/workspace/mamba/envs/r/bin:$PATH" R_HOME=/workspace/mamba/envs/r/lib/R OPENIDE_ARK=/workspace/ark/target/release/ark cargo test -p ide-notebook --test ark_smoke -- --ignored --nocapture --test-threads=1` | real Ark 5 passed, LSP/DAP/stdin + process cleanup ESRCH | `.audit/java-ark-runtime.log` |
| `VITE_OPENIDE_JVM=1 pnpm vitest run src/features/settings/__tests__/dialog.test.tsx src/features/tools/__tests__/tools.test.tsx` | 49 passed / 2 files; jsdom emits non-fatal canvas getContext notice | `.audit/java-legacy-settings-tests.log` |
| `pnpm exec oxlint <14 touched TS/TSX paths>` | 0 errors/warnings | `.audit/java-lint.log` |
| `git diff --check` | pass | terminal |
>>>>>>> Stashed changes

The retained folding-fixture test now explicitly loads all disk definitions and supplies those definitions to its Syntax/SyntaxCache; it no longer incorrectly assumes JVM definitions exist in the default DS registry. Runtime syntax implementation unchanged.

Native GUI verification and a full workspace build/test suite were not run. Existing Tauri preview was neither killed nor relaunched. Frontend changes can HMR, but the running backend retains its old registry until its next build/relaunch; do not claim all language UI in that existing process has already changed.

## Roadmap / handoff

PRODUCT + ROADMAP updated only; no new Console/viewer implementations:

- U6: R/Python shared Session variable viewer and plots; language adapters, session isolation, SAS-ready interface.
- U7: standalone R/Python interactive Console.
- U8: editor selection/current-file Run to an explicit language session.
- U9 (formerly U7): R/Python shared JetBrains DataSpell/IDEA-level data exploration + HTML widgets; virtual scrolling, sort/filter, types/missing values/summaries, representative large-table evidence and agreed thresholds, SAS extension contract. dbx components remain candidates pending concrete source/license audit; match IDE style, never copy proprietary source.
- U10 (formerly U8): Windows SAS.
- U11 Later: phase B hard-removal of JVM/Android toolchains, code, assets and dependencies, with shared-seam audit, legacy-config migration, independent builds and DS real-runtime regressions.

Canonical BOARD is coordinator-write-only per COLLAB, so it was not edited by this executor. Parent should synchronize its old U7/U8 rows to this numbering and add the future units; ROADMAP already fulfills the required Later item.

No U5 runtime/DAP/stdin files, bindings, language TOMLs or `ide-android` were edited. Only shared run-type presentation gained a small filter in contributions.ts.
