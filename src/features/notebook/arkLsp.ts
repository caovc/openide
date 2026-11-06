import { autocompletion, snippet, type CompletionSource } from "@codemirror/autocomplete";
import { hoverTooltip } from "@codemirror/view";
import styles from "./Notebook.module.css";
import { lspSnippetToCm } from "@/editor/lsp/snippet";
import type { NotebookSession } from "./session";

/** Notebook editors deliberately bypass project LSP: only their execution session owns R state. */
export function arkLsp(session: Pick<NotebookSession, "queryLsp">, cell: string) {
  const completion: CompletionSource = async (context) => {
    const word = context.matchBefore(/[\w.]+/);
    if (!context.explicit && !word) return null;
    const line = context.state.doc.lineAt(context.pos);
    const abort = new AbortController();
    context.addEventListener("abort", () => abort.abort(), { onDocChange: true });
    const result = await session.queryLsp(
      cell,
      context.state.doc.toString(),
      { line: line.number - 1, col: context.pos - line.from },
      "completion",
      abort.signal,
    );
    if (context.aborted || result?.type !== "completion") return null;
    return {
      from: word?.from ?? context.pos,
      options: result.items.map((item) => ({
        label: item.label,
        detail: item.detail ?? undefined,
        apply(view, completion, from, to) {
          const range = item.range;
          if (range) {
            if (range.start.line >= view.state.doc.lines || range.end.line >= view.state.doc.lines) return;
            const start = view.state.doc.line(range.start.line + 1);
            const end = view.state.doc.line(range.end.line + 1);
            if (range.start.col > start.length || range.end.col > end.length) return;
            from = start.from + range.start.col;
            to = end.from + range.end.col;
          }
          if (to < from) return;
          if (item.snippet) {
            snippet(lspSnippetToCm(item.text))(view, completion, from, to);
            return;
          }
          view.dispatch({ changes: { from, to, insert: item.text }, selection: { anchor: from + item.text.length } });
        },
      })),
    };
  };
  return [
    autocompletion({ override: [completion] }),
    hoverTooltip(async (view, pos) => {
      const doc = view.state.doc;
      const line = doc.lineAt(pos);
      const result = await session.queryLsp(
        cell,
        doc.toString(),
        { line: line.number - 1, col: pos - line.from },
        "hover",
      );
      if (view.state.doc !== doc || result?.type !== "hover" || !result.text) return null;
      const text = result.text;
      return {
        pos,
        create() {
          const dom = document.createElement("div");
          dom.textContent = text;
          dom.className = styles.arkHover ?? "";
          return { dom };
        },
      };
    }),
  ];
}
