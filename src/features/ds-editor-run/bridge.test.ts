import { afterEach, describe, expect, it, vi } from "vitest";
import { registerActions } from "@/platform/actions";
import { consoleAction, consoleTargets, discoverRuntimes } from "./bridge";
import { commands } from "@/platform/ipc";

const disposers: Array<() => void> = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.restoreAllMocks();
});

describe("U7 action callback bridge", () => {
  it("rejects missing actions and missing callback results", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(consoleTargets()).rejects.toThrow("action unavailable");
    disposers.push(registerActions([{ id: "ds.console.targets", title: "Console", run: () => {} }]));
    await expect(consoleTargets()).rejects.toThrow("targets unavailable");
  });

  it("does not treat the dispatch boolean as an execution result", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    disposers.push(
      registerActions([
        {
          id: "ds.console.execute",
          title: "Run",
          run: () => {
            throw new Error("kernel failure");
          },
        },
      ]),
    );
    expect(await consoleAction("ds.console.execute", { id: "a", language: "python", source: "42" })).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      "action ds.console.execute failed",
      expect.objectContaining({ message: "kernel failure" }),
    );
  });

  it("filters runtime discovery to explicit same-language selections", async () => {
    vi.spyOn(commands, "sdkDetect").mockResolvedValue({
      status: "ok",
      data: [
        { path: "/python", name: "Python", version: null, source: "system", home: null, extra: null },
        { path: "ark|/ark|/R", name: "Ark", version: null, source: "system", home: null, extra: null },
      ],
    });
    vi.spyOn(commands, "notebookDetectRuntimes").mockResolvedValue({
      status: "ok",
      data: [
        { id: "ark|/ark|/R", kind: "ark", name: "Ark", path: "/ark", home: "/R" },
        { id: "/python", kind: "python", name: "Python", path: "/python", home: null },
      ],
    });
    expect(await discoverRuntimes("python")).toEqual([{ selection: "/python", name: "Python", language: "python" }]);
    expect(await discoverRuntimes("r")).toEqual([{ selection: "ark|/ark|/R", name: "Ark", language: "r" }]);
  });
});
