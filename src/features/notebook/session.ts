import { Channel } from "@tauri-apps/api/core";
import type { EditorState } from "@codemirror/state";
import type {
  NotebookSnapshot,
  NotebookKernelSession,
  NotebookEdit,
  NotebookOutputEvent,
  Sdk,
  RequestId,
  Pos,
  SessionFeature,
  SessionReply,
  NotebookLspQuery,
} from "@/bindings";
import { call, commands, IpcError, isTauri, nextRequestId, onIdeEvent } from "@/platform/ipc";
import { notifyEditorDocumentChanged } from "@/workbench/contributions";
import { OutputReducer } from "./outputs";
import { NotebookDebugger } from "./debug";

export const notebookBackend = {
  inputReply: (id: string, prompt: string, value: string | null) =>
    call(commands.notebookInputReply(id, prompt, value)),
  lsp: (id: string, query: NotebookLspQuery, request: RequestId) => call(commands.notebookLsp(id, query, request)),
  stopKernel: (id: string) => call(commands.notebookStopKernel(id)),
  startKernel: (id: string, selection: string, request: RequestId) =>
    call(commands.notebookStartKernel(id, selection, request)),
  open: (path: string) => call(commands.notebookOpen(path)),
  get: (id: string) => call(commands.notebookGet(id)),
  edit: (id: string, version: number, edit: NotebookEdit) => call(commands.notebookEdit(id, version, edit)),
  save: (id: string) => call(commands.notebookSave(id)),
  reload: (id: string) => call(commands.notebookReload(id)),
  undo: (id: string) => call(commands.notebookUndo(id)),
  redo: (id: string) => call(commands.notebookRedo(id)),
  close: (id: string) => call(commands.notebookClose(id)),
  interrupt: (id: string) => call(commands.notebookInterrupt(id)),
  restart: (id: string) => call(commands.notebookRestart(id)),
  execute: (
    id: string,
    cells: string[],
    python: string | null,
    request: RequestId,
    output: Channel<NotebookOutputEvent>,
  ) => call(commands.notebookExecute(id, cells, python, request, output)),
  environments: async (near: string | null) => {
    const [python, effective, ark] = await Promise.all([
      call(commands.sdkDetect("python")),
      call(commands.sdkPythonEffective(near)),
      call(commands.notebookDetectRuntimes()),
    ]);
    const arkAsSdk: Sdk[] = ark.map((runtime) => ({
      // Selection id is what notebook_execute expects (ark|…|… or python path).
      path: runtime.id,
      name: runtime.name,
      version: null,
      source: runtime.kind,
      home: runtime.home,
      extra: runtime.path,
    }));
    return [[...python, ...arkAsSdk], effective] as [Sdk[], string | null];
  },
  cancel: (request: RequestId) => commands.cancelRequest(request),
};

type Pending = { edit: NotebookEdit | { type: "undo" } | { type: "redo" }; committed: boolean };
type ErrorOwner = "load" | "mutation" | "save" | "execution" | "kernel" | "environment" | "reload" | "lsp" | "other";

const PYTHON_KEY = "openidea.notebook.python:";
function savedPython(path: string): string | null {
  try {
    return globalThis.localStorage?.getItem(PYTHON_KEY + path) || null;
  } catch {
    return null;
  }
}
export interface NotebookViewState {
  snapshot: NotebookSnapshot | null;
  loading: boolean;
  error: string | null;
  running: boolean;
  starting: boolean;
  kernelHandle: NotebookKernelSession | null;
  frozen: boolean;
  kernel: string;
  python: string | null;
  environments: Sdk[];
  pending: number;
  input: { requestId: string; prompt: string; password: boolean; cell: string } | null;
}

/** One session/queue per file; tabs and mounted React views do not own its lifetime. */
export class NotebookSession {
  private state: NotebookViewState = {
    snapshot: null,
    loading: false,
    error: null,
    running: false,
    starting: false,
    kernelHandle: null,
    frozen: false,
    kernel: "idle",
    python: null,
    environments: [],
    pending: 0,
    input: null,
  };
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;
  private pending: Pending[] = [];
  private pumping: Promise<void> | null = null;
  private blocked = false;
  private disposed = false;
  private authoritativeVersion = -1;
  private executionCancelled = false;
  private generation = 0;
  private execution: Promise<void> | null = null;
  private startup: Promise<void> | null = null;
  private startupCancelled = false;
  private kernelDeaths = 0;
  private request: RequestId | null = null;
  private refreshing: Promise<void> | null = null;
  private refreshAgain = false;
  private output = new OutputReducer();
  private stopEvents: (() => void) | null = null;
  private lspRequests = new Set<RequestId>();
  private lspEpoch = 0;
  private errors = new Map<ErrorOwner, { cause: unknown; message: string }>();
  // EditorState contains selection and syntax state, but deliberately no local history.
  readonly debugger = new NotebookDebugger(this);
  readonly editors = new Map<string, EditorState>();
  readonly markdownEditing = new Set<string>();
  selectedCell: string | null = null;
  scrollTop = 0;

  constructor(
    readonly path: string,
    private backend = notebookBackend,
    private desktop = isTauri(),
  ) {
    this.state = { ...this.state, python: savedPython(path) };
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getState = () => this.state;
  isDirty = () => this.pending.length > 0 || !!this.state.snapshot?.dirty;
  private publish(patch: Partial<NotebookViewState> = {}) {
    const error = [...this.errors.values()].at(-1)?.message ?? null;
    this.state = { ...this.state, ...patch, error, pending: this.pending.length };
    this.listeners.forEach((listener) => listener());
    notifyEditorDocumentChanged();
  }
  report(error: unknown) {
    this.reportOperation(error, "other");
  }
  private reportOperation(error: unknown, owner: ErrorOwner) {
    // UI promise catches and operations waiting on flush re-report the same
    // failure. Keep its original owner so only the real recovery clears it.
    if ([...this.errors.values()].some((entry) => entry.cause === error)) return;
    this.errors.delete(owner);
    this.errors.set(owner, { cause: error, message: error instanceof Error ? error.message : String(error) });
    this.publish();
  }
  private recover(...owners: ErrorOwner[]) {
    for (const owner of owners) this.errors.delete(owner);
    this.publish();
  }
  private accept(snapshot: NotebookSnapshot) {
    if (this.disposed) return;
    const current = this.state.snapshot;
    if (current && (current.id !== snapshot.id || snapshot.version < this.authoritativeVersion)) return;
    this.authoritativeVersion = snapshot.version;
    if (current && current.version > snapshot.version) {
      // Only Channel output reductions can be newer than the latest full
      // snapshot. Take acknowledged user fields/order, retain newer outputs.
      const outputCells = new Map(current.cells.map((cell) => [cell.id, cell]));
      snapshot = {
        ...snapshot,
        version: current.version,
        dirty: current.dirty,
        cells: snapshot.cells.map((cell) => {
          const newer = outputCells.get(cell.id);
          return newer && cell.cellType === "code"
            ? { ...cell, outputs: newer.outputs, executionCount: newer.executionCount }
            : cell;
        }),
      };
    }
    this.publish({ snapshot });
    const live = new Set(snapshot.cells.map((cell) => cell.id));
    for (const id of this.editors.keys()) if (!live.has(id)) this.editors.delete(id);
  }
  load(opened?: NotebookSnapshot): Promise<void> {
    if (this.loading) return this.loading;
    if (this.disposed) return Promise.reject(new Error("Notebook is closed"));
    this.publish({ loading: true });
    this.loading = (async () => {
      if (!this.desktop) throw new Error("Notebook editing and execution require the desktop app.");
      const snapshot = opened ?? (await this.backend.open(this.path));
      // Closing a still-loading tab must release the real backend document too.
      if (this.disposed) {
        await this.backend.close(snapshot.id);
        return;
      }
      this.accept(snapshot);
      this.recover("load");
      this.stopEvents = onIdeEvent("notebookKernel", (event) => {
        if (this.disposed || event.path !== snapshot.path || event.id !== snapshot.id) return;
        if (event.state === "dead") {
          this.executionCancelled = true;
          ++this.kernelDeaths;
        }
        if (event.state === "dead" || event.state === "starting") {
          this.debugger.kernelChanged();
          this.cancelLsp();
          this.publish({ input: null, kernelHandle: null });
        }
        this.publish({ kernel: event.state });
        if (event.message) this.reportOperation(event.message, "kernel");
      });
      void this.detectEnvironments();
    })()
      .catch((error) => {
        this.reportOperation(error, "load");
        this.loading = null;
        throw error;
      })
      .finally(() => this.publish({ loading: false }));
    return this.loading;
  }
  async detectEnvironments() {
    try {
      const [environments, effective] = await this.backend.environments(this.path);
      if (!this.disposed) {
        this.publish({ environments, python: this.state.python ?? effective });
        this.recover("environment");
      }
    } catch (error) {
      if (!this.disposed) this.reportOperation(error, "environment");
    }
  }
  selectPython(python: string) {
    if (this.state.running || this.state.starting || this.state.frozen) return;
    try {
      globalThis.localStorage?.setItem(PYTHON_KEY + this.path, python);
    } catch {
      /* Interpreter preference is optional when storage is unavailable. */
    }
    if (python === this.state.python) return;
    this.debugger.invalidate();
    this.cancelLsp();
    this.publish({ python, frozen: true, kernelHandle: null });
    const id = this.state.snapshot?.id;
    const generation = ++this.generation;
    void (async () => {
      try {
        await this.flush();
      } finally {
        if (id) await this.backend.stopKernel(id);
      }
    })()
      .then(() => this.recover("kernel", "lsp"))
      .catch((error) => this.reportOperation(error, "kernel"))
      .finally(() => {
        if (!this.disposed && generation === this.generation) this.publish({ frozen: false, kernel: "idle" });
      });
  }
  private cancelLsp() {
    this.lspEpoch++;
    for (const request of this.lspRequests) void this.backend.cancel(request);
    this.lspRequests.clear();
  }
  async queryLsp(
    cell: string,
    source: string,
    position: Pos,
    feature: SessionFeature,
    signal?: AbortSignal,
  ): Promise<SessionReply | null> {
    const selection = this.state.python;
    const id = this.state.snapshot?.id;
    if (this.disposed || this.state.frozen || !id || !selection?.startsWith("ark|") || signal?.aborted) return null;
    const epoch = this.lspEpoch;
    const request = nextRequestId();
    this.lspRequests.add(request);
    const abort = () => {
      void this.backend.cancel(request);
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const result = await this.backend.lsp(id, { selection, cell, source, position, feature }, request);
      if (this.disposed || epoch !== this.lspEpoch || signal?.aborted) return null;
      this.recover("lsp");
      return result;
    } catch (error) {
      if (!this.disposed && epoch === this.lspEpoch && !signal?.aborted) this.reportOperation(error, "lsp");
      return null;
    } finally {
      this.lspRequests.delete(request);
      signal?.removeEventListener("abort", abort);
    }
  }

  pendingSources() {
    const sources = new Map<string, string>();
    for (const { edit } of this.pending) if (edit.type === "setSource") sources.set(edit.cell, edit.source);
    return [...sources].map(([cell, source]) => ({ cell, source }));
  }

  /** Pending source is overlaid, never replaced by an older IPC response. */
  cells() {
    const cells = this.state.snapshot?.cells ?? [];
    return cells.map((cell) => {
      let source = cell.source;
      for (const item of this.pending)
        if (item.edit.type === "setSource" && item.edit.cell === cell.id) source = item.edit.source;
      return source === cell.source ? cell : { ...cell, source };
    });
  }
  edit(edit: NotebookEdit) {
    if (this.disposed || this.state.frozen || !this.state.snapshot) return;
    if ((this.state.running || this.state.starting) && edit.type !== "setSource") {
      this.reportOperation(new Error("Stop execution before changing notebook structure."), "mutation");
      return;
    }
    if (edit.type !== "setOutputs") this.debugger.sourceChanged();
    const last = this.pending.at(-1);
    // Never mutate an in-flight intent; only coalesce an unsent tail.
    if (
      edit.type === "setSource" &&
      last &&
      !last.committed &&
      last !== this.inflight &&
      last.edit.type === "setSource" &&
      last.edit.cell === edit.cell
    )
      last.edit = edit;
    else this.pending.push({ edit, committed: false });
    this.publish();
    if (!this.blocked) void this.pump().catch(() => {});
  }
  private inflight: Pending | null = null;
  private pump(): Promise<void> {
    if (this.pumping) return this.pumping;
    this.pumping = Promise.resolve()
      .then(async () => {
        while (this.pending.length && !this.disposed) {
          const item = this.pending[0]!;
          this.inflight = item;
          let snapshot = this.state.snapshot!;
          if (!item.committed) {
            try {
              const result =
                item.edit.type === "undo" || item.edit.type === "redo"
                  ? await this.backend[item.edit.type](snapshot.id)
                  : await this.backend.edit(snapshot.id, snapshot.version, item.edit);
              item.committed = true;
              this.accept(result);
            } catch (error) {
              if (
                !(error instanceof IpcError) ||
                error.kind !== "outOfSync" ||
                item.edit.type === "undo" ||
                item.edit.type === "redo"
              )
                throw error;
              snapshot = await this.backend.get(snapshot.id);
              this.accept(snapshot);
              // Semantic stable-id rebase, once. Missing/deleted targets remain pending
              // with an actionable backend error rather than silently dropping user intent.
              const result = await this.backend.edit(snapshot.id, snapshot.version, item.edit);
              item.committed = true;
              this.accept(result);
            }
          }
          this.pending.shift();
          this.recover("mutation");
        }
      })
      .catch((error) => {
        this.blocked = true;
        this.reportOperation(error, "mutation");
        throw error;
      })
      .finally(() => {
        this.inflight = null;
        this.pumping = null;
      });
    return this.pumping;
  }
  async flush() {
    await this.load();
    this.blocked = false;
    await this.pump();
    if (this.pending.length)
      throw new Error("Notebook edits have not been committed. Retry edits or discard explicitly.");
  }
  async save() {
    try {
      await this.flush();
      this.accept(await this.backend.save(this.state.snapshot!.id));
      this.recover("save");
    } catch (error) {
      this.reportOperation(error, "save");
      throw error;
    }
  }
  private async history(direction: "undo" | "redo") {
    if (this.state.running || this.state.starting || this.state.frozen)
      throw new Error("Stop execution before undo or redo.");
    if (!this.state.snapshot) await this.load();
    if (this.state.running || this.state.starting || this.state.frozen || this.disposed)
      throw new Error("Notebook is busy or closing.");
    this.debugger.sourceChanged();
    // History is a queue barrier: later typing must commit AFTER undo/redo, not
    // race it and get overwritten by the history response.
    this.pending.push({ edit: { type: direction }, committed: false });
    this.publish();
    this.blocked = false;
    await this.pump();
  }
  undo = () => this.history("undo");
  redo = () => this.history("redo");

  private refresh(): Promise<void> {
    this.refreshAgain = true;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      while (this.refreshAgain && !this.disposed) {
        this.refreshAgain = false;
        const id = this.state.snapshot!.id;
        this.accept(await this.backend.get(id));
      }
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }
  startKernel(): Promise<void> {
    if (this.state.running || this.state.starting || this.state.frozen || this.disposed)
      return Promise.reject(new Error("Notebook is busy or closing."));
    const selection = this.state.python;
    if (!selection) return Promise.reject(new Error("Select a notebook kernel before starting."));
    this.startupCancelled = false;
    const generation = ++this.generation;
    let request: RequestId | null = null;
    const kernelDeaths = this.kernelDeaths;
    this.publish({ starting: true, kernelHandle: null });
    this.startup = (async () => {
      await this.load();
      if (this.state.frozen || this.disposed || this.startupCancelled || generation !== this.generation) return;
      const id = this.state.snapshot!.id;
      request = nextRequestId();
      this.request = request;
      const handle = await this.backend.startKernel(id, selection, request);
      if (
        this.disposed ||
        this.startupCancelled ||
        generation !== this.generation ||
        kernelDeaths !== this.kernelDeaths
      )
        return;
      if (handle.id !== id || handle.selection !== selection)
        throw new Error("The kernel session does not match this notebook.");
      // Kernel events remain authoritative: acquiring an existing session can
      // return while another client is executing on it.
      this.publish({ kernelHandle: handle });
      this.recover("kernel");
    })()
      .catch((error) => {
        if (!this.startupCancelled && !this.disposed && generation === this.generation) {
          this.reportOperation(error, "kernel");
          throw error;
        }
      })
      .finally(() => {
        if (this.request === request) this.request = null;
        this.startup = null;
        this.publish({ starting: false });
      });
    return this.startup;
  }
  execute(cells?: string[]): Promise<void> {
    if (this.debugger.getState().status === "connecting")
      return Promise.reject(new Error("Notebook is busy or closing."));
    if (this.state.running || this.state.starting || this.state.frozen || this.disposed)
      return Promise.reject(new Error("Notebook is busy or closing."));
    this.publish({ running: true });
    this.executionCancelled = false;
    const generation = ++this.generation;
    this.output.reset();
    this.execution = (async () => {
      await this.flush();
      if (this.state.frozen || this.executionCancelled || generation !== this.generation) return;
      const snapshot = this.state.snapshot!;
      const ids = cells ?? snapshot.cells.filter((cell) => cell.cellType === "code").map((cell) => cell.id);
      if (!ids.length) return;
      const request = nextRequestId();
      this.request = request;
      const channel = new Channel<NotebookOutputEvent>();
      let buffered: NotebookOutputEvent[] = [];
      let frame: number | null = null;
      let overflow = false;
      channel.onmessage = (event) => {
        if (this.disposed || generation !== this.generation || event.id !== snapshot.id) return;
        if (event.kind === "input_request") {
          if (this.executionCancelled) return;
          const content = event.content;
          if (
            typeof content !== "object" ||
            content === null ||
            !("requestId" in content) ||
            typeof content.requestId !== "string" ||
            !("prompt" in content) ||
            typeof content.prompt !== "string" ||
            !("password" in content) ||
            typeof content.password !== "boolean"
          ) {
            this.reportOperation(new Error("Invalid kernel input request"), "execution");
            void this.interrupt().catch((error) => this.reportOperation(error, "kernel"));
            return;
          }
          this.publish({
            input: {
              requestId: content.requestId,
              prompt: content.prompt,
              password: content.password,
              cell: event.cell,
            },
          });
          return;
        }
        // Bound retained Channel work. A flood recovers from backend state instead
        // of retaining an unbounded browser queue or losing authoritative output.
        if (buffered.length < 256 && !overflow) buffered.push(event);
        else {
          overflow = true;
          buffered = [];
          this.output.recover();
        }
        if (frame !== null) return;
        frame = requestAnimationFrame(() => {
          frame = null;
          if (this.disposed || generation !== this.generation) {
            buffered = [];
            return;
          }
          let current = this.state.snapshot!;
          let refresh = overflow;
          overflow = false;
          for (const item of buffered) {
            const result = this.output.reduce(current, item);
            current = result.snapshot;
            refresh ||= result.refresh;
          }
          buffered = [];
          if (current !== this.state.snapshot) this.publish({ snapshot: current });
          if (refresh) void this.refresh().catch((error) => this.reportOperation(error, "execution"));
        });
      };
      try {
        const result = await this.backend.execute(snapshot.id, ids, this.state.python, request, channel);
        if (generation === this.generation) this.accept(result);
      } finally {
        if (generation === this.generation && !this.disposed) await this.refresh();
      }
      if (generation === this.generation && !this.executionCancelled) this.recover("execution", "kernel");
    })()
      .catch((error) => {
        this.reportOperation(error, "execution");
        throw error;
      })
      .finally(() => {
        this.request = null;
        this.execution = null;
        this.publish({ running: false, input: null });
      });
    return this.execution;
  }
  async replyInput(value: string | null) {
    const input = this.state.input;
    const id = this.state.snapshot?.id;
    if (!input || !id || this.disposed || this.state.frozen) return;
    if (value === null) this.executionCancelled = true;
    await this.backend.inputReply(id, input.requestId, value);
    if (this.state.input === input) this.publish({ input: null });
  }
  async interrupt() {
    if (this.debugger.getState().status === "connecting") {
      const detaching = this.debugger.disconnect();
      // Connect may still own a B0 startup request, before any debugger request exists.
      if (this.startup) {
        this.startupCancelled = true;
        if (this.request !== null) await this.backend.cancel(this.request);
      }
      await detaching;
      return;
    }
    if (this.startup) {
      this.startupCancelled = true;
      // The request owns only a newly launched kernel. Interrupting by notebook
      // id here could interrupt another client's work on an existing session.
      if (this.request !== null) await this.backend.cancel(this.request);
      return;
    }
    this.executionCancelled = true;
    this.publish({ input: null });
    if (!this.state.snapshot) return;
    // Batch cancellation precedes interrupt in the host; cancelRequest is an
    // additional route for requests still waiting on kernel admission/startup.
    try {
      if (this.request !== null) await this.backend.cancel(this.request);
    } finally {
      await this.backend.interrupt(this.state.snapshot.id);
    }
  }
  private async drain() {
    const work = this.startup ?? this.execution;
    if (!work) return;
    try {
      await this.interrupt();
    } finally {
      await work.catch(() => {});
    }
  }
  async restart() {
    this.debugger.invalidate();
    this.cancelLsp();
    if (this.state.frozen) throw new Error("Notebook is closing.");
    this.publish({ frozen: true, kernelHandle: null });
    ++this.generation;
    try {
      await this.drain();
      await this.flush();
      this.output.reset();
      this.accept(await this.backend.restart(this.state.snapshot!.id));
      this.publish({ kernel: "idle" });
      this.recover("execution", "kernel");
    } catch (error) {
      this.reportOperation(error, "kernel");
      throw error;
    } finally {
      this.publish({ frozen: false });
    }
  }
  async prepareClose() {
    this.debugger.invalidate();
    this.cancelLsp();
    this.publish({ frozen: true });
    if (this.loading) await this.loading.catch(() => {});
    // An invalid/unavailable file never acquired a backend document.
    if (!this.state.snapshot) return;
    try {
      await this.flush();
    } finally {
      await this.drain();
    }
  }
  cancelClose() {
    if (!this.disposed) this.publish({ frozen: false });
  }
  async discard() {
    this.debugger.invalidate();
    this.cancelLsp();
    this.publish({ frozen: true, kernelHandle: null });
    ++this.generation;
    try {
      await this.drain();
      if (this.pumping) await this.pumping.catch(() => {});
      const snapshot = this.state.snapshot;
      if (!snapshot) return;
      const reloaded = await this.backend.reload(snapshot.id);
      this.pending = [];
      this.blocked = false;
      this.editors.clear();
      this.output.reset();
      this.accept(reloaded);
      this.recover("mutation", "save", "reload");
    } catch (error) {
      this.reportOperation(error, "reload");
      throw error;
    }
  }
  async close() {
    this.debugger.invalidate();
    this.cancelLsp();
    this.publish({ frozen: true, kernelHandle: null });
    ++this.generation;
    try {
      // The host close interrupts, drains and shuts down authoritatively, and a
      // retired project already rejects interrupt. Never let that skip release.
      await this.drain().catch(() => {});
      if (this.pumping) await this.pumping.catch(() => {});
      if (this.loading) await this.loading.catch(() => {});
      const snapshot = this.state.snapshot;
      if (snapshot) await this.backend.close(snapshot.id);
    } finally {
      this.disposed = true;
      this.stopEvents?.();
      this.editors.clear();
      this.listeners.clear();
    }
  }
}

const sessions = new Map<string, NotebookSession>();
export function notebookSession(path: string): NotebookSession {
  let session = sessions.get(path);
  if (!session) {
    session = new NotebookSession(path);
    sessions.set(path, session);
  }
  return session;
}
export function existingNotebookSession(path: string) {
  return sessions.get(path);
}
export async function closeNotebook(path: string) {
  const session = sessions.get(path);
  if (!session) return;
  try {
    await session.close();
  } finally {
    if (sessions.get(path) === session) sessions.delete(path);
  }
}
