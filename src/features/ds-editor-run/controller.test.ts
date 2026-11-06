import { describe, expect, it, vi } from "vitest";
import { EditorRunController } from "./controller";
import type { ConsoleRuntime, ConsoleTarget, EditorRunSource } from "./model";

const target = (consoleId: string, language: "python" | "r" = "python"): ConsoleTarget => ({
  consoleId,
  notebookId: null,
  language,
  selection: language === "r" ? "ark|/ark|/R" : "/python",
  generation: 0,
  busy: false,
  closing: false,
});
const runtime: ConsoleRuntime = { selection: "/python", language: "python", name: "Python" };

function setup(initial: ConsoleTarget[] = [target("a"), target("b"), target("r", "r")]) {
  const source: EditorRunSource = {
    path: "/p/a.py",
    language: "python",
    source: "print(42)",
    mode: "selection",
    startLine: 2,
    endLine: 2,
  };
  const state = { targets: initial };
  const deps = {
    capture: vi.fn(() => ({ ...source })),
    targets: vi.fn(async () => state.targets.map((t) => ({ ...t }))),
    discover: vi.fn(async () => [runtime]),
    action: vi.fn(async (id: string, _arg?: unknown) => {
      if (id === "ds.console.new") state.targets.push(target("created"));
    }),
    show: vi.fn(),
  };
  return { controller: new EditorRunController(deps), deps, state, source };
}

describe("Console routing without feature imports", () => {
  it("uses the last matching language, then remembers a specifically chosen Console", async () => {
    const { controller, deps, source } = setup();
    await controller.run("selection");
    expect(deps.action).toHaveBeenLastCalledWith("ds.console.execute", {
      id: "b",
      language: "python",
      source: "print(42)",
    });
    await controller.run("selection", true);
    await controller.choose(controller.usePicker.getState().targets[0]!);
    await controller.run("selection");
    expect(deps.action).toHaveBeenLastCalledWith("ds.console.execute", expect.objectContaining({ id: "a" }));
    source.language = "r";
    await controller.run("file");
    expect(deps.action).toHaveBeenLastCalledWith(
      "ds.console.execute",
      expect.objectContaining({ id: "r", language: "r" }),
    );
    expect(deps.show).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["missing", { consoleId: "gone" }, "changed or closed"],
    ["language", { consoleId: "r", language: "r", selection: "ark|/ark|/R" }, "language"],
    ["generation", { generation: 1 }, "changed or closed"],
    ["runtime", { selection: "/other" }, "changed or closed"],
  ])("rejects an explicit %s target without fallback", async (_name, patch, message) => {
    const { controller, deps } = setup();
    await expect(controller.run("selection", false, { ...target("a"), ...patch } as ConsoleTarget)).rejects.toThrow(
      message,
    );
    expect(deps.action).not.toHaveBeenCalled();
  });

  it.each(["busy", "closing"] as const)("rejects a %s target before execution", async (field) => {
    const t = { ...target("a"), [field]: true };
    const { controller, deps } = setup([t]);
    await expect(controller.run("file", false, t)).rejects.toThrow(field === "busy" ? "busy" : "closing");
    expect(deps.action).not.toHaveBeenCalled();
  });

  it("revalidates a picker target that closes or restarts before Run", async () => {
    const { controller, deps, state } = setup();
    await controller.run("file", true);
    const chosen = controller.usePicker.getState().targets[0]!;
    state.targets[0]!.generation++;
    await controller.choose(chosen);
    expect(controller.usePicker.getState().error).toContain("changed or closed");
    expect(deps.action).not.toHaveBeenCalled();
  });

  it("never runs in a different language or creates implicitly when missing", async () => {
    const { controller, deps } = setup([target("r", "r")]);
    await controller.run("selection");
    expect(controller.usePicker.getState()).toMatchObject({ targets: [], runtimes: [runtime] });
    expect(deps.action).not.toHaveBeenCalled();
    await controller.create(runtime);
    expect(deps.action.mock.calls).toEqual([
      ["ds.console.new", runtime],
      ["ds.console.select", "created"],
      ["ds.console.execute", { id: "created", language: "python", source: "print(42)" }],
    ]);
  });

  it("does not infer creation success from action dispatch", async () => {
    const { controller, deps } = setup([]);
    deps.action.mockImplementation(async () => {});
    await controller.run("file");
    await controller.create(runtime);
    expect(controller.usePicker.getState().error).toContain("Could not identify");
    expect(deps.action).toHaveBeenCalledExactlyOnceWith("ds.console.new", runtime);
  });

  it("keeps the captured source when the editor changes while choosing", async () => {
    const { controller, deps, source } = setup();
    await controller.run("file", true);
    source.source = "other buffer";
    await controller.choose(controller.usePicker.getState().targets[0]!);
    expect(deps.action).toHaveBeenLastCalledWith(
      "ds.console.execute",
      expect.objectContaining({ source: "print(42)" }),
    );
  });

  it.each(["reset", "dismiss"] as const)("cancels pending creation execution on %s", async (operation) => {
    const { controller, deps } = setup([]);
    await controller.run("file");
    let release!: () => void;
    deps.targets.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve([]);
        }),
    );
    const pending = controller.create(runtime);
    controller[operation]();
    release();
    await pending;
    expect(deps.action).not.toHaveBeenCalled();
    expect(controller.usePicker.getState().request).toBeNull();
  });

  it("ignores late discovery after dismissal", async () => {
    const { controller, deps } = setup([]);
    let resolve!: (values: ConsoleRuntime[]) => void;
    deps.discover.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = controller.run("selection");
    await vi.waitFor(() => expect(deps.discover).toHaveBeenCalled());
    controller.dismiss();
    resolve([runtime]);
    await pending;
    expect(controller.usePicker.getState().request).toBeNull();
  });

  it("routes cancel to the submitted Console while execution is pending", async () => {
    const { controller, deps, state } = setup();
    let finish!: () => void;
    deps.action.mockImplementation(async (id) => {
      if (id === "ds.console.execute") {
        state.targets[1]!.busy = true;
        await new Promise<void>((r) => {
          finish = r;
        });
      }
    });
    const pending = controller.run("selection");
    await vi.waitFor(() => expect(state.targets[1]!.busy).toBe(true));
    await controller.cancel();
    expect(deps.action).toHaveBeenLastCalledWith("ds.console.cancel", "b");
    finish();
    await pending;
    controller.reset();
    await expect(controller.cancel()).rejects.toThrow("No running");
  });
});
