import { activeEditor } from "@/editor/api";
import { tx } from "@/platform/i18n";
import { editorService } from "@/workbench/contributions";

export type ConsoleLanguage = "python" | "r";
export type RunMode = "selection" | "file";

/** U7 callback descriptor. Console identity is independent of its runtime. */
export interface ConsoleTarget {
  consoleId: string;
  notebookId: string | null;
  language: ConsoleLanguage;
  selection: string;
  generation: number;
  busy: boolean;
  closing: boolean;
}

export interface ConsoleRuntime {
  selection: string;
  language: ConsoleLanguage;
  name: string;
}

export interface EditorRunSource {
  path: string;
  language: ConsoleLanguage;
  mode: RunMode;
  source: string;
  startLine: number;
  endLine: number;
}

export function captureSource(mode: RunMode): EditorRunSource {
  const editor = activeEditor();
  const input = editorService().activeInput?.();
  if (!editor || editor.ctx.virtual || editor.ctx.doc < 0 || input?.kind !== "file" || input.path !== editor.ctx.path)
    throw new Error(tx("Open a Python or R text editor first."));
  const { language, path } = editor.ctx;
  if (language !== "python" && language !== "r") throw new Error(tx("Only Python and R buffers can run in a Console."));
  const state = editor.view.state;
  if (mode === "selection" && state.selection.ranges.filter((range) => !range.empty).length > 1)
    throw new Error(tx("Select one continuous code range to run."));
  const { from, to } = mode === "selection" ? state.selection.main : { from: 0, to: state.doc.length };
  const source = state.sliceDoc(from, to);
  if (!source.trim()) throw new Error(tx("Select code or use Run Current Buffer in Console."));
  return {
    path,
    language,
    mode,
    source,
    startLine: state.doc.lineAt(from).number,
    endLine: state.doc.lineAt(Math.max(from, to - 1)).number,
  };
}

export function validateTarget(
  targets: ConsoleTarget[],
  language: ConsoleLanguage,
  expected: ConsoleTarget,
): ConsoleTarget {
  const target = targets.find((t) => t.consoleId === expected.consoleId);
  if (!target || target.generation !== expected.generation || target.selection !== expected.selection)
    throw new Error(tx("Console target changed or closed. Choose a Console again."));
  if (target.language !== language || expected.language !== language)
    throw new Error(tx("Console language does not match the editor. Choose a same-language Console."));
  if (target.closing) throw new Error(tx("Console is closing. Choose another Console."));
  if (target.busy) throw new Error(tx("Console is busy. Stop it or wait before running again."));
  return target;
}
