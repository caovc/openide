import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { useEditorRegistry } from "@/editor/api";
import { provideEditorService } from "@/workbench/contributions";
import { captureSource } from "./model";

let view: EditorView | undefined;
afterEach(() => {
  view?.destroy();
  useEditorRegistry.setState({ active: null });
});

function editor(language = "python", path = "/p/a.py") {
  view = new EditorView({
    state: EditorState.create({
      doc: "saved = 0\nprint(saved)\n",
      extensions: [EditorState.allowMultipleSelections.of(true)],
    }),
    parent: document.body,
  });
  useEditorRegistry.setState({ active: { view, ctx: { doc: 1, path, language, readOnly: false, uiMode: null } } });
  provideEditorService({
    activePath: () => path,
    activeInput: () => ({ kind: "file", key: path, path }),
    activeCursor: () => null,
    openFile: async () => {},
    openInput: async () => {},
    saveAll: async () => {
      throw new Error("Must not save");
    },
  });
  return view;
}

describe("editor source from live CodeMirror state", () => {
  it.each(["python", "r"])("captures a reversed UTF-16 selection for %s without trimming", (language) => {
    const view = editor(language);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "# 😀\nx = 42\nprint(x)\n" } });
    view.dispatch({ selection: { anchor: 20, head: 5 } });
    expect(captureSource("selection")).toMatchObject({
      language,
      source: view.state.sliceDoc(5, 20),
      startLine: 2,
      endLine: 3,
      mode: "selection",
    });
  });

  it("runs the full unsaved buffer even with a selection", () => {
    const view = editor();
    view.dispatch({ changes: { from: 8, to: 9, insert: "42" }, selection: { anchor: 0, head: 5 } });
    expect(captureSource("file")).toMatchObject({ source: "saved = 42\nprint(saved)\n", startLine: 1, endLine: 2 });
    expect(captureSource("selection").source).toBe("saved");
  });

  it("rejects empty selections, whitespace and disjoint selections", () => {
    const view = editor();
    expect(() => captureSource("selection")).toThrow("Select code");
    view.dispatch({ selection: EditorSelection.create([EditorSelection.range(0, 3), EditorSelection.range(10, 13)]) });
    expect(() => captureSource("selection")).toThrow("continuous");
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: " \n" }, selection: { anchor: 0 } });
    expect(() => captureSource("file")).toThrow("Select code");
  });

  it("uses the editor language instead of the file extension", () => {
    editor("plaintext", "/p/a.py");
    expect(() => captureSource("file")).toThrow("Only Python and R");
  });

  it("rejects a stale editor behind a non-text tab and virtual documents", () => {
    editor();
    provideEditorService({
      activePath: () => null,
      activeInput: () => ({ kind: "notebook", key: "n" }),
      activeCursor: () => null,
      openFile: async () => {},
      openInput: async () => {},
      saveAll: async () => {},
    });
    expect(() => captureSource("file")).toThrow("text editor");
    useEditorRegistry.getState().active!.ctx.virtual = true;
    expect(() => captureSource("file")).toThrow("text editor");
  });
});
