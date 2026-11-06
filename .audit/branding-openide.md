# OpenIDE branding pass (user-visible)

Date: 2026-11-06 (Asia/Shanghai)

## Done

- Product name strings **OpenIDEA → OpenIDE** in:
  - `src-tauri/tauri.conf.json` (`productName`, window `title`, copyright, short/longDescription)
  - `src-tauri/tauri.linux.conf.json` / `tauri.windows.conf.json` window titles
  - `index.html` `<title>` + splash wordmark (SVG outlines → text `div.splash-wordmark`)
  - `public/splash.css` wordmark as Inter/system-ui text
  - Welcome / Workbench: `ProjectsPage`, `WelcomeView`, `Welcome.tsx`, `TitleBar.tsx`, `Workbench.tsx`
  - `AboutDialog` product name line
  - Locale message catalogs (`src/platform/locales/*.json`) app title / About / Quit / update strings
  - `app.about.tagline` (en/zh): data-science fork based on OpenIDEA
  - File-filter label `OpenIDE settings` in `projectActions.ts` + matching text-catalog keys
  - Tests: welcome, TitleBar, lightEdit, menuBridge, updates, shell, textCatalog proper-noun list
- Status bar memory label (`src/features/perf/memory.ts`) and Java “Build and run using” option/`hint`
- App icon PNGs / ICO from `.audit/openide-icon-source.jpg` into `src-tauri/icons/`
  (32, 128, 128@2x, icon.png 512, Square*, StoreLogo, icon.ico).
  Welcome / About already import `128x128.png`; Workbench opening screen switched to that PNG.

## Deferred (intentionally unchanged)

- `package.json` `"name": "openidea"`, Cargo package / crate names, `mainBinaryName: "openidea"`
- App identifier `ai.l0ng.openidea` (app-data path)
- `localStorage` keys `openidea.*`
- CSP / custom protocol `openidea-plugin:`
- Updater endpoint still `l0ng-ai/openidea` releases
- Font alias `OpenIDEA User Font …` in `src/platform/fonts.ts`
- Plugin engine copy (`Update OpenIDEA to install it`), IntelliJ-import / Gradle hint strings
- Debugger “Install OpenIDEA's copy” messages
- Settings color-scheme / font sample snippets that say OpenIDEA
- README / docs / THIRD_PARTY wordmarks (`src-tauri/icons/source/openidea-wordmark*.svg`)
- Splash **mark** SVG geometry in `index.html` (old orange “i” mark kept; window/desktop icons use the new JPG-derived PNGs)
- `icon.icns` (macOS) not regenerated on this Linux box
- Vimrc filenames, deep plugin scheme comments, every code comment

## How to see

- UI / splash / welcome: Vite HMR may pick up TSX/CSS/`index.html`; hard-refresh the webview if splash still shows the old wordmark.
- **Window / taskbar `productName` and native icons require restarting `pnpm tauri dev`** (or rebuild) — `tauri.conf.json` and `src-tauri/icons/*` are not HMR’d.
- Binary path remains `target/debug/openidea` until `mainBinaryName` is renamed (deferred).

## Version
<<<<<<< Updated upstream

=======
>>>>>>> Stashed changes
- 2026-11-06: product version set to **0.1.0** (user: fork 重新起版), was upstream 0.1.37.
