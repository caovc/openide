# U9 later — HTML widgets acceptance sketch (audit only)

**Status:** audit sketch only. Not U9.2a. Not U12. No implementation.
**Codex:** Attempted `gpt-6.1-sol` session `01a1b0ad-1b7c-7161-b405-eb0718c0418a` — failed (403 / workspace routing). Document authored by audit executor from product notes + DS adapters.

## Citations

- `docs/ds/PRODUCT.md`: RStudio-like HTML widgets among shared Session surfaces; “第一单位同时做 … 或 HTML widgets” is out of scope for early units.
- `docs/ds/ROADMAP.md` U9 verification: “真实 HTML widget 展示、富内容权限与不可信内容隔离测试通过”.
- `.agents/BOARD.md` U9 in_progress (data explorer); U12 packages is separate — do not merge.
- `src/features/ds-session/ADAPTER.md`: Plots support PNG/JPEG/SVG only; “HTML widgets and interactive plot resizing/render RPCs are outside U6.” SVG already uses `<img>`, never workbench HTML.

## 1. Goal / non-goals

**Goal (later U9 phase after U9.2a schema/page smoke):** Display interactive HTML widget / rich HTML outputs from R and Python sessions in a **sandboxed** viewer bound to session generation, with explicit trust tests.

**Non-goals:** Package management (U12); TableProvider grid work (U9.1/U9.2a); rewriting notebook output security wholesale; copying Positron widget host UI; claiming performance without measured fixtures.

## 2. Capability matrix sketch

<<<<<<< Updated upstream
| Concern          | R                                                                | Python                                                                   | Common                                                     |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Source artifacts | `htmlwidgets` sized HTML+deps; plotly/leaflet/DT class outputs   | Jupyter `text/html`, `_repr_html_`, sometimes mimebundle + widgets model | Normalized “rich HTML blob + asset refs” envelope          |
| Delivery         | Ark/Jupyter display_data or dedicated widget comm (TBD research) | ipykernel iopub display_data / update_display_data                       | Session-scoped history similar to Plots                    |
| Interactivity    | JS inside widget                                                 | JS / ipywidgets (ipywidgets full protocol may be **deferred**)           | Sandboxed iframe/webview; no host bridge by default        |
| Assets           | Dependent JS/CSS from package install paths                      | Require carefully allowlisted blob/data URLs                             | No raw `file://` into workbench; prefer packaged blob URLs |
=======
| Concern | R | Python | Common |
| --- | --- | --- | --- |
| Source artifacts | `htmlwidgets` sized HTML+deps; plotly/leaflet/DT class outputs | Jupyter `text/html`, `_repr_html_`, sometimes mimebundle + widgets model | Normalized “rich HTML blob + asset refs” envelope |
| Delivery | Ark/Jupyter display_data or dedicated widget comm (TBD research) | ipykernel iopub display_data / update_display_data | Session-scoped history similar to Plots |
| Interactivity | JS inside widget | JS / ipywidgets (ipywidgets full protocol may be **deferred**) | Sandboxed iframe/webview; no host bridge by default |
| Assets | Dependent JS/CSS from package install paths | Require carefully allowlisted blob/data URLs | No raw `file://` into workbench; prefer packaged blob URLs |
>>>>>>> Stashed changes

**Language-specific:** R htmlwidgets self-contained HTML is the first R acceptance target. Python first target: static/interactive `text/html` from a known library (e.g. plotly offline HTML) — **not** full ipywidgets binary protocol unless separately claimed.

## 3. Trust boundary

- Treat all widget HTML/JS as **untrusted**.
- Render in sandboxed iframe/webview: default deny; no parent DOM access; no Tauri IPC bridge unless a future explicit capability is designed and audited.
- Reuse lessons from `src/features/notebook/security.ts` (MIME allowlists, strip dangerous tags) and markdown iframe stripping tests — but session widgets need a dedicated viewer, not notebook cell HTML injection into the workbench chrome.
- Bind entries to `{documentId/consoleId, generation}` like Plots; restart clears widget history for that generation (`ds-session` ADAPTER lifecycle).
- Console/Session ownership: widgets produced by session A never appear under session B.

## 4. Acceptance predicates (measurable)

1. Real R: execute a representative htmlwidget (e.g. a minimal DT/plotly/leaflet example with pinned package versions in the test R lib); widget appears in viewer; interaction works inside sandbox (scroll/zoom as applicable).
2. Real Python: produce `text/html` rich output from the test ipykernel; appears in the same shared viewer shell with correct language/session labeling.
3. Isolation: dual sessions → no cross-listing; restart → old widget handles dead.
4. Security tests: crafted HTML attempting `parent` access, inline privileged patterns, or external navigation is contained; automated test proves sandbox flags / CSP posture.
5. No invented “pass” from mocks alone — predicates 1–2 need real kernels (same ENV constraints as other DS units; EPERM → blocked, not done).

## 5. Sequencing

1. Now: audit only (this file); U9.2a owns Ark explorer capability smoke + read-only page slice.
2. After U9.2a: data-explorer UI may land; widgets can research display_data capture in parallel on **disjoint** paths (`ds-widgets` candidate), but must not edit explorer contracts casually.
3. Blocked on: concrete Ark HTML widget / plot comm story; Python mime capture reuse from Plots path; sandbox host choice (iframe vs Tauri webview).

## 6. Open questions / blockers

- Does Ark emit htmlwidgets via standard Jupyter MIME or a Positron-specific channel we must avoid copying?
- Asset bundling: inline vs cached package www/ files.
- Full ipywidgets protocol: in or explicitly out for the first widgets gate?
- Codex CLI currently failing (403) — regenerate richer notes when tooling recovers if needed.

## Evidence read

- `docs/ds/PRODUCT.md`, `docs/ds/ROADMAP.md`, `.agents/BOARD.md`
- `src/features/ds-session/ADAPTER.md` (Plots MIME limits; widgets out of U6)
- `src/features/notebook/security.ts` (existence of MIME/HTML hardening — pattern reference only)
