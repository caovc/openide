import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotebookOutputEvent, NotebookSnapshot } from "@/bindings";
import { executeAction } from "@/platform/actions";
import { setContext } from "@/platform/context";
import { consoleBackend } from "./backend";
import { ConsoleView } from "./ConsoleView";
import { activate } from "./index";
import { newConsole, useConsoles } from "./store";

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  dispose = null;
  useConsoles.setState({ sessions: [], active: null });
  vi.restoreAllMocks();
});
describe("Console DOM (mock transport)", () => {
  it("routes U8 by explicit Console id and language through actions", async () => {
    setContext("projectOpen", true);
    dispose = activate();
    const python = newConsole({ selection: "/python", name: "Python", language: "python" });
    const r = newConsole({ selection: "ark|/ark|/R", name: "Ark", language: "r" });
    let targets: Array<{ consoleId: string; language: string; selection: string }> = [];
    await executeAction("ds.console.targets", (values: typeof targets) => {
      targets = values;
    });
    expect(targets.map((t) => [t.consoleId, t.language])).toEqual([
      [python.id, "python"],
      [r.id, "r"],
    ]);
    const execution = vi.spyOn(python, "execute").mockResolvedValue();
    await executeAction("ds.console.execute", { id: python.id, language: "python", source: "42" });
    expect(execution).toHaveBeenCalledExactlyOnceWith("42");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await executeAction("ds.console.execute", { id: python.id, language: "r", source: "42" });
    expect(error).toHaveBeenCalledWith(
      "action ds.console.execute failed",
      expect.objectContaining({ message: "Console session/language mismatch" }),
    );
    expect(execution).toHaveBeenCalledOnce();
  });

  it("executes outside notebook, masks password replies and switches isolated tabs", async () => {
    setContext("projectOpen", true);
    dispose = activate();
    vi.spyOn(consoleBackend, "runtimes").mockResolvedValue([
      { selection: "/python", name: "Python", language: "python" },
    ]);
    const snapshot = { id: "native-a", version: 1, cells: [] } as unknown as NotebookSnapshot;
    vi.spyOn(consoleBackend, "open").mockResolvedValue(snapshot);
    vi.spyOn(consoleBackend, "get").mockResolvedValue(snapshot);
    vi.spyOn(consoleBackend, "insert").mockImplementation(
      async (s) => ({ ...s, cells: [{ id: "cell" }] }) as NotebookSnapshot,
    );
    vi.spyOn(consoleBackend, "source").mockImplementation(async (s) => s);
    vi.spyOn(consoleBackend, "close").mockResolvedValue(null);
    let receive = (_e: NotebookOutputEvent) => {};
    let finish = (_s: NotebookSnapshot) => {};
    vi.spyOn(consoleBackend, "execute").mockImplementation((_s, _c, _r, _id, callback) => {
      receive = callback;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const reply = vi.spyOn(consoleBackend, "reply").mockResolvedValue(null);
    newConsole({ selection: "/python", name: "Python", language: "python" });
    const { container } = render(<ConsoleView />);
    fireEvent.change(screen.getByRole("textbox", { name: "Source" }), { target: { value: "input()" } });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(consoleBackend.execute).toHaveBeenCalledOnce());
    act(() =>
      receive({
        id: "native-a",
        cell: "cell",
        kind: "input_request",
        content: { requestId: "prompt", prompt: "Secret>", password: true },
      } as NotebookOutputEvent),
    );
    const input = screen.getByLabelText("Kernel input");
    expect(input).toHaveAttribute("type", "password");
    fireEvent.change(input, { target: { value: "secret" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reply to kernel" })));
    expect(reply).toHaveBeenCalledExactlyOnceWith("native-a", "prompt", "secret");
    expect(screen.getByRole("log")).not.toHaveTextContent("secret");
    await act(async () => finish(snapshot));
    act(() => {
      newConsole({ selection: "ark|/ark|/R", name: "Ark", language: "r" });
    });
    expect(screen.getByRole("tab", { name: "R 2" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("log")).not.toHaveTextContent("input()");
    fireEvent.click(screen.getByRole("tab", { name: "Python 1" }));
    expect(screen.getByRole("log")).toHaveTextContent("input()");
    expect(container.querySelector(".cm-editor")).toBeNull();
  });
  it("shows discovery failure and keeps refresh available", async () => {
    vi.spyOn(consoleBackend, "runtimes").mockRejectedValue(new Error("runtime discovery failed"));
    render(<ConsoleView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("runtime discovery failed");
    expect(screen.getByRole("button", { name: "Refresh notebook kernels" })).toBeEnabled();
  });
});
