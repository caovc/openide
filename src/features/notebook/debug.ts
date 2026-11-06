import { Channel } from "@tauri-apps/api/core";
import type { NotebookDebugEvent, NotebookKernelSession, RequestId } from "@/bindings";
import { call, commands, nextRequestId } from "@/platform/ipc";
import { editorService, registerKernelDebugTarget, type KernelDebugFrame } from "@/workbench/contributions";
import type { NotebookSession } from "./session";

export const notebookDebugBackend = {
  capabilities: (id: string, token: string) => call(commands.notebookDebugCapabilities(id, token)),
  request: (id: string, token: string, command: string, args: Record<string, unknown>, request: RequestId) =>
    call(commands.notebookDebugRequest(id, { token, command, arguments: args }, request)),
  events: (id: string, token: string, request: RequestId, channel: Channel<NotebookDebugEvent>) =>
    call(commands.notebookDebugEvents(id, token, request, channel)),
  cancel: (request: RequestId) => commands.cancelRequest(request),
  register: registerKernelDebugTarget,
  openNotebook: async (path: string) => {
    await editorService().openFile(path, { focus: false });
  },
};

type BreakpointStatus = { verified: boolean; line: number; id?: number; message?: string };
type Binding = { cell: string; source: string; revision: number; path: string; token: string };
export type NotebookDebugState = {
  status: "disconnected" | "connecting" | "connected" | "unavailable";
  message: string | null;
  breakpoints: ReadonlyMap<string, number>;
  breakpointStatus: ReadonlyMap<string, BreakpointStatus>;
  location: { cell: string; line: number; serial: number } | null;
};
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
export function debugBody(response: unknown): Record<string, unknown> {
  const data = object(response);
  if (data.success !== true)
    throw new Error(typeof data.message === "string" ? data.message : "The debugger rejected the request.");
  return object(data.body);
}
function sourceKey(path: string): string {
  // Compare actual file URIs with local paths, preserving case and decoding UTF-8 escapes.
  if (!path.startsWith("file:")) return path;
  try {
    const url = new URL(path);
    if (url.host && url.host !== "localhost") return `//${url.host}${decodeURIComponent(url.pathname)}`;
    const decoded = decodeURIComponent(url.pathname);
    return /^\/[A-Za-z]:\//.test(decoded) ? decoded.slice(1) : decoded;
  } catch {
    return path;
  }
}

/** Owns debugger lifetime independently of mounted notebook tabs. */
export class NotebookDebugger {
  private state: NotebookDebugState = {
    status: "disconnected",
    message: null,
    breakpoints: new Map(),
    breakpointStatus: new Map(),
    location: null,
  };
  private listeners = new Set<() => void>();
  private epoch = 0;
  private handle: NotebookKernelSession | null = null;
  private requests = new Set<RequestId>();
  private waiters = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  private target: ReturnType<typeof registerKernelDebugTarget> | null = null;
  private bindings: Binding[] = [];
  private cleanupRequired = false;
  private cleanupFailedToken: string | null = null;
  private cleanup: Promise<void> = Promise.resolve();
  private serial = 0;
  private navigationEpoch = 0;
  constructor(
    private session: NotebookSession,
    private backend = notebookDebugBackend,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getState = () => this.state;
  private publish(patch: Partial<NotebookDebugState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  setBreakpoint(cell: string, line: number | null) {
    const source = this.session.cells().find((item) => item.id === cell && item.cellType === "code")?.source;
    if (
      source === undefined ||
      (line !== null && (!Number.isInteger(line) || line < 1 || line > source.split("\n").length))
    )
      throw new Error("Choose a breakpoint line within this cell.");
    this.invalidate("Breakpoints changed. Connect the debugger again.");
    const breakpoints = new Map(this.state.breakpoints);
    if (line === null) breakpoints.delete(cell);
    else breakpoints.set(cell, line);
    this.publish({ breakpoints });
  }
  sourceChanged() {
    this.invalidate("Notebook source changed. Connect the debugger again.");
    this.publish({ breakpoints: new Map() });
  }
  kernelChanged() {
    if (this.handle) this.invalidate();
  }
  invalidate(message: string | null = null) {
    const hadSession = this.handle !== null || this.state.status === "connecting";
    const old = this.handle;
    const detach = this.cleanupRequired;
    ++this.epoch;
    ++this.navigationEpoch;
    this.handle = null;
    this.cleanupRequired = false;
    this.bindings = [];
    this.target?.dispose();
    this.target = null;
    for (const waiter of this.waiters.values()) waiter.reject(new Error("The notebook debug session changed."));
    this.waiters.clear();
    for (const request of this.requests) void this.backend.cancel(request).catch(() => {});
    this.requests.clear();
    this.publish({
      status: "disconnected",
      location: null,
      breakpointStatus: new Map(),
      message: hadSession ? message : null,
    });
    if (old && detach) {
      // Serialize detach before another handshake on this same kernel generation.
      this.cleanup = this.cleanup
        .then(async () => {
          const request = nextRequestId();
          const reply = await this.backend.request(
            old.id,
            old.token,
            "disconnect",
            { restart: false, terminateDebuggee: false },
            request,
          );
          if (reply.token !== old.token) throw new Error("The notebook debug session changed.");
          debugBody(reply.response);
        })
        .catch(() => {
          this.cleanupFailedToken = old.token;
          if (!this.handle)
            this.publish({
              status: "unavailable",
              message: "Debugger cleanup failed. Restart the kernel before reconnecting.",
            });
        });
    }
  }
  async disconnect() {
    this.invalidate();
    await this.cleanup;
  }
  private wait(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(name);
        reject(new Error("Timed out waiting for the notebook debugger."));
      }, 10_000);
      this.waiters.set(name, {
        resolve: () => {
          clearTimeout(timer);
          this.waiters.delete(name);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timer);
          this.waiters.delete(name);
          reject(error);
        },
      });
    });
  }
  private live(epoch: number, handle: NotebookKernelSession) {
    if (epoch !== this.epoch || this.handle?.token !== handle.token)
      throw new Error("The notebook debug session changed.");
  }
  async request(command: string, args: Record<string, unknown> = {}, validate = true): Promise<unknown> {
    const handle = this.handle;
    if (!handle) throw new Error("Connect the notebook debugger first.");
    const epoch = this.epoch;
    if (["continue", "next", "stepIn", "stepOut"].includes(command)) {
      ++this.navigationEpoch;
      this.publish({ location: null });
    }
    const request = nextRequestId();
    this.requests.add(request);
    try {
      const reply = await this.backend.request(handle.id, handle.token, command, args, request);
      this.live(epoch, handle);
      if (reply.token !== handle.token) throw new Error("The notebook debug session changed.");
      if (validate) debugBody(reply.response);
      return reply.response;
    } finally {
      this.requests.delete(request);
    }
  }
  async connect() {
    if (this.state.status === "connected") {
      this.target?.focus();
      return;
    }
    if (
      this.state.status === "connecting" ||
      this.session.getState().running ||
      this.session.getState().starting ||
      this.session.getState().frozen
    )
      throw new Error("Notebook is busy or closing.");
    const epoch = ++this.epoch;
    this.publish({ status: "connecting", message: null });
    try {
      await this.cleanup;
      if (epoch !== this.epoch) return;
      await this.session.flush();
      if (epoch !== this.epoch) return;
      await this.session.startKernel();
      if (epoch !== this.epoch) return;
      const handle = this.session.getState().kernelHandle;
      if (!handle) throw new Error("The notebook kernel is not ready.");
      if (this.cleanupFailedToken === handle.token)
        throw new Error("Debugger cleanup failed. Restart the kernel before reconnecting.");
      this.cleanupFailedToken = null;
      this.handle = handle;
      const capabilities = await this.backend.capabilities(handle.id, handle.token);
      this.live(epoch, handle);
      if (capabilities.token !== handle.token) throw new Error("The notebook debug session changed.");
      if (!capabilities.debugger) {
        this.handle = null;
        this.publish({ status: "unavailable", message: "This kernel does not advertise notebook debugging support." });
        return;
      }
      const ready = this.wait("ready");
      const channel = new Channel<NotebookDebugEvent>();
      let sequence = -1;
      channel.onmessage = (event) => {
        if (epoch !== this.epoch || event.token !== handle.token || event.sequence <= sequence) return;
        sequence = event.sequence;
        this.waiters.get(event.event)?.resolve();
        if (event.event === "breakpoint") this.breakpointEvent(event.body);
        if (["continued", "terminated", "stopped"].includes(event.event)) {
          ++this.navigationEpoch;
          this.publish({ location: null });
        }
        if (event.event !== "ready") this.target?.event({ event: event.event, body: event.body });
        if (event.event === "terminated") this.invalidate();
      };
      const events = nextRequestId();
      this.requests.add(events);
      void this.backend
        .events(handle.id, handle.token, events, channel)
        .then(() => {
          if (epoch === this.epoch) throw new Error("The notebook debug event stream closed.");
        })
        .catch((error: unknown) => {
          if (epoch === this.epoch) {
            this.invalidate();
            this.publish({ message: error instanceof Error ? error.message : String(error) });
          }
        })
        .finally(() => this.requests.delete(events));
      await ready;
      this.live(epoch, handle);
      const info = debugBody(await this.request("debugInfo"));
      // Ark 0.1.252 reports isStarted=true even before initialize; it is not an attachment signal.
      if (
        (handle.language === "python" && info.isStarted === true) ||
        (handle.language === "r" &&
          [info.breakpoints, info.stoppedThreads].some((value) => Array.isArray(value) && value.length > 0))
      )
        throw new Error(
          "This kernel already has a debugger. Disconnect it or restart the kernel before connecting here.",
        );
      const initialized = this.wait("initialized");
      // Attach may produce initialized while its reply waits for configurationDone.
      void initialized.catch(() => {});
      this.cleanupRequired = true;
      const initial = debugBody(
        await this.request("initialize", {
          clientID: "openide",
          adapterID: handle.language,
          pathFormat: "path",
          linesStartAt1: true,
          columnsStartAt1: true,
          supportsVariableType: true,
        }),
      );
      this.target = this.backend.register({
        identity: { kind: "kernel", documentId: handle.id, token: handle.token },
        name: `${this.session.path} · ${handle.selection}`,
        capabilities: initial,
        request: (command, args) => this.request(command, args, false),
        disconnect: () => this.disconnect(),
        revealFrame: (frame) => this.revealFrame(frame),
      });
      const attach = this.request("attach", { request: "attach", type: "notebook", justMyCode: true });
      void attach.catch(() => {});
      await initialized;
      this.live(epoch, handle);
      const revision = this.session.getState().snapshot!.version;
      const codeCells = this.session.cells().filter((cell) => cell.cellType === "code");
      const bytes = codeCells.reduce((total, cell) => total + new TextEncoder().encode(cell.source).byteLength, 0);
      if (bytes > 32 * 1024 * 1024) throw new Error("Notebook debug sources exceed the 32 MiB limit.");
      for (const cell of codeCells) {
        const dump = debugBody(await this.request("dumpCell", { code: cell.source }));
        if (typeof dump.sourcePath !== "string") throw new Error("The debugger did not return a cell source path.");
        this.bindings.push({
          cell: cell.id,
          source: cell.source,
          revision,
          path: dump.sourcePath,
          token: handle.token,
        });
      }
      for (const binding of this.bindings) {
        const sameSource = this.bindings.filter((item) => sourceKey(item.path) === sourceKey(binding.path));
        if (sameSource.length > 1 && sameSource.some((item) => this.state.breakpoints.has(item.cell)))
          throw new Error("Identical cell sources are ambiguous. Change the source before setting a breakpoint.");
      }
      for (const binding of this.bindings) {
        const line = this.state.breakpoints.get(binding.cell);
        const response = debugBody(
          await this.request("setBreakpoints", { source: { path: binding.path }, breakpoints: line ? [{ line }] : [] }),
        );
        if (line) {
          const breakpoint = Array.isArray(response.breakpoints) ? object(response.breakpoints[0]) : {};
          this.updateBreakpoint(binding.cell, breakpoint, line);
        }
      }
      await this.request("configurationDone");
      await attach;
      this.live(epoch, handle);
      this.publish({ status: "connected" });
      this.target.focus();
    } catch (error) {
      if (epoch === this.epoch) {
        this.invalidate();
        this.publish({ message: error instanceof Error ? error.message : String(error) });
      }
      throw error;
    }
  }
  private updateBreakpoint(cell: string, breakpoint: Record<string, unknown>, requested: number) {
    const statuses = new Map(this.state.breakpointStatus);
    statuses.set(cell, {
      verified: breakpoint.verified === true,
      line:
        typeof breakpoint.line === "number" && Number.isInteger(breakpoint.line) && breakpoint.line > 0
          ? breakpoint.line
          : requested,
      ...(typeof breakpoint.id === "number" ? { id: breakpoint.id } : {}),
      ...(typeof breakpoint.message === "string" ? { message: breakpoint.message } : {}),
    });
    this.publish({ breakpointStatus: statuses });
  }
  private breakpointEvent(body: unknown) {
    const breakpoint = object(object(body).breakpoint);
    for (const [cell, status] of this.state.breakpointStatus) {
      const binding = this.bindings.find((item) => item.cell === cell);
      const path = object(breakpoint.source).path;
      const matches =
        typeof breakpoint.id === "number"
          ? breakpoint.id === status.id
          : typeof path === "string" && binding && sourceKey(path) === sourceKey(binding.path);
      if (matches) this.updateBreakpoint(cell, { ...status, ...breakpoint }, status.line);
    }
  }
  async debugCell(cell: string) {
    if (this.state.status !== "connected") throw new Error("Connect the notebook debugger first.");
    const binding = this.bindings.find((item) => item.cell === cell);
    if (!binding || this.session.cells().find((item) => item.id === cell)?.source !== binding.source)
      throw new Error("Notebook source changed. Connect the debugger again.");
    this.target?.focus();
    await this.session.execute([cell]);
  }
  async revealFrame(frame: KernelDebugFrame) {
    const matches = this.bindings.filter(
      (binding) =>
        binding.token === this.handle?.token &&
        frame.source?.path &&
        sourceKey(binding.path) === sourceKey(frame.source.path),
    );
    if (matches.length > 1) throw new Error("Identical cell sources are ambiguous. The debugger cannot choose a cell.");
    const binding = matches[0];
    if (!binding) throw new Error("This debugger source is not mapped to a notebook cell.");
    if (this.session.cells().find((cell) => cell.id === binding.cell)?.source !== binding.source)
      throw new Error("Notebook source changed. Connect the debugger again.");
    if (!Number.isInteger(frame.line) || frame.line < 1 || frame.line > binding.source.split("\n").length)
      throw new Error("The debugger returned an invalid cell line.");
    const navigationEpoch = this.navigationEpoch;
    await this.backend.openNotebook(this.session.path);
    if (navigationEpoch !== this.navigationEpoch || binding.token !== this.handle?.token)
      throw new Error("The notebook debug session changed.");
    if (this.session.cells().find((cell) => cell.id === binding.cell)?.source !== binding.source)
      throw new Error("Notebook source changed. Connect the debugger again.");
    // Reveal only the validated line. No adapter-specific byte columns are guessed as UTF-16.
    this.publish({ location: { cell: binding.cell, line: frame.line - 1, serial: ++this.serial } });
  }
}
