import { afterEach, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { acceptCompletion, currentCompletions, startCompletion } from "@codemirror/autocomplete";
import type { NotebookSession } from "./session";
import { arkLsp } from "./arkLsp";

const views: EditorView[] = [];
afterEach(() => {
  for (const view of views) view.destroy();
  views.length = 0;
});

it("CodeMirror requests session completion and applies Ark's function snippet, not literal $0", async () => {
  const queryLsp = vi.fn<NotebookSession["queryLsp"]>().mockResolvedValue({
    type: "completion",
    items: [
      {
        label: "openide_session_only",
        text: "openide_session_only($0)",
        snippet: true,
        detail: "function",
        range: null,
      },
    ],
  });
  const view = new EditorView({
    state: EditorState.create({
      doc: "openide_session_on",
      selection: { anchor: 18 },
      extensions: arkLsp({ queryLsp }, "real-cell"),
    }),
    parent: document.body,
  });
  views.push(view);
  startCompletion(view);
  await vi.waitFor(() =>
    expect(currentCompletions(view.state).map((item) => item.label)).toEqual(["openide_session_only"]),
  );
  expect(queryLsp).toHaveBeenCalledWith(
    "real-cell",
    "openide_session_on",
    { line: 0, col: 18 },
    "completion",
    expect.any(AbortSignal),
  );
  await vi.waitFor(() => expect(acceptCompletion(view)).toBe(true));
  expect(view.state.doc.toString()).toBe("openide_session_only()");
  expect(view.state.selection.main.head).toBe(21);
});

it("applies the server's UTF-16 replacement range instead of guessing the word", async () => {
  const queryLsp = vi.fn<NotebookSession["queryLsp"]>().mockResolvedValue({
    type: "completion",
    items: [
      {
        label: "mean",
        text: "mean",
        snippet: false,
        detail: null,
        range: { start: { line: 0, col: 7 }, end: { line: 0, col: 9 } },
      },
    ],
  });
  const view = new EditorView({
    state: EditorState.create({ doc: "'𠮷';  me", selection: { anchor: 9 }, extensions: arkLsp({ queryLsp }, "cell") }),
    parent: document.body,
  });
  views.push(view);
  startCompletion(view);
  await vi.waitFor(() => expect(currentCompletions(view.state)).toHaveLength(1));
  await vi.waitFor(() => expect(acceptCompletion(view)).toBe(true));
  expect(view.state.doc.toString()).toBe("'𠮷';  mean");
});
