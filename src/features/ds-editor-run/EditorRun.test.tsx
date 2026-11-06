import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorRegistry } from "@/editor/api";
import { executeAction, getAction, registerActions } from "@/platform/actions";
import { setContext } from "@/platform/context";
import { commands } from "@/platform/ipc";
import {
  menuGroupItems,
  provideEditorService,
  provideNotificationService,
  provideToolWindowService,
  useContributions,
} from "@/workbench/contributions";
import { activate } from "./index";
import type { ConsoleTarget } from "./model";

const python = (): ConsoleTarget => ({
  consoleId: "python-one",
  notebookId: null,
  language: "python",
  selection: "/env/python",
  generation: 0,
  busy: false,
  closing: false,
});
const ark = (): ConsoleTarget => ({ ...python(), consoleId: "r-one", language: "r", selection: "ark|/ark|/R" });
let targets: ConsoleTarget[];
let view: EditorView;
let disposers: Array<() => void>;
const execute = vi.fn();
const create = vi.fn();
const cancel = vi.fn();
const select = vi.fn();
const show = vi.fn();
const notify = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  targets = [python(), ark()];
  disposers = [];
  setContext("projectOpen", true);
  setContext("textEditorActive", true);
  const path = "/project/unsaved.py";
  view = new EditorView({ state: EditorState.create({ doc: "value = 1\nprint(value)\n" }), parent: document.body });
  useEditorRegistry.setState({
    active: { view, ctx: { doc: 1, path, language: "python", readOnly: false, uiMode: null } },
  });
  provideEditorService({
    activePath: () => path,
    activeInput: () => ({ kind: "file", key: path, path }),
    activeCursor: () => null,
    openFile: async () => {},
    openInput: async () => {},
    saveAll: vi.fn(async () => {
      throw new Error("No saving allowed");
    }),
  });
  provideToolWindowService({ show, hide: vi.fn(), toggle: vi.fn(), isVisible: () => true });
  provideNotificationService({ notify });
  vi.spyOn(commands, "sdkDetect").mockResolvedValue({
    status: "ok",
    data: [{ name: "Python env", path: "/env/python", source: "system", home: null, extra: null, version: "3.12" }],
  });
  vi.spyOn(commands, "notebookDetectRuntimes").mockResolvedValue({
    status: "ok",
    data: [{ id: "ark|/ark|/R", name: "Ark env", kind: "ark", path: "/ark", home: "/R" }],
  });
  execute.mockImplementation(async () => {});
  create.mockImplementation((runtime) => targets.push({ ...python(), consoleId: "created", ...runtime }));
  // U7 boundary mock: use the real registry/callback protocol, never import Console internals.
  disposers.push(
    registerActions([
      {
        id: "ds.console.targets",
        title: "Console",
        hidden: true,
        run: ({ arg }) => {
          (arg as (targets: ConsoleTarget[]) => void)(targets.map((t) => ({ ...t })));
        },
      },
      { id: "ds.console.execute", title: "Run", hidden: true, run: ({ arg }) => execute(arg) },
      {
        id: "ds.console.new",
        title: "New…",
        hidden: true,
        run: ({ arg }) => {
          create(arg);
        },
      },
      {
        id: "ds.console.select",
        title: "Console",
        hidden: true,
        run: ({ arg }) => {
          select(arg);
        },
      },
      {
        id: "ds.console.cancel",
        title: "Stop",
        hidden: true,
        run: ({ arg }) => {
          cancel(arg);
        },
      },
    ]),
  );
  disposers.push(activate());
});

afterEach(() => {
  disposers.reverse().forEach((dispose) => dispose());
  view.destroy();
  useEditorRegistry.setState({ active: null });
  vi.restoreAllMocks();
});

function overlay() {
  const Overlay = useContributions.getState().overlays.get("ds.editorRun.picker")!.component;
  return render(<Overlay />);
}

describe("Editor Run actions and DOM (mock U7 boundary)", () => {
  it("wires editor menus and sends the selected unsaved text to the Python Console", async () => {
    view.dispatch({ changes: { from: 8, to: 9, insert: "42" } });
    view.dispatch({ selection: { anchor: 0, head: 10 } });
    const items = menuGroupItems("editor", { paths: ["/project/unsaved.py"] }).filter((item) => item.kind === "action");
    expect(items.map((item) => item.action)).toEqual([
      "ds.editorRun.selection",
      "ds.editorRun.file",
      "ds.editorRun.chooseSelection",
      "ds.editorRun.chooseFile",
      "ds.editorRun.cancel",
    ]);
    await executeAction(items[0]!.action);
    expect(execute).toHaveBeenCalledExactlyOnceWith({ id: "python-one", language: "python", source: "value = 42" });
    expect(select).toHaveBeenCalledWith("python-one");
    expect(show).toHaveBeenCalledWith("ds-console", true);
    expect(create).not.toHaveBeenCalled();
    await executeAction("ds.editorRun.file");
    expect(execute).toHaveBeenLastCalledWith({
      id: "python-one",
      language: "python",
      source: "value = 42\nprint(value)\n",
    });
  });

  it("disables the empty selection menu and removes menus/actions on disposal", () => {
    expect(menuGroupItems("editor", { paths: ["/project/unsaved.py"] })[0]).toMatchObject({ disabled: true });
    expect(menuGroupItems("editor", { paths: ["/other.py"] })).toEqual([]);
    useEditorRegistry.getState().active!.ctx.language = "rust";
    expect(menuGroupItems("editor", { paths: ["/project/unsaved.py"] })).toEqual([]);
    disposers.pop()!();
    expect(getAction("ds.editorRun.file")).toBeUndefined();
    expect(useContributions.getState().overlays.has("ds.editorRun.picker")).toBe(false);
  });

  it("shows the captured buffer and exact same-language target in the picker", async () => {
    targets.push({ ...python(), consoleId: "python-two" });
    overlay();
    await act(() => executeAction("ds.editorRun.chooseFile"));
    expect(screen.getByRole("dialog")).toHaveTextContent("/project/unsaved.py:1–2");
    expect(screen.getByRole("dialog").querySelector("pre")?.textContent).toBe("value = 1\nprint(value)\n");
    expect(screen.queryByRole("option", { name: /r-one/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Console target" }), { target: { value: "python-one" } });
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "changed after picker" } });
    fireEvent.click(screen.getByRole("button", { name: /^Run$/ }));
    await waitFor(() =>
      expect(execute).toHaveBeenCalledExactlyOnceWith({
        id: "python-one",
        language: "python",
        source: "value = 1\nprint(value)\n",
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(() => executeAction("ds.editorRun.file"));
    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ id: "python-one" }));
  });

  it("requires an explicit creation click when Python is missing", async () => {
    targets = [ark()];
    overlay();
    await act(() => executeAction("ds.editorRun.file"));
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Run$/ })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Notebook kernel" }), { target: { value: "/env/python" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Console and Run" }));
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({ id: "created", language: "python" })),
    );
    expect(create).toHaveBeenCalledExactlyOnceWith({
      selection: "/env/python",
      language: "python",
      name: "Python env",
    });
    expect(commands.notebookDetectRuntimes).not.toHaveBeenCalled();
  });

  it("discovers only Ark for an R buffer and offers actionable missing-runtime guidance", async () => {
    useEditorRegistry.getState().active!.ctx.language = "r";
    targets = [];
    vi.mocked(commands.notebookDetectRuntimes).mockResolvedValue({ status: "ok", data: [] });
    overlay();
    await act(() => executeAction("ds.editorRun.file"));
    expect(screen.getByRole("dialog")).toHaveTextContent("Install Ark and an R distribution");
    expect(commands.sdkDetect).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Create Console and Run" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(execute).not.toHaveBeenCalled();
  });

  it("creates an explicitly selected Ark Console and sends the unsaved R buffer there", async () => {
    useEditorRegistry.getState().active!.ctx.language = "r";
    targets = [python()];
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "answer <- 42\nprint(answer)" } });
    overlay();
    await act(() => executeAction("ds.editorRun.file"));
    expect(screen.queryByRole("option", { name: /python-one/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Notebook kernel" }), { target: { value: "ark|/ark|/R" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Console and Run" }));
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith({ id: "created", language: "r", source: "answer <- 42\nprint(answer)" }),
    );
    expect(create).toHaveBeenCalledExactlyOnceWith({ selection: "ark|/ark|/R", language: "r", name: "Ark env" });
  });

  it("Cancel dismisses the picker without executing or creating", async () => {
    overlay();
    await act(() => executeAction("ds.editorRun.chooseFile"));
    fireEvent.change(screen.getByRole("combobox", { name: "Console target" }), { target: { value: "python-one" } });
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(execute).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("refreshes discovery failures without losing the captured source", async () => {
    targets = [];
    vi.mocked(commands.sdkDetect).mockRejectedValueOnce(new Error("discovery unavailable"));
    overlay();
    await act(() => executeAction("ds.editorRun.file"));
    expect(screen.getByRole("alert")).toHaveTextContent("discovery unavailable");
    expect(screen.getByText(/Install Python with ipykernel/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh notebook kernels" }));
    await screen.findByRole("option", { name: "Python env — /env/python" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("rejects stale/wrong explicit targets and reports busy admission errors", async () => {
    await executeAction("ds.editorRun.file", ark());
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ body: expect.stringContaining("language") }));
    await executeAction("ds.editorRun.file", { ...python(), consoleId: "gone" });
    expect(notify).toHaveBeenLastCalledWith(
      expect.objectContaining({ body: expect.stringContaining("changed or closed") }),
    );
    targets[0]!.busy = true;
    await executeAction("ds.editorRun.file");
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ body: expect.stringContaining("busy") }));
    expect(execute).not.toHaveBeenCalled();
  });

  it("offers cancellation while the editor execution action is still pending", async () => {
    let finish!: () => void;
    execute.mockImplementation(() => {
      targets[0]!.busy = true;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const running = executeAction("ds.editorRun.file");
    await waitFor(() => expect(execute).toHaveBeenCalledOnce());
    await executeAction("ds.editorRun.cancel");
    expect(cancel).toHaveBeenCalledExactlyOnceWith("python-one");
    finish();
    await running;
  });
});
