import { describe, expect, it, vi } from "vitest";
import type { NotebookOutputEvent, NotebookSnapshot } from "@/bindings";
import type { ConsoleBackend } from "./backend";
import { ConsoleSession } from "./session";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export function fixture() {
  const snapshot = { id: "backend", path: "/project/virtual", version: 1, cells: [] } as unknown as NotebookSnapshot;
  let receive = (_e: NotebookOutputEvent) => {};
  const finish = deferred<NotebookSnapshot>();
  const backend = {
    open: vi.fn(async () => snapshot),
    get: vi.fn(async () => snapshot),
    insert: vi.fn(
      async (s) =>
        ({
          ...s,
          version: s.version + 1,
          cells: [...s.cells, { id: `cell-${s.version}`, outputs: [{ output_type: "stream", text: "42\n" }] }],
        }) as NotebookSnapshot,
    ),
    source: vi.fn(async (s) => ({ ...s, version: s.version + 1 })),
    execute: vi.fn((_s, _cell, _selection, _request, callback) => {
      receive = callback;
      return finish.promise;
    }),
    request: vi.fn(() => 7),
    cancel: vi.fn(async () => {}),
    interrupt: vi.fn(async () => null),
    stop: vi.fn(async () => null),
    close: vi.fn(async () => null),
    reply: vi.fn(async () => null),
    runtimes: vi.fn(async () => []),
  } satisfies ConsoleBackend;
  const session = new ConsoleSession(
    "console-a",
    { language: "python", name: "Python", selection: "/python" },
    backend,
  );
  const event = (kind: string, content: unknown, id = "backend") =>
    receive({ id, cell: "cell-1", kind, content } as NotebookOutputEvent);
  return { session, backend, snapshot, finish, event };
}
async function admitted(f: ReturnType<typeof fixture>) {
  const pending = f.session.execute("x = 41");
  await vi.waitFor(() => expect(f.backend.execute).toHaveBeenCalledOnce());
  return { pending };
}
describe("Console lifecycle (mock transport, not runtime proof)", () => {
  it("can restart before the first execute without leaving a lifecycle lock", async () => {
    const f = fixture();
    await f.session.restart();
    const { pending } = await admitted(f);
    f.finish.resolve(f.snapshot);
    await pending;
    expect(f.session.getState().generation).toBe(1);
  });
  it("recovers from failed startup by refreshing the document before another execute", async () => {
    const f = fixture();
    f.backend.open.mockRejectedValueOnce(new Error("startup failed"));
    await f.session.execute("1");
    expect(f.session.getState().error).toBe("startup failed");
    const { pending } = await admitted(f);
    f.finish.resolve(f.snapshot);
    await pending;
    expect(f.backend.open).toHaveBeenCalledTimes(2);
    expect(f.backend.get).toHaveBeenCalledWith("backend");
    expect(f.session.getState().error).toBeNull();
  });

  it("retains backend identity, source history and explicit selection", async () => {
    const f = fixture();
    const { pending } = await admitted(f);
    f.event("stream", { text: "42\n" });
    f.event("stream", { text: "wrong" }, "other");
    const current = f.backend.source.mock.results[0]!.value;
    f.finish.resolve(await current);
    await pending;
    await f.session.execute("x + 1");
    expect(f.backend.open).toHaveBeenCalledOnce();
    expect(f.backend.execute.mock.calls[0]![2]).toBe("/python");
    expect(f.session.getState().history).toEqual([
      { source: "x = 41", output: "42\n" },
      { source: "x + 1", output: "42\n" },
    ]);
    f.event("stream", { text: "late" });
    expect(f.session.getState().history[0]!.output).toBe("42\n");
  });
  it("closes an in-flight initial open without executing", async () => {
    const f = fixture();
    const open = deferred<NotebookSnapshot>();
    f.backend.open.mockReturnValue(open.promise);
    const executing = f.session.execute("1");
    const closing = f.session.close();
    open.resolve(f.snapshot);
    await Promise.all([executing, closing]);
    expect(f.backend.execute).not.toHaveBeenCalled();
    expect(f.backend.close).toHaveBeenCalledWith("backend");
    expect(f.session.getState().closed).toBe(true);
  });
  it("cancels during open and allows a later retry on the same session", async () => {
    const f = fixture();
    const open = deferred<NotebookSnapshot>();
    f.backend.open.mockReturnValue(open.promise);
    const pending = f.session.execute("1");
    const cancel = f.session.cancel();
    open.resolve(f.snapshot);
    await Promise.all([pending, cancel]);
    expect(f.backend.execute).not.toHaveBeenCalled();
    expect(f.session.getState().busy).toBe(false);
  });
  it("blocks duplicate execution and ignores cancelled input/output", async () => {
    const f = fixture();
    const { pending } = await admitted(f);
    await expect(f.session.execute("2")).rejects.toThrow("busy");
    const cancel = f.session.cancel();
    f.event("input_request", { requestId: "old", prompt: ">", password: false });
    f.event("stream", { text: "late" });
    f.finish.resolve(f.snapshot);
    await Promise.all([cancel, pending]);
    expect(f.backend.cancel).toHaveBeenCalledWith(7);
    expect(f.backend.interrupt).toHaveBeenCalledWith("backend");
    expect(f.session.getState().input).toBeNull();
    expect(f.session.getState().history[0]!.output).toBe("");
  });
  it("never adds password replies or input prompts to history and deduplicates replies", async () => {
    const f = fixture();
    const { pending } = await admitted(f);
    f.event("input_request", { requestId: "p", prompt: "Secret>", password: true });
    const reply = deferred<null>();
    f.backend.reply.mockReturnValue(reply.promise);
    const a = f.session.reply("secret");
    await f.session.reply("duplicate");
    reply.resolve(null);
    await a;
    expect(f.backend.reply).toHaveBeenCalledExactlyOnceWith("backend", "p", "secret");
    expect(JSON.stringify(f.session.getState().history)).not.toContain("secret");
    expect(f.session.getState().input).toBeNull();
    f.finish.resolve(f.snapshot);
    await pending;
  });
  it("retries failed close without losing the owned session", async () => {
    const f = fixture();
    const { pending } = await admitted(f);
    f.finish.resolve(f.snapshot);
    await pending;
    f.backend.close.mockRejectedValueOnce(new Error("cleanup failed"));
    await expect(f.session.close()).rejects.toThrow("cleanup failed");
    expect(f.session.getState().closed).toBe(false);
    await f.session.close();
    expect(f.session.getState().closed).toBe(true);
  });
  it("serializes restart with close and ignores old-generation output", async () => {
    const f = fixture();
    const { pending } = await admitted(f);
    f.finish.resolve(f.snapshot);
    await pending;
    const stopped = deferred<null>();
    f.backend.stop.mockReturnValue(stopped.promise);
    const restart = f.session.restart();
    const close = f.session.close();
    expect(f.backend.close).not.toHaveBeenCalled();
    stopped.resolve(null);
    await Promise.all([restart, close]);
    expect(f.session.getState().generation).toBe(1);
    expect(f.session.getState().closed).toBe(true);
    f.event("stream", { text: "stale" });
    expect(f.session.getState().history[0]!.output).toBe("");
  });
  it("isolates two sessions even when output delivery crosses identities", async () => {
    const a = fixture(),
      b = fixture();
    const pa = await admitted(a),
      pb = await admitted(b);
    a.event("stream", { text: "A" });
    b.event("stream", { text: "B" });
    a.finish.resolve(a.snapshot);
    b.finish.resolve(b.snapshot);
    await Promise.all([pa.pending, pb.pending]);
    await a.session.close();
    expect(b.session.getState().closed).toBe(false);
    expect(b.session.getState().history[0]!.output).toBe("B");
    expect(b.backend.close).not.toHaveBeenCalled();
  });
});
