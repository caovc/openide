# Shared Session adapter contract

This feature owns Session Variables and Plots presentation. Execution stays in
`KernelManager`: both notebook cells and the U7 in-memory Console documents use
that same manager. No feature imports another feature. Tool windows use existing
contribution points; their generated `toolwindow.ds-variables` and
`toolwindow.ds-plots` actions open them.

## Ownership and lifecycle

Each project incarnation registers its NotebookService and unique runtime
directory through `ide_host::ops::ds_session::notebook_service`. Every native
kernel generation creates its own SessionData (UUID, stop token, variables,
plots, pending requests). Lookups require **both** that runtime namespace and
the authorized document path. IPC additionally resolves the notebook/Console
incarnation id through the calling window's trusted project. An idle project
cannot read another window's running session of the same file. Registration is
weak and does not keep services alive.

Stop, selection change, close, process death and restart revoke the stop token;
old handles and in-flight inspection replies cannot update a new generation.
Restart creates empty variable and plot state. Variable revision is independent
of plot history. Expand requires `{documentId, generation, revision, path}` and
revalidates after the RPC; project replacement and trust revocation also reject
the result. The frontend separately guards pending refresh and expansion
responses across restart, source replacement and project reset.

The feature observes `notebookKernel` events (including U7 Console documents).
It polls immutable snapshots every 1.2 seconds without polling the interpreter
or executing code. It discovers a session on its next execution/lifecycle event;
after a webview reload, an already-idle session is rediscovered on its next
execution. Closing a document removes its source on the next poll; stopping a
kernel leaves a stopped entry without variable or image data.

## Language adapters

`ide_notebook::session_adapter::SessionAdapter` declares the language label,
variables comm target and optional bootstrap. Adding a runtime must explicitly
provide an adapter. There is no interpreter fallback. `SessionAdapter::sas()` is
a reserved entry that returns `unavailable`; it starts no process and supplies
no SAS implementation. Future SAS backends must implement the same snapshot,
child-path and lifecycle semantics without changing either panel.

- Python uses the selected **ipykernel**, with an app-owned, history-free,
  stdin-disabled bootstrap registering `openide.variables`. An isolated helper
  namespace holds the callback; user globals are not populated with adapter
  helpers. `post_run_cell` emits a full refresh after execution. Inspection
  resolves opaque keys through builtin dict/list/tuple values, without `eval`,
  arbitrary object `repr`, property access or recursive eager enumeration.
  Other object types show type/summary and are not expandable in U6.
- R uses Ark's public `positron.variables`: `refresh` replaces roots, `update`
  applies assigned/unevaluated/removed entries, `inspect` resolves access-key
  paths. JSON-RPC id equals the outgoing Jupyter message id. Ark replies are
  correlated by Jupyter parent header; Python replies also echo `data.id`.
- Normalized variables expose `key`, `name`, `typeName`, `summary`, and
  `hasChildren`. Paths are arrays of opaque access keys, never expression text.
  Requests are bounded to 32 path components and 10 seconds. Root and child
  responses show up to 200 entries, plus total length when supplied. Summaries
  and display names are bounded. This is the U6 inspector; table paging,
  arbitrary Python objects and dataframe exploration belong to U9.
- Jupyter `display_data`, `execute_result`, `update_display_data` and Ark public
  plot comm pre-renders normalize into image history. Supported MIME types are
  PNG, JPEG and SVG. Stable display ids update existing entries; evicted updates
  do not resurrect entries. History retains at most 50 images and 16 MiB per
  generation. Cell `clear_output` does not clear session history. SVG renders
  inside an `<img>` image document, never as workbench HTML. HTML widgets and
  interactive plot resizing/render RPCs are outside U6.

The shared transport observes comm events independently of execution parents,
including idle output, and consumes its owned variable/plot comms before the
general comm subscription bus. Existing LSP/DAP/custom comm subscribers do not
receive these private adapter events. No comm traffic enters cell output. Adapter
startup failure is surfaced in Variables without changing the selected runtime.

## Protocol provenance and localization

Read-only research: `/workspace/ark`, commit
`670a4946d8c3887e04591e4103b21fdba503afa3`, Ark 0.1.252, MIT license.
References: `crates/amalthea/src/comm/{variables_comm,plot_comm}.rs`,
`crates/amalthea/src/socket/{comm,shell,iopub}.rs`,
`crates/ark/src/variables/r_variables.rs`, and
`crates/ark/src/plots/graphics_device.rs`. This implementation independently
implements the public wire contract; it vendors no Ark or proprietary Positron
UI source and adds no third-party component or dependency.

Local English strings are intentionally contained in this feature because U6
does not own locale files. Catalog extraction and en/zh translations remain a
localization gap; accessible names and status/error messages already exist.
