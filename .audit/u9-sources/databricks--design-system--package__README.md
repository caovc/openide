# dbui Design System

Component library for Databricks.

## Start a project with dbui

Run `npx @databricks/design-system` to create a Vite or Next.js project, or to add the design
system to an existing React project. The tool installs the package and required peers, configures
Emotion and global styles, and adds coding-agent guidance.

New projects include a floating theme picker for the original Du Bois theme (default), dbui Base,
Genie One, and a shadcn neutral approximation. All fonts and light/dark settings are included;
theme and appearance choices persist in the browser. For scripted runs, set the initial theme with
`--theme dubois`, `--theme base`, `--theme genie-one`, or `--theme shadcn`.

## Share a mockup (Databricks employees)

From a Vite project created above, run `npx @databricks/design-system share` to upload it to
[SP2K Design](https://sp2k-design-t0a-58b6-6051921418418893.staging.aws.databricksapps.com/studio/), Databricks'
internal mockup gallery, and get a review link to share:

```sh
npx @databricks/design-system share --project "Onboarding redesign" --artifact "Intent modal" --note "First pass"
```

Rerun with the same `--project` and `--artifact` to add a version; `--invite email[:role]` grants reviewers access.
It needs the Databricks CLI signed in to E2 dogfood
(`databricks auth login --host https://e2-dogfood.staging.cloud.databricks.com --profile e2-dogfood`). Run it with
`--help` for every option.

## Copy a page template

The package includes editable dbui page templates inspired by the shadcn/ui blocks gallery.
From a React project set up with dbui, run:

```sh
npx @databricks/design-system page-templates
npx @databricks/design-system add LandingPage
```

`add` copies the bundled source into `src/page-templates/` without replacing existing files.
Each template also installs `PageTemplateMain.tsx`, `workspace-shell.tsx`, and
`workspace-shell-top-bar.tsx`. Unchanged shared helpers are reused on subsequent installs.
The package includes 12 page layouts; run `page-templates` to list their PascalCase names.
Wire the copied template into your app and supply content through its slots. See
`docs/agents-npm/common/page-templates.md` for the catalog and usage guidance.

## Feature flags

Some dbui components switch between implementations based on a feature flag, such as
`databricks.fe.designsystem.useNativeButton`. By default, each flag uses the value this package
was published with. You can override flags by calling `setDesignSystemFlags` before your app
first renders:

```tsx
import { setDesignSystemFlags } from '@databricks/design-system/flags';

setDesignSystemFlags({
  'databricks.fe.designsystem.useNativeButton': false,
});

createRoot(document.getElementById('root')!).render(<App />);
```

Each call replaces the overrides from the previous call. dbui ignores an override whose type
doesn't match the flag, e.g. a number for a boolean flag.

Note that components read flags while they render and don't re-render when flags change, so
set flags before the first render.

## Using dbui with a coding agent

This package ships `AGENTS.md`, which links to its guidance on setup, component selection, theming,
accessibility, and the pitfalls to avoid. You can include `@node_modules/@databricks/design-system/AGENTS.md` in your project's agent
instructions.
The agent guidance also links to copyable page templates.
