import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { KernelDebugTarget } from "@/workbench/contributions";
import { commands } from "@/platform/ipc";
import { getAction, executeAction } from "@/platform/actions";
import { evaluateWhen } from "@/platform/context";
import { registerDebugActions } from "../actions";
import { useDebug, type DebugSession } from "../state";
import {
  activeKernelDebug,
  registerKernelTarget,
  kernelControl,
  kernelVariables,
  selectKernelFrame,
  selectScriptDebugTarget,
  useKernelDebug,
  resetKernelTargets,
  addKernelWatch,
} from "../kernel";

vi.mock("@/workbench/contributions", async (original) => ({
  ...(await original<typeof import("@/workbench/contributions")>()),
  toolWindowService: () => ({ show: vi.fn(), hide: vi.fn() }),
}));
const response = (body: unknown) => ({ success: true, body });
function target(token = "generation-one") {
  const request = vi.fn(async (command: string, _args: Record<string, unknown>): Promise<unknown> => {
    if (command === "threads") return response({ threads: [{ id: -1, name: "R" }] });
    if (command === "stackTrace")
      return response({
        stackFrames: [
          { id: 1, name: "add_one", line: 3, column: 1, source: { path: "/cell.R" } },
          { id: 2, name: "caller", line: 1, column: 1 },
        ],
      });
    if (command === "scopes")
      return response({
        scopes: [
          { name: "Locals", variablesReference: 4, expensive: false },
          { name: "Globals", variablesReference: 5, expensive: true },
        ],
      });
    if (command === "variables") return response({ variables: [{ name: "x", value: "41", variablesReference: 0 }] });
    if (command === "evaluate") return response({ result: "42", variablesReference: 0 });
    return response({});
  });
  const value: KernelDebugTarget = {
    identity: { kind: "kernel", documentId: "book", token },
    name: "book — R / actual",
    capabilities: {},
    request,
    disconnect: vi.fn(async () => {}),
    revealFrame: vi.fn(async () => {}),
  };
  return { value, request };
}
let disposeActions = () => {};
beforeEach(() => {
  resetKernelTargets();
  useDebug.setState({ sessions: {}, active: null });
  disposeActions = registerDebugActions();
});
afterEach(() => {
  disposeActions();
  resetKernelTargets();
  useDebug.setState({ sessions: {}, active: null });
  vi.restoreAllMocks();
});
async function pause(handle: ReturnType<typeof registerKernelTarget>, threadId: number | undefined = -1) {
  handle.event({ event: "stopped", body: threadId === undefined ? {} : { threadId } });
  await vi.waitFor(() => expect(activeKernelDebug()?.scopes).toHaveLength(2));
}
it("uses Ark signed thread ids, preserves scopes and passes raw coordinates to the notebook", async () => {
  const t = target();
  const handle = registerKernelTarget(t.value);
  await pause(handle);
  expect(t.request).toHaveBeenCalledWith("stackTrace", { threadId: -1, startFrame: 0, levels: 100 });
  expect(t.value.revealFrame).toHaveBeenCalledWith(
    expect.objectContaining({ line: 3, column: 1, source: { path: "/cell.R", sourceReference: undefined } }),
  );
  expect(activeKernelDebug()?.scopes.map((scope) => scope.name)).toEqual(["Locals", "Globals"]);
  await kernelControl("next");
  expect(t.request).toHaveBeenCalledWith("next", { threadId: -1 });
});
it("invalidates variable handles before a resume request completes", async () => {
  const t = target();
  const handle = registerKernelTarget(t.value);
  await pause(handle);
  const old = activeKernelDebug()!;
  let finish!: (body: unknown) => void;
  t.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const continuing = kernelControl("continue");
  expect(activeKernelDebug()?.status).toBe("running");
  expect(activeKernelDebug()?.frame).toBeNull();
  await expect(kernelVariables(old, 4)).rejects.toThrow();
  finish(response({}));
  await continuing;
});
it("drops old-generation events and pending frame results after disposal/replacement", async () => {
  const t = target();
  const handle = registerKernelTarget(t.value);
  let finish!: (body: unknown) => void;
  t.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  handle.event({ event: "stopped", body: { threadId: -1 } });
  handle.dispose();
  const fresh = target("generation-two");
  registerKernelTarget(fresh.value);
  finish(response({ stackFrames: [{ id: 9, name: "stale", line: 4 }] }));
  handle.event({ event: "stopped", body: { threadId: -1 } });
  await Promise.resolve();
  await Promise.resolve();
  expect(activeKernelDebug()?.target).toBe(fresh.value);
  expect(activeKernelDebug()?.frames).toEqual([]);
  expect(t.value.revealFrame).not.toHaveBeenCalled();
});
it("does not navigate a background kernel when a slow stack reply arrives", async () => {
  const t = target();
  const handle = registerKernelTarget(t.value);
  let finish!: (body: unknown) => void;
  t.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  handle.event({ event: "stopped", body: { threadId: -1 } });
  selectScriptDebugTarget(42);
  finish(response({ stackFrames: [{ id: 1, name: "late", line: 3, column: 1 }] }));
  await vi.waitFor(() => expect(t.request).toHaveBeenCalledWith("scopes", { frameId: 1 }));
  expect(t.value.revealFrame).not.toHaveBeenCalled();
});
it("rejects variables after the selected frame changes in the same pause", async () => {
  const t = target();
  const handle = registerKernelTarget(t.value);
  await pause(handle);
  const first = activeKernelDebug()!;
  let finish!: (body: unknown) => void;
  t.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const variables = kernelVariables(first, 4);
  await selectKernelFrame(first, 2);
  finish(response({ variables: [{ name: "stale", value: "old" }] }));
  await expect(variables).rejects.toThrow("stack frame changed");
});
it("binds watches to the selected frame and clears values on continue", async () => {
  const t = target();
  const handle = registerKernelTarget(t.value);
  await pause(handle);
  addKernelWatch("x + 1");
  await vi.waitFor(() => expect(activeKernelDebug()?.evaluations[0]?.value?.value).toBe("42"));
  expect(t.request).toHaveBeenCalledWith("evaluate", { expression: "x + 1", frameId: 1, context: "watch" });
  handle.event({ event: "continued" });
  expect(activeKernelDebug()?.evaluations).toEqual([]);
  expect(activeKernelDebug()?.watches).toEqual(["x + 1"]);
});
it("routes keyboard actions to the kernel and disables unsupported script actions", async () => {
  useDebug.setState({
    active: 42,
    sessions: {
      42: {
        id: 42,
        name: "Old script",
        status: "paused",
        parent: null,
        threads: [{ id: 7, name: "script" }],
        frames: [],
        selectedThread: 7,
        runConfig: null,
        launch: null,
        process: null,
        adapter: "debugpy",
      } as unknown as DebugSession,
    },
  });
  const native = vi.spyOn(commands, "debugStep");
  const nativeResume = vi.spyOn(commands, "debugResume");
  const t = target();
  const handle = registerKernelTarget(t.value);
  await pause(handle);
  for (const id of [
    "debug.runToCursor",
    "debug.forceStepOver",
    "debug.pause",
    "debug.rerun",
    "debug.resetFrame",
    "debug.quickEvaluate",
  ]) {
    const action = getAction(id)!;
    expect(evaluateWhen(action.when), id).toBe(false);
    await action.run({ ctx: {} });
  }
  await executeAction("debug.stepOver");
  expect(t.request).toHaveBeenCalledWith("next", { threadId: -1 });
  expect(native).not.toHaveBeenCalled();
  expect(nativeResume).not.toHaveBeenCalled();
});
it("disconnects only the selected kernel target without issuing native stop commands", async () => {
  const native = vi.spyOn(commands, "debugStop");
  const a = target("A");
  registerKernelTarget(a.value);
  const b = target("B");
  registerKernelTarget(b.value);
  await executeAction("debug.stop");
  await vi.waitFor(() => expect(b.value.disconnect).toHaveBeenCalledOnce());
  expect(a.value.disconnect).not.toHaveBeenCalled();
  expect(native).not.toHaveBeenCalled();
  expect(Object.values(useKernelDebug.getState().sessions).map((s) => s.target)).toEqual([a.value]);
});

it("refreshes a rejected step into a new pause and permits retry", async () => {
  const t = target();
  const handle = registerKernelTarget(t.value);
  await pause(handle);
  const previous = activeKernelDebug()!;
  t.request.mockResolvedValueOnce({ success: false, message: "Step rejected" });
  await kernelControl("next");
  expect(activeKernelDebug()).toMatchObject({ status: "paused", busy: false, error: "Step rejected", frame: 1 });
  expect(activeKernelDebug()!.epoch).toBeGreaterThan(previous.epoch);
  expect(activeKernelDebug()?.scopes).toHaveLength(2);
  await expect(kernelVariables(previous, 4)).rejects.toThrow();
  await kernelControl("next");
  expect(activeKernelDebug()).toMatchObject({ status: "running", busy: false, error: null });
});
it("marks transport failure unknown until a new event establishes kernel state", async () => {
  const t = target();
  const handle = registerKernelTarget(t.value);
  await pause(handle);
  t.request.mockRejectedValueOnce(new Error("Connection timed out"));
  await kernelControl("next");
  expect(activeKernelDebug()).toMatchObject({
    status: "unknown",
    busy: false,
    error: "Connection timed out",
    frames: [],
    frame: null,
  });
  t.request.mockClear();
  await kernelControl("next");
  addKernelWatch("x");
  expect(t.request).not.toHaveBeenCalled();
  expect(evaluateWhen(getAction("debug.stepOver")!.when)).toBe(false);
  await pause(handle);
  expect(activeKernelDebug()?.status).toBe("paused");
  t.request.mockRejectedValueOnce(new Error("Connection timed out"));
  await kernelControl("continue");
  await kernelControl("disconnect");
  expect(t.value.disconnect).toHaveBeenCalledOnce();
});
it("discards a watch response from a previous frame in the same pause", async () => {
  const t = target();
  const handle = registerKernelTarget(t.value);
  await pause(handle);
  let finish!: (body: unknown) => void;
  t.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  addKernelWatch("x + 1");
  await selectKernelFrame(activeKernelDebug()!, 2);
  await vi.waitFor(() => expect(activeKernelDebug()?.evaluations[0]?.value?.value).toBe("42"));
  finish(response({ result: "stale", variablesReference: 0 }));
  await Promise.resolve();
  await Promise.resolve();
  expect(activeKernelDebug()?.evaluations[0]?.value?.value).toBe("42");
});
