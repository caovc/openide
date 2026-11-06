# U12 — Python / R package visualization & management (design only)

**Status:** design / audit only. No implementation, no BOARD claim, no crates/`src/features` edits.
**Author note:** Intended Codex `gpt-6.1-sol` / `gpt-6-luna` runs failed with ChatGPT 403 + `workspace routing discovery failed` (sessions below). This document was authored by the U12 audit executor from local PRODUCT/ROADMAP/BOARD + existing DS adapter notes so the deliverable is not blocked.
**Codex sessions attempted:** `01a1b0ad-233e-7463-8ea7-abac8918c606` (gpt-6.1-sol, exit 1); prior peer Codex-D (`gpt-6-luna`, ephemeral, no file left).

## Product citations

- `docs/ds/PRODUCT.md` (In scope): “Python / R 包可视化管理（能力差异分别支持）；R 另含包文档浏览（规划 U12）。”
- `docs/ds/ROADMAP.md` (Later): “U12 Python / R 包可视化管理：两者能力有差异须都支持；R 另需包文档浏览。路径与验收谓词认领时明确；排在 U9 之后，不打断当前数据探索。”
- `.agents/BOARD.md`: `| U12 | pending | — | — | Python / R 包可视化管理（能力差异分别支持）；R 另含包文档浏览。 |`
- Sequencing constraint from ROADMAP: U9 (data explorer / widgets) comes first; U12 must not interrupt U9.2a Ark explorer smoke.

## 1. Problem & sequencing

Data scientists need an IDE surface to **see and manage** packages in the active Python and R environments, with language-honest UX (pip/venv/conda ≠ CRAN/.libPaths/renv). R users additionally need **in-IDE package documentation** (help topics / HTML help / vignettes sketch).

**Sequence:** U12 starts only after U9 data-explorer path is claimed past U9.2a thin slice (or explicitly parallelized on disjoint paths). U12.0 research may proceed as audit-only (this file). Do not block or fight `crates/**`, Ark rebuild, or `src/features/ds-data-explorer/**`.

## 2. Capability matrix (both languages; differences retained)

Do **not** force a lowest-common-denominator UI that erases language differences. Shared shell + language adapters.

<<<<<<< Updated upstream
| Capability                | Python                                                                  | R                                                                    | Shared UI pattern                                                           |
| ------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Installed inventory       | `pip list` / importlib.metadata / conda list (env-specific)             | `installed.packages()` / `.libPaths()` / renv lock awareness         | Table: name, version, source, location                                      |
| Metadata                  | summary, homepage, requires-python, license from METADATA               | Package Description fields (Title, Version, Depends, License, Built) | Detail pane; fields may differ by language                                  |
| Search / browse remotes   | PyPI / conda channel search (explicit user action)                      | CRAN / Bioconductor / r-universe search (explicit)                   | Search box + language-scoped results                                        |
| Install / update / remove | pip/uv/conda with confirmed target env                                  | `install.packages` / pak / BiocManager against chosen lib            | Confirm dialog; show exact command; stream log to Console or dedicated task |
| Status                    | editable? broken? outdated?                                             | loaded via `search()` / attached? outdated vs CRAN?                  | Badges; never silent mutate                                                 |
| Dependency viz            | requires / required-by graph or table                                   | Depends/Imports/Suggests/LinkingTo + reverse                         | Table first; optional graph later                                           |
| Environment affinity      | venv / conda / system interpreter bound to session runtime selection    | `.libPaths`, user/site/project lib, renv project                     | Bind panel to **same runtime selection** as Console/Variables               |
| Lockfile awareness        | requirements.txt / poetry.lock / uv.lock (detect, not rewrite in U12.1) | renv.lock (detect)                                                   | Read-only indicators in U12.1; mutate ops later                             |
=======
| Capability | Python | R | Shared UI pattern |
| --- | --- | --- | --- |
| Installed inventory | `pip list` / importlib.metadata / conda list (env-specific) | `installed.packages()` / `.libPaths()` / renv lock awareness | Table: name, version, source, location |
| Metadata | summary, homepage, requires-python, license from METADATA | Package Description fields (Title, Version, Depends, License, Built) | Detail pane; fields may differ by language |
| Search / browse remotes | PyPI / conda channel search (explicit user action) | CRAN / Bioconductor / r-universe search (explicit) | Search box + language-scoped results |
| Install / update / remove | pip/uv/conda with confirmed target env | `install.packages` / pak / BiocManager against chosen lib | Confirm dialog; show exact command; stream log to Console or dedicated task |
| Status | editable? broken? outdated? | loaded via `search()` / attached? outdated vs CRAN? | Badges; never silent mutate |
| Dependency viz | requires / required-by graph or table | Depends/Imports/Suggests/LinkingTo + reverse | Table first; optional graph later |
| Environment affinity | venv / conda / system interpreter bound to session runtime selection | `.libPaths`, user/site/project lib, renv project | Bind panel to **same runtime selection** as Console/Variables |
| Lockfile awareness | requirements.txt / poetry.lock / uv.lock (detect, not rewrite in U12.1) | renv.lock (detect) | Read-only indicators in U12.1; mutate ops later |
>>>>>>> Stashed changes

## 3. R-only: package documentation browsing

R requires docs beyond “open a URL”:

1. **Topic help** — `help(topic, package=)` / `?foo` HTML conversion without evaluating arbitrary user expressions; prefer documented Rd → HTML pipeline or Ark/help APIs if available under MIT-compatible public surfaces.
2. **Package index** — list of help topics for an installed package.
3. **Vignettes** — list + open vignette HTML/PDF when present on disk under the package install tree.
4. **Trust** — render help HTML in a **sandboxed** viewer (same isolation posture as future U9 HTML widgets); no privileged JS bridge; no `eval` of package examples unless the user explicitly runs them in Console.

Python counterpart (optional, not U12 gate): open project docs / pydoc / ReadTheDocs link — must not delay R docs delivery.

## 4. Architecture vs existing DS panels

### Patterns to reuse (read-only evidence)

- **Tool windows:** `src/features/ds-session/index.ts` registers `ds-variables` / `ds-plots` via `registerToolWindow`; `ds-console` similarly. U12 candidate: `ds-packages` tool window (anchor right/bottom TBD at claim time).
- **Language adapters:** `src/features/ds-session/ADAPTER.md` — `SessionAdapter` per language; no interpreter fallback; opaque keys; generation + revision guards; no eval. Packages should follow the same adapter split (`PackagesAdapter` python/r) rather than one RPC that runs free-form code.
- **Lifecycle:** Console `generation` (`ds-console/session.ts`) and Session stop-token / generation isolation must apply: inventory replies tagged with `{runtimeSelection, generation}`; restart clears or rebinds package view.
- **Execution ownership:** installs that need a live interpreter should route through the **explicit Console/session** the user selected (U7/U8 pattern), or a dedicated host task with the same runtime selection — never a hidden side kernel.
- **U9 boundary:** DataFrame exploration stays in `ds-data-explorer`; package tables are metadata, not TableProvider object pages. Do not overload U9.1 `HostScope.objectId`.

### Candidate seams (not authorization to edit)

<<<<<<< Updated upstream
| Layer            | Candidate paths (claim later)                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| Frontend feature | `src/features/ds-packages/**` (new)                                                                |
| Contribution     | `src/workbench/contributions` registration from feature `activate`                                 |
| Host / notebook  | `crates/ide-notebook` packages adapter module; `ide-host` ops only if IPC required — list at claim |
| Locale           | `src/platform/locales/text/{en,zh}.json` keys under `ds.packages.*`                                |
| Audit            | `.audit/u12-*`                                                                                     |
=======
| Layer | Candidate paths (claim later) |
| --- | --- |
| Frontend feature | `src/features/ds-packages/**` (new) |
| Contribution | `src/workbench/contributions` registration from feature `activate` |
| Host / notebook | `crates/ide-notebook` packages adapter module; `ide-host` ops only if IPC required — list at claim |
| Locale | `src/platform/locales/text/{en,zh}.json` keys under `ds.packages.*` |
| Audit | `.audit/u12-*` |
>>>>>>> Stashed changes

## 5. Trust & security

- **No arbitrary eval** for inventory/metadata/docs (mirror Variables ADAPTER: opaque keys / structured APIs).
- **Mutating ops** (install/update/remove) require explicit user confirmation showing target env + exact package + channel/mirror.
- Prefer **host-side** or **approved helper** scripts over injecting helpers into user globals (same as Python variables bootstrap isolation).
- Offline / mirror failures: actionable errors; never hang UI without cancel.
- Do not auto-execute package `examples()` or README code blocks.
- Docs HTML: sandboxed; treat as untrusted content.

## 6. Verification predicates (measurable; no mock-as-pass)

1. **Inventory fidelity:** For a fixed test venv with known pip package `P==V` and an R lib with known package `Q` version `W`, Packages panel lists matching name/version/location after binding that runtime.
2. **Isolation:** Python and R sessions open simultaneously do not mix inventories; switching Console runtime rebinds the panel.
3. **Generation guard:** Restart Console/kernel; stale inventory RPC cannot overwrite the new generation’s view.
4. **Mutate (U12.2):** User-confirmed install of a tiny known package appears in inventory; remove reflects absence; both verified by independent `pip show` / `packageVersion` outside the UI.
5. **R docs (U12.3):** Opening docs for a known base or installed package shows non-empty HTML/topic content in the sandboxed viewer; vignette list matches `vignette(package=...)` for that lib.
6. **Non-regression:** Existing Variables/Plots/Console/Editor-run unit suites remain green; no Positron UI source copied; no new dependency without license audit row in `.audit`.

## 7. Non-goals (U12)

- Not HTML widgets / rich MIME (U9 later phase; see `.audit/u9-html-widgets-notes.md`).
- Not SAS package management (U10).
- Not rewriting pip/CRAN/renv/conda themselves.
- Not copying Positron / RStudio / DataSpell UI source.
- Not BOARD status flips, commit, or push from this design unit.
- Not interrupting U9.2a Ark explorer / TableProvider work.

## 8. Proposed sub-phases

<<<<<<< Updated upstream
| Phase | Scope                                             | Write ownership candidates                                   | Gate           |
| ----- | ------------------------------------------------- | ------------------------------------------------------------ | -------------- |
| U12.0 | Research + this design; PyPI/CRAN/help API survey | `.audit/u12-*` only                                          | Design review  |
| U12.1 | Read-only inventory + metadata + env binding UI   | `src/features/ds-packages/**` + thin host list IPC if needed | Predicates 1–3 |
| U12.2 | Install/update/remove with confirm + log          | packages feature + Console/runtime task seam                 | Predicate 4    |
| U12.3 | R docs/vignettes sandboxed viewer                 | packages docs viewer + sandbox                               | Predicate 5    |
=======
| Phase | Scope | Write ownership candidates | Gate |
| --- | --- | --- | --- |
| U12.0 | Research + this design; PyPI/CRAN/help API survey | `.audit/u12-*` only | Design review |
| U12.1 | Read-only inventory + metadata + env binding UI | `src/features/ds-packages/**` + thin host list IPC if needed | Predicates 1–3 |
| U12.2 | Install/update/remove with confirm + log | packages feature + Console/runtime task seam | Predicate 4 |
| U12.3 | R docs/vignettes sandboxed viewer | packages docs viewer + sandbox | Predicate 5 |
>>>>>>> Stashed changes

## 9. Open questions

1. Prefer **session-bound** inventory (what the live kernel sees) vs **filesystem env** inventory when they diverge (e.g. install to another libPath)?
2. Which install backends are in-scope for 12.2: pip only vs uv vs conda; `install.packages` vs pak?
3. Does Ark expose a packages/help comm worth adapting (MIT-compatible public API), or host-side Rscript helpers?
4. Shared dependency-graph visualization library — license audit required before any npm/crates add (same discipline as U9-P0).
5. Localization: when to add zh/en strings relative to GUI acceptance.

## Evidence read (this draft)

- `docs/ds/PRODUCT.md`, `docs/ds/ROADMAP.md`, `.agents/BOARD.md`
- `src/features/ds-session/ADAPTER.md`, `index.ts`, `Panels.tsx` (tool window + generation patterns)
- `src/features/ds-console/index.ts`, `session.ts` (generation / actions)
- `src/features/ds-data-explorer/ADAPTER.md` (U9 boundary; opaque HostScope)
