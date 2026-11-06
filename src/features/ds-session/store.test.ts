import { describe, expect, it, vi } from "vitest";
import type { SessionSnapshot, SessionChildren } from "@/bindings";
import { SessionPanels, type SessionBackend } from "./store";

function snapshot(generation: string, name: string, revision = 1): SessionSnapshot {
  return {
    generation,
    path: `/${generation}.ipynb`,
    language: generation === "r" ? "R" : "python",
    revision,
    variables: [{ key: name, name, typeName: "list", summary: "1 item", hasChildren: true }],
    total: 1,
    plots: [{ id: generation, mime: "image/png", data: generation, executionId: generation }],
    ready: true,
    error: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup() {
  const backend: SessionBackend = { snapshot: vi.fn(async (id) => snapshot(id, id)), inspect: vi.fn() };
  return { backend, panels: new SessionPanels(backend) };
}

describe("shared session panels", () => {
  it("keeps R/Python and two same-language sessions separate and shares selection", async () => {
    const { panels } = setup();
    for (const id of ["r", "py1", "py2"]) panels.kernel({ id, path: `/${id}`, state: "idle" });
    await Promise.resolve();
    expect(panels.store.getState().sources.map((source) => source.snapshot?.variables[0]?.name)).toEqual([
      "r",
      "py1",
      "py2",
    ]);
    panels.select("py2");
    expect(panels.store.getState().selected).toBe("py2");
    panels.kernel({ id: "py1", path: "/py1", state: "starting" });
    expect(panels.store.getState().sources.find((source) => source.id === "py1")?.snapshot).toBeNull();
    expect(panels.store.getState().sources.find((source) => source.id === "r")?.snapshot?.plots[0]?.id).toBe("r");
  });

  it("discards a snapshot arriving after restart, project reset or path reopen", async () => {
    const { panels, backend } = setup();
    const old = deferred<SessionSnapshot>();
    vi.mocked(backend.snapshot).mockReturnValueOnce(old.promise);
    panels.kernel({ id: "old", path: "/same", state: "idle" });
    panels.kernel({ id: "old", path: "/same", state: "starting" });
    old.resolve(snapshot("old", "stale"));
    await Promise.resolve();
    expect(panels.store.getState().sources[0]?.snapshot).toBeNull();
    panels.kernel({ id: "new", path: "/same", state: "idle" });
    await Promise.resolve();
    expect(panels.store.getState().sources.map((source) => source.id)).toEqual(["new"]);
    const pending = deferred<SessionSnapshot>();
    vi.mocked(backend.snapshot).mockReturnValueOnce(pending.promise);
    const refresh = panels.refresh("new");
    panels.reset();
    pending.resolve(snapshot("new", "stale"));
    await refresh;
    expect(panels.store.getState()).toEqual({ sources: [], selected: null });
  });

  it("lazy inspection rejects old revisions and generations", async () => {
    const { panels, backend } = setup();
    panels.kernel({ id: "r", path: "/r", state: "idle" });
    await Promise.resolve();
    const pending = deferred<SessionChildren>();
    vi.mocked(backend.inspect).mockReturnValueOnce(pending.promise);
    const expand = panels.expand("r", ["root", "child"]);
    expect(backend.inspect).toHaveBeenCalledWith("r", "r", 1, ["root", "child"]);
    vi.mocked(backend.snapshot).mockResolvedValueOnce(snapshot("r", "changed", 2));
    await panels.refresh("r");
    pending.resolve({ generation: "r", revision: 1, variables: [], total: 0 });
    await expect(expand).rejects.toThrow("changed");
    vi.mocked(backend.inspect).mockResolvedValueOnce({ generation: "previous", revision: 2, variables: [], total: 0 });
    await expect(panels.expand("r", ["root"])).rejects.toThrow("changed");
  });

  it("discards expansion after stop and clears errors on recovery", async () => {
    const { panels, backend } = setup();
    panels.kernel({ id: "r", path: "/r", state: "idle" });
    await Promise.resolve();
    const pending = deferred<SessionChildren>();
    vi.mocked(backend.inspect).mockReturnValueOnce(pending.promise);
    const expand = panels.expand("r", ["root"]);
    panels.kernel({ id: "r", path: "/r", state: "dead" });
    pending.resolve({ generation: "r", revision: 1, variables: [], total: 0 });
    await expect(expand).rejects.toThrow("changed");
    expect(panels.store.getState().sources[0]?.snapshot).toBeNull();
    vi.mocked(backend.snapshot).mockRejectedValueOnce(new Error("adapter unavailable"));
    panels.kernel({ id: "r", path: "/r", state: "idle" });
    await Promise.resolve();
    expect(panels.store.getState().sources[0]?.error).toContain("adapter unavailable");
    await panels.refresh("r");
    expect(panels.store.getState().sources[0]?.error).toBeNull();
  });

  it("removes closed documents and does not let an old null poll hide a restarted session", async () => {
    const { panels, backend } = setup();
    const old = deferred<SessionSnapshot | null>();
    vi.mocked(backend.snapshot).mockReturnValueOnce(old.promise);
    panels.kernel({ id: "r", path: "/r", state: "idle" });
    panels.kernel({ id: "r", path: "/r", state: "idle" });
    await Promise.resolve();
    old.resolve(null);
    await Promise.resolve();
    expect(panels.store.getState().sources[0]?.snapshot?.generation).toBe("r");
    vi.mocked(backend.snapshot).mockRejectedValueOnce({ kind: "notFound" });
    await panels.refresh("r");
    expect(panels.store.getState()).toEqual({ sources: [], selected: null });
  });
});
