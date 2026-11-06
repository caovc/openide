import { describe, expect, it, vi } from "vitest";
import type * as TauriCore from "@tauri-apps/api/core";
import type { NotebookDebugEvent, NotebookKernelSession } from "@/bindings";
import type { KernelDebugTarget } from "@/workbench/contributions";
import { NotebookDebugger, notebookDebugBackend } from "./debug";
import type { NotebookSession } from "./session";

vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<typeof TauriCore>()),
  Channel: class {
    onmessage = (_event: unknown) => {};
  },
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function model(
  options: { supported?: boolean; language?: string; info?: unknown; duplicate?: boolean; manualReady?: boolean } = {},
) {
  const handle: NotebookKernelSession = {
    id: "doc",
    token: "generation-1",
    selection: "/selected/python",
    language: options.language ?? "python",
  };
  let cells = [
    { id: "definition", cellType: "code", source: "def add_one():\n    x = 41\n    x = x + 1\n    return x" },
    {
      id: "call",
      cellType: "code",
      source: options.duplicate ? "def add_one():\n    x = 41\n    x = x + 1\n    return x" : "add_one()",
    },
  ];
  const state = { snapshot: { version: 4 }, kernelHandle: handle, running: false, starting: false, frozen: false };
  const session = {
    path: "/science/a.ipynb",
    cells: () => cells,
    getState: () => state,
    flush: vi.fn(async () => {}),
    startKernel: vi.fn(async () => {}),
    execute: vi.fn(async () => {}),
  };
  const attached = deferred<void>();
  const subscription = deferred<null>();
  let onEvent = (_event: NotebookDebugEvent) => {};
  let sequence = 0;
  let target: KernelDebugTarget | null = null;
  const registration = { event: vi.fn(), focus: vi.fn(), dispose: vi.fn() };
  const emit = (event: string, body: unknown = {}, token = handle.token, seq = ++sequence) =>
    onEvent({ token, sequence: seq, event, body });
  const backend: typeof notebookDebugBackend = {
    openNotebook: vi.fn(async () => {}),
    capabilities: vi.fn(async () => ({ token: handle.token, debugger: options.supported ?? true, kernelInfo: {} })),
    cancel: vi.fn(async () => {
      subscription.resolve(null);
    }),
    register: vi.fn((value) => {
      target = value;
      return registration;
    }),
    events: vi.fn((_id, _token, _request, channel) => {
      onEvent = channel.onmessage;
      if (!options.manualReady) emit("ready", {}, handle.token, 0);
      return subscription.promise;
    }),
    request: vi.fn(async (_id, token, command, args) => {
      let body: unknown = {};
      if (command === "debugInfo") body = options.info ?? { isStarted: false, breakpoints: [], stoppedThreads: [] };
      if (command === "initialize") {
        emit("initialized");
        body = { supportsConfigurationDoneRequest: true };
      }
      if (command === "attach") await attached.promise;
      if (command === "configurationDone") attached.resolve();
      if (command === "dumpCell")
        body = { sourcePath: args.code === cells[0]!.source ? "/tmp/cell space.py" : "/tmp/call.py" };
      return { token, response: { success: true, command, body } };
    }),
  };
  const debug = new NotebookDebugger(session as unknown as NotebookSession, backend);
  return {
    debug,
    backend,
    session,
    registration,
    state,
    handle,
    emit,
    target: () => target!,
    edit: () => {
      cells = cells.map((cell) => ({ ...cell, source: `${cell.source}\n# edited` }));
    },
  };
}

describe("notebook debugger lifecycle", () => {
  it("waits for subscription ready, initializes once, and connects without executing source", async () => {
    const m = model({ manualReady: true });
    m.debug.setBreakpoint("definition", 3);
    const connecting = m.debug.connect();
    await vi.waitFor(() => expect(m.backend.events).toHaveBeenCalled());
    expect(m.backend.request).not.toHaveBeenCalled();
    m.emit("ready", {}, m.handle.token, 0);
    await connecting;
    expect(m.session.flush).toHaveBeenCalledOnce();
    expect(m.session.execute).not.toHaveBeenCalled();
    const commands = vi.mocked(m.backend.request).mock.calls.map((call) => call[2]);
    expect(commands).toEqual([
      "debugInfo",
      "initialize",
      "attach",
      "dumpCell",
      "dumpCell",
      "setBreakpoints",
      "setBreakpoints",
      "configurationDone",
    ]);
    expect(vi.mocked(m.backend.request).mock.calls.find((call) => call[2] === "setBreakpoints")?.[3]).toEqual({
      source: { path: "/tmp/cell space.py" },
      breakpoints: [{ line: 3 }],
    });
    await m.debug.connect();
    expect(m.backend.register).toHaveBeenCalledOnce();
    await m.debug.debugCell("call");
    expect(m.session.execute).toHaveBeenCalledExactlyOnceWith(["call"]);
    await m.debug.disconnect();
  });

  it("reports unsupported kernels without initializing a fabricated debugger", async () => {
    const m = model({ supported: false });
    await m.debug.connect();
    expect(m.debug.getState().status).toBe("unavailable");
    expect(m.debug.getState().message).toContain("does not advertise");
    expect(m.backend.events).not.toHaveBeenCalled();
    expect(m.backend.request).not.toHaveBeenCalled();
    await expect(m.debug.debugCell("call")).rejects.toThrow("Connect");
  });

  it.each([
    { language: "python", info: { isStarted: true } },
    { language: "r", info: { isStarted: true, breakpoints: [{}] } },
    { language: "r", info: { isStarted: true, stoppedThreads: [-1] } },
  ])("refuses unknown active debugger state: $language $info", async (options) => {
    const m = model(options);
    await expect(m.debug.connect()).rejects.toThrow("already has a debugger");
    expect(vi.mocked(m.backend.request).mock.calls.map((call) => call[2])).toEqual(["debugInfo"]);
    expect(m.backend.register).not.toHaveBeenCalled();
  });

  it("allows a fresh Ark whose isStarted field is unconditionally true", async () => {
    const m = model({ language: "r", info: { isStarted: true, breakpoints: [], stoppedThreads: [] } });
    await m.debug.connect();
    expect(m.debug.getState().status).toBe("connected");
    await m.debug.disconnect();
  });

  it("reveals decoded runtime paths at one converted line, and refuses edited source", async () => {
    const m = model();
    await m.debug.connect();
    const frame = { id: 4, name: "add_one", source: { path: "file:///tmp/cell%20space.py" }, line: 3, column: 1 };
    await m.target().revealFrame(frame);
    expect(m.debug.getState().location).toMatchObject({ cell: "definition", line: 2 });
    m.edit();
    await expect(m.target().revealFrame(frame)).rejects.toThrow("source changed");
    m.debug.sourceChanged();
    expect(m.debug.getState().location).toBeNull();
    expect(m.debug.getState().breakpoints.size).toBe(0);
    expect(m.registration.dispose).toHaveBeenCalledOnce();
    await m.debug.disconnect();
  });

  it("refuses ambiguous duplicate source breakpoints before writing any breakpoint", async () => {
    const m = model({ duplicate: true });
    m.debug.setBreakpoint("definition", 3);
    await expect(m.debug.connect()).rejects.toThrow("ambiguous");
    expect(vi.mocked(m.backend.request).mock.calls.some((call) => call[2] === "setBreakpoints")).toBe(false);
    await m.debug.disconnect();
  });

  it("retains duplicate candidates and refuses to guess a frame cell", async () => {
    const m = model({ duplicate: true });
    await m.debug.connect();
    await expect(
      m.target().revealFrame({ id: 1, name: "f", source: { path: "/tmp/cell space.py" }, line: 3, column: 1 }),
    ).rejects.toThrow("ambiguous");
    expect(m.debug.getState().location).toBeNull();
    await m.debug.disconnect();
  });

  it("drops wrong-token, out-of-order and post-disposal debug events", async () => {
    const m = model();
    await m.debug.connect();
    m.registration.event.mockClear();
    m.emit("stopped", { threadId: 1 }, m.handle.token, 20);
    m.emit("stopped", { threadId: 2 }, m.handle.token, 19);
    m.emit("stopped", { threadId: 3 }, "old-token", 21);
    expect(m.registration.event).toHaveBeenCalledExactlyOnceWith({ event: "stopped", body: { threadId: 1 } });
    await m.debug.disconnect();
    m.emit("stopped", { threadId: 4 }, m.handle.token, 22);
    expect(m.registration.event).toHaveBeenCalledOnce();
    expect(m.debug.getState().status).toBe("disconnected");
    expect(m.session.execute).not.toHaveBeenCalled();
  });

  it("cancels a handshake waiting for ready without sending initialize", async () => {
    const m = model({ manualReady: true });
    const connecting = m.debug.connect();
    await vi.waitFor(() => expect(m.backend.events).toHaveBeenCalled());
    m.debug.invalidate();
    await expect(connecting).rejects.toThrow("session changed");
    expect(m.backend.cancel).toHaveBeenCalled();
    expect(m.backend.request).not.toHaveBeenCalled();
    m.emit("ready", {}, m.handle.token, 0);
    expect(m.backend.register).not.toHaveBeenCalled();
  });
});

it("detaches even when initialize was cancelled before its acknowledgement", async () => {
  const m = model();
  const original = m.backend.request;
  const delayed = deferred<void>();
  m.backend.request = vi.fn<typeof notebookDebugBackend.request>(async (...args) => {
    const reply = await original(...args);
    if (args[2] === "initialize") await delayed.promise;
    return reply;
  });
  const connecting = m.debug.connect();
  await vi.waitFor(() =>
    expect(vi.mocked(m.backend.request).mock.calls.some((call) => call[2] === "initialize")).toBe(true),
  );
  await m.debug.disconnect();
  expect(vi.mocked(m.backend.request).mock.calls.some((call) => call[2] === "disconnect")).toBe(true);
  delayed.resolve();
  await expect(connecting).rejects.toThrow("session changed");
  expect(m.backend.register).not.toHaveBeenCalled();
});

it("requires a new kernel generation after failed detach", async () => {
  const m = model();
  const original = m.backend.request;
  m.backend.request = vi.fn<typeof notebookDebugBackend.request>(async (...args) => {
    if (args[2] === "disconnect") throw new Error("transport lost during detach");
    return original(...args);
  });
  await m.debug.connect();
  await m.debug.disconnect();
  await expect(m.debug.connect()).rejects.toThrow("Restart the kernel");
  expect(m.backend.register).toHaveBeenCalledOnce();
  expect(m.debug.getState().message).toContain("Restart the kernel");
});

it("tracks a pending breakpoint becoming verified at its resolved line", async () => {
  const m = model();
  const original = m.backend.request;
  m.backend.request = vi.fn<typeof notebookDebugBackend.request>(async (...args) => {
    const reply = await original(...args);
    if (args[2] === "setBreakpoints")
      return {
        ...reply,
        response: {
          success: true,
          body: { breakpoints: [{ id: 7, verified: false, line: 3, message: "Awaiting definition" }] },
        },
      };
    return reply;
  });
  m.debug.setBreakpoint("definition", 3);
  await m.debug.connect();
  expect(m.debug.getState().breakpointStatus.get("definition")).toMatchObject({ verified: false, line: 3, id: 7 });
  m.emit("breakpoint", { reason: "changed", breakpoint: { id: 7, verified: true, line: 4 } });
  expect(m.debug.getState().breakpointStatus.get("definition")).toMatchObject({ verified: true, line: 4 });
  await m.debug.disconnect();
});

it("preserves rejected DAP responses for the shared adapter to classify", async () => {
  const m = model();
  const original = m.backend.request;
  m.backend.request = vi.fn<typeof notebookDebugBackend.request>(async (...args) => {
    if (args[2] === "next")
      return {
        token: m.handle.token,
        response: { success: false, command: "next", message: "Cannot step this thread" },
      };
    return original(...args);
  });
  await m.debug.connect();
  expect(await m.target().request("next", { threadId: 1 })).toEqual({
    success: false,
    command: "next",
    message: "Cannot step this thread",
  });
  await m.debug.disconnect();
});

it("opens the mapped notebook and rejects navigation completed after resume", async () => {
  const m = model();
  await m.debug.connect();
  const open = deferred<void>();
  m.backend.openNotebook = vi.fn(() => open.promise);
  const reveal = m
    .target()
    .revealFrame({ id: 1, name: "f", source: { path: "/tmp/cell space.py" }, line: 3, column: 1 });
  expect(m.backend.openNotebook).toHaveBeenCalledExactlyOnceWith(m.session.path);
  await m.target().request("continue", { threadId: 1 });
  open.resolve();
  await expect(reveal).rejects.toThrow("session changed");
  expect(m.debug.getState().location).toBeNull();
  await m.debug.disconnect();
});
