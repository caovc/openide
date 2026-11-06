import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotebookOutputEvent, NotebookSnapshot, ProjectInfo, RProjectEnvironment } from "@/bindings";
import { executeAction } from "@/platform/actions";
import { setContext } from "@/platform/context";
import { useProject } from "@/platform/project";
import { runtimeEnvironmentBackend } from "@/platform/runtimeEnvironment";
import { consoleBackend } from "./backend";
import { ConsoleView } from "./ConsoleView";
import { activate } from "./index";
import { newConsole, useConsoles } from "./store";

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  dispose = null;
  useConsoles.setState({ sessions: [], active: null });
  useProject.setState({ project: null });
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

it("uses the project default only for the new Console picker and preserves existing sessions", async () => {
  const existing = newConsole({ selection: "/old/python", name: "Existing", language: "python" });
  vi.spyOn(consoleBackend, "runtimes")
    .mockResolvedValueOnce([
      { selection: "/system/python", name: "System", language: "python" },
      { selection: "/project/.venv/python", name: "Project", language: "python", isProjectDefault: true },
    ])
    .mockResolvedValue([
      { selection: "/system/python", name: "System", language: "python" },
      { selection: "/new-default/python", name: "New default", language: "python", isProjectDefault: true },
    ]);
  render(<ConsoleView />);
  const picker = screen.getByRole("combobox", { name: "Notebook kernel" });
  await waitFor(() => expect(picker).toHaveValue("/project/.venv/python"));
  expect(existing.runtime.selection).toBe("/old/python");
  fireEvent.change(picker, { target: { value: "/system/python" } });
  fireEvent.click(screen.getByRole("button", { name: "Refresh notebook kernels" }));
  await screen.findByRole("option", { name: /New default/ });
  expect(picker).toHaveValue("/system/python");
  expect(existing.runtime.selection).toBe("/old/python");
});

it("does not silently replace a selected environment removed during refresh", async () => {
  vi.spyOn(consoleBackend, "runtimes")
    .mockResolvedValueOnce([
      { selection: "/default/python", name: "Default", language: "python", isProjectDefault: true },
      { selection: "/gone/python", name: "Old", language: "python" },
    ])
    .mockResolvedValue([{ selection: "/new/python", name: "New", language: "python", isProjectDefault: true }]);
  render(<ConsoleView />);
  const picker = screen.getByRole("combobox", { name: "Notebook kernel" });
  await waitFor(() => expect(picker).toHaveValue("/default/python"));
  fireEvent.change(picker, { target: { value: "/gone/python" } });
  fireEvent.click(screen.getByRole("button", { name: "Refresh notebook kernels" }));
  await screen.findByRole("option", { name: "/gone/python — Environment unavailable" });
  expect(picker).toHaveValue("/gone/python");
  expect(screen.getByRole("button", { name: "New…" })).toBeDisabled();
});

it("follows a changed project default until the new Console picker is explicitly selected", async () => {
  const existing = newConsole({ selection: "/A/python", name: "Running A", language: "python" });
  vi.spyOn(consoleBackend, "runtimes")
    .mockResolvedValueOnce([{ selection: "/A/python", name: "A", language: "python", isProjectDefault: true }])
    .mockResolvedValue([
      { selection: "/A/python", name: "A", language: "python" },
      { selection: "/B/python", name: "B", language: "python", isProjectDefault: true },
    ]);
  render(<ConsoleView />);
  const picker = screen.getByRole("combobox", { name: "Notebook kernel" });
  await waitFor(() => expect(picker).toHaveValue("/A/python"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh notebook kernels" }));
  await waitFor(() => expect(picker).toHaveValue("/B/python"));
  expect(existing.runtime.selection).toBe("/A/python");
});

it("resets the picker on project changes and ignores a pending refresh from the previous project", async () => {
  useProject.setState({ project: { root: "/project-A" } as ProjectInfo });
  let resolveOld!: (values: Awaited<ReturnType<typeof consoleBackend.runtimes>>) => void;
  vi.spyOn(consoleBackend, "runtimes")
    .mockResolvedValueOnce([
      { selection: "/A/python", name: "A default", language: "python", isProjectDefault: true },
      { selection: "/A/custom", name: "A custom", language: "python" },
    ])
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValue([{ selection: "/B/python", name: "B", language: "python", isProjectDefault: true }]);
  render(<ConsoleView />);
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Notebook kernel" })).toHaveValue("/A/python"));
  fireEvent.change(screen.getByRole("combobox", { name: "Notebook kernel" }), { target: { value: "/A/custom" } });
  fireEvent.click(screen.getByRole("button", { name: "Refresh notebook kernels" }));
  await waitFor(() => expect(resolveOld).toBeDefined());
  act(() => useProject.setState({ project: { root: "/project-B" } as ProjectInfo }));
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Notebook kernel" })).toHaveValue("/B/python"));
  await act(async () =>
    resolveOld([{ selection: "/A/late", name: "Late A", language: "python", isProjectDefault: true }]),
  );
  expect(screen.getByRole("combobox", { name: "Notebook kernel" })).toHaveValue("/B/python");
  expect(screen.queryByRole("option", { name: /A custom|Late A/ })).toBeNull();
});

it("refreshes R project details across projects even when the selected runtime is identical", async () => {
  useProject.setState({ project: { root: "/project-A" } as ProjectInfo });
  vi.spyOn(consoleBackend, "runtimes").mockResolvedValue([{ selection: "ark|/ark|/R", name: "R", language: "r" }]);
  const projectInfo = (projectRoot: string): RProjectEnvironment => ({
    projectRoot,
    renvStatus: "detected-inactive",
    hasLockfile: true,
    hasActivateScript: true,
    hasProjectProfile: true,
    lockedRVersion: null,
    lockedPackageCount: 1,
    diagnostics: [],
  });
  let resolveOld!: (info: RProjectEnvironment) => void;
  const inspect = vi
    .spyOn(runtimeEnvironmentBackend, "rProject")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValue(projectInfo("/project-B"));
  const expand = () => {
    const details = screen.getByText("New Console environment").closest("details")!;
    act(() => {
      details.open = true;
      fireEvent(details, new Event("toggle"));
    });
  };
  render(<ConsoleView />);
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Notebook kernel" })).toHaveValue("ark|/ark|/R"));
  expand();
  await waitFor(() => expect(inspect).toHaveBeenCalledTimes(1));
  act(() => useProject.setState({ project: { root: "/project-B" } as ProjectInfo }));
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Notebook kernel" })).toHaveValue("ark|/ark|/R"));
  expand();
  await screen.findByText("/project-B");
  await act(async () => resolveOld(projectInfo("/project-A")));
  expect(screen.queryByText("/project-A")).toBeNull();
  expect(screen.getByText("/project-B")).toBeVisible();
  expect(inspect).toHaveBeenCalledTimes(2);
});
