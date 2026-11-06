import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import type { ExpressionAt, NodeAt, Range, StructuralRanges, SyntaxNode } from "@/bindings";

// --- a hand-built syntax tree over the test document ----------------------------

interface FakeNode {
  kind: string;
  from: number;
  to: number;
  field: string | null;
  parent: FakeNode | null;
  error?: boolean;
}

let text = "";
let nodes: FakeNode[] = [];
let expressionAt: (range: Range) => ExpressionAt = () => {
  throw new Error("no expressionAt");
};
let errors: Range[] = [];
let structural: StructuralRanges | null = null;

const posOf = (off: number) => {
  const line = Text.of(text.split("\n")).lineAt(off);
  return { line: line.number - 1, col: off - line.from };
};
const offOf = (p: { line: number; col: number }) => Text.of(text.split("\n")).line(p.line + 1).from + p.col;
const rangeOf = (from: number, to: number): Range => ({ start: posOf(from), end: posOf(to) });

function toSyntax(n: FakeNode): SyntaxNode {
  return {
    kind: n.kind,
    range: rangeOf(n.from, n.to),
    field: n.field,
    named: true,
    error: !!n.error,
    missing: false,
    hasError: !!n.error,
  };
}

/**
 * Nodes outer → inner: `[kind, needle, nth?, field?]`; `needle` locates the
 * node's text (nth occurrence, default 0). Parents are the innermost earlier
 * node containing it.
 */
function tree(specs: Array<[string, string, number?, string?]>) {
  nodes = [];
  for (const [kind, needle, nth = 0, field = null] of specs) {
    let at = -1;
    for (let i = 0; i <= nth; i++) at = text.indexOf(needle, at + 1);
    if (at < 0) throw new Error(`no ${needle}`);
    const node: FakeNode = { kind, from: at, to: at + needle.length, field, parent: null };
    node.parent = [...nodes].reverse().find((n) => n.from <= node.from && n.to >= node.to) ?? null;
    nodes.push(node);
  }
}

const find = (kind: string, nth = 0) => nodes.filter((n) => n.kind === kind)[nth]!;
const syn = (kind: string, nth = 0) => toSyntax(find(kind, nth));

function nodeAt(range: Range): NodeAt | null {
  const from = offOf(range.start);
  const to = offOf(range.end);
  let best: FakeNode | null = null;
  for (const n of nodes) if (n.from <= from && n.to >= to && (!best || n.to - n.from <= best.to - best.from)) best = n;
  if (!best) return null;
  const ancestors: SyntaxNode[] = [];
  for (let p = best.parent; p; p = p.parent) ancestors.push(toSyntax(p));
  return { node: toSyntax(best), ancestors };
}

const structureMock = {
  support: vi.fn(async () => ({ tree: true, locals: false })),
  expressionAt: vi.fn(async (_doc: number, range: Range) => expressionAt(range)),
  syntaxErrors: vi.fn(async () => ({
    errors: errors.map((range) => ({ kind: "missing", range, expected: ";", message: "missing `;`" })),
    truncated: false,
  })),
  nodeAt: vi.fn(async (_doc: number, range: Range) => nodeAt(range)),
  identifiers: vi.fn(async (_doc: number, name: string) =>
    [...text.matchAll(new RegExp(`(?<![\\w$])${name}(?![\\w$])`, "g"))].map((m) => ({
      range: rangeOf(m.index!, m.index! + name.length),
      kind: "identifier",
      qualified: text[m.index! - 1] === ".",
    })),
  ),
  locals: vi.fn(async () => ({ status: "noIdentifier" as const })),
  structuralRanges: vi.fn(async () => structural!),
};

vi.mock("@/editor/structure", () => ({ structure: structureMock }));

const files: Record<string, string> = {};
vi.mock("@/platform/ipc", async (orig) => {
  const actual = await orig<typeof import("@/platform/ipc")>();
  return {
    ...actual,
    commands: {
      ...actual.commands,
      fsReadText: async (path: string) =>
        path in files
          ? { status: "ok", data: files[path] }
          : { status: "error", error: { kind: "notFound", message: path } },
      lspHover: async () => ({ status: "error", error: { kind: "unavailable", message: "no server" } }),
    },
  };
});
vi.mock("@/platform/project", () => ({ useProject: { getState: () => ({ project: { root: "/p" } }) } }));
const showHint = vi.fn();
vi.mock("@/editor/lsp/hint", () => ({ showHint }));

const { introduceFallback } = await import("./introduce");
const { useLspPopup } = await import("@/editor/lsp/popupStore");
const { lspDoc } = await import("@/editor/lsp/lsp");
const { clearLevelCache } = await import("./projectLevel");

// --- editor ---------------------------------------------------------------------

let view: EditorView | null = null;

function editor(doc: string, language: string, path: string, sel: { anchor: number; head?: number }) {
  text = doc;
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: sel,
      extensions: [history(), lspDoc.of({ doc: 1, path, language, uiMode: null, readOnly: false })],
    }),
  });
  return view;
}

const popup = () => useLspPopup.getState().popup;

async function pick(id: string) {
  const p = popup();
  if (p?.kind !== "list") throw new Error(`no list popup: ${JSON.stringify(p)}`);
  useLspPopup.setState({ popup: null });
  await p.items.find((i) => i.id === id)!.run();
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  errors = [];
  structural = null;
  clearLevelCache();
  for (const k of Object.keys(files)) delete files[k];
});

afterEach(() => {
  view?.destroy();
  view = null;
  useLspPopup.setState({ popup: null });
  showHint.mockClear();
});

describe("Introduce Variable fallback", () => {
  const tsSrc = "function f(o) {\n  const a = o.getUser().name;\n  log(o.getUser());\n}\n";

  function tsTree() {
    tree([
      ["program", tsSrc],
      ["function_declaration", tsSrc.trimEnd()],
      ["statement_block", "{\n  const a = o.getUser().name;\n  log(o.getUser());\n}", 0, "body"],
      ["lexical_declaration", "const a = o.getUser().name;"],
      ["member_expression", "o.getUser().name", 0, "value"],
      ["call_expression", "o.getUser()", 0, "object"],
      ["expression_statement", "log(o.getUser());"],
      ["call_expression", "log(o.getUser())"],
      ["arguments", "(o.getUser())", 0, "arguments"],
      ["call_expression", "o.getUser()", 1],
    ]);
    const call = syn("call_expression", 0);
    expressionAt = () => ({
      expression: call,
      exact: false,
      candidates: [call, syn("member_expression")],
      statement: syn("lexical_declaration"),
      block: syn("statement_block"),
      functionBoundary: null,
      hasError: false,
    });
  }

  it("offers expressions at the caret, then all occurrences, and names after the callee", async () => {
    const v = editor(tsSrc, "typescript", "/p/a.ts", { anchor: tsSrc.indexOf("getUser") + 2 });
    tsTree();
    expect(await introduceFallback(v, "variable", "notReady")).toBe(true);
    const chooser = popup();
    expect(chooser).toMatchObject({ kind: "list", title: "Expressions" });
    expect(chooser?.kind === "list" && chooser.items.map((i) => i.label)).toEqual(["o.getUser()", "o.getUser().name"]);
    await pick("0");
    expect(popup()).toMatchObject({ kind: "list", title: "Multiple occurrences found" });
    expect(
      popup()?.kind === "list" &&
        popup()!.kind === "list" &&
        (popup() as { items: { label: string }[] }).items.map((i) => i.label),
    ).toEqual(["Replace this occurrence only", "Replace all 2 occurrences"]);
    await pick("all");
    expect(v.state.doc.toString()).toBe(
      "function f(o) {\n  const user = o.getUser();\n  const a = user.name;\n  log(user);\n}\n",
    );
    expect(popup()).toMatchObject({ kind: "rename", initial: "user", suggestions: ["user", "value"] });
    // Escape keeps the default name.
    useLspPopup.setState({ popup: null });
    undo(v);
    expect(v.state.doc.toString()).toBe(tsSrc);
  });

  it("replaces only the selected occurrence on request", async () => {
    const v = editor(tsSrc, "typescript", "/p/a.ts", { anchor: tsSrc.indexOf("getUser") + 2 });
    tsTree();
    await introduceFallback(v, "variable", "notReady");
    await pick("0");
    await pick("one");
    expect(v.state.doc.toString()).toBe(
      "function f(o) {\n  const user = o.getUser();\n  const a = user.name;\n  log(o.getUser());\n}\n",
    );
  });

  it("respects an empty server answer unless the code there is broken", async () => {
    const at = tsSrc.indexOf("o.getUser()");
    const v = editor(tsSrc, "typescript", "/p/a.ts", { anchor: at, head: at + "o.getUser()".length });
    tsTree();
    const call = syn("call_expression", 0);
    expressionAt = () => ({
      expression: call,
      exact: true,
      candidates: [call],
      statement: syn("lexical_declaration"),
      block: syn("statement_block"),
      functionBoundary: null,
      hasError: false,
    });
    expect(await introduceFallback(v, "variable", "empty")).toBe(false);
    expect(v.state.doc.toString()).toBe(tsSrc);
    errors = [rangeOf(at + 5, at + 5)];
    expect(await introduceFallback(v, "variable", "empty")).toBe(true);
    await pick("one");
    expect(v.state.doc.toString()).toContain("const user = o.getUser();");
    expect(popup()).toMatchObject({ note: "Based on syntax (the code has errors)" });
  });

  it("refuses selections that are not an expression, lambda bodies and loop conditions", async () => {
    const src = "function f(xs) {\n  const ys = xs.map((x) => x * 2);\n  while (next(xs)) {}\n}\n";
    const v = editor(src, "typescript", "/p/a.ts", { anchor: src.indexOf("x * 2"), head: src.indexOf("x * 2") + 3 });
    tree([
      ["program", src],
      ["statement_block", src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1)],
      ["lexical_declaration", "const ys = xs.map((x) => x * 2);"],
      ["arrow_function", "(x) => x * 2"],
      ["binary_expression", "x * 2", 0, "body"],
      ["while_statement", "while (next(xs)) {}"],
      ["parenthesized_expression", "(next(xs))", 0, "condition"],
      ["call_expression", "next(xs)"],
    ]);
    expressionAt = () => ({
      expression: syn("binary_expression"),
      exact: false,
      candidates: [],
      statement: syn("lexical_declaration"),
      block: syn("statement_block"),
      functionBoundary: null,
      hasError: false,
    });
    await introduceFallback(v, "variable", "notReady");
    expect(showHint.mock.calls.at(-1)?.[1]).toBe(
      "Cannot perform refactoring: selected block should represent an expression",
    );

    const bin = syn("binary_expression");
    expressionAt = () => ({
      expression: bin,
      exact: true,
      candidates: [bin],
      statement: syn("lexical_declaration"),
      block: syn("statement_block"),
      functionBoundary: syn("arrow_function"),
      hasError: false,
    });
    await introduceFallback(v, "variable", "notReady");
    expect(showHint.mock.calls.at(-1)?.[1]).toMatch(/lambda with an expression body/);

    const call = syn("call_expression");
    expressionAt = () => ({
      expression: call,
      exact: true,
      candidates: [call],
      statement: syn("while_statement"),
      block: syn("statement_block"),
      functionBoundary: null,
      hasError: false,
    });
    await introduceFallback(v, "variable", "notReady");
    expect(showHint.mock.calls.at(-1)?.[1]).toMatch(/evaluated conditionally or repeatedly/);
    expect(v.state.doc.toString()).toBe(src);
  });

  it("inserts before a statement that does not start its line", async () => {
    const src = "def f(c, x):\n    if c: g(x + 1)\n";
    const at = src.indexOf("x + 1");
    const v = editor(src, "python", "/p/a.py", { anchor: at, head: at + 5 });
    tree([
      ["module", src],
      ["if_statement", "if c: g(x + 1)"],
      ["block", "g(x + 1)", 0, "consequence"],
      ["expression_statement", "g(x + 1)"],
      ["call", "g(x + 1)"],
      ["binary_operator", "x + 1"],
    ]);
    const e = syn("binary_operator");
    expressionAt = () => ({
      expression: e,
      exact: true,
      candidates: [e],
      statement: syn("expression_statement"),
      block: syn("block"),
      functionBoundary: null,
      hasError: false,
    });
    await introduceFallback(v, "variable", "notReady");
    expect(v.state.doc.toString()).toBe("def f(c, x):\n    if c: value = x + 1; g(value)\n");
  });
});

describe("Introduce Constant fallback", () => {
  it("adds a module-level Python constant and refuses non-literals", async () => {
    const src = 'import os\n\ndef f():\n    return g("max retries")\n';
    const at = src.indexOf('"max');
    const v = editor(src, "python", "/p/a.py", { anchor: at, head: at + '"max retries"'.length });
    tree([
      ["module", src],
      ["import_statement", "import os"],
      ["function_definition", src.slice(src.indexOf("def"))],
      ["block", 'return g("max retries")', 0, "body"],
      ["return_statement", 'return g("max retries")'],
      ["call", 'g("max retries")'],
      ["string", '"max retries"'],
    ]);
    const lit = syn("string");
    expressionAt = () => ({
      expression: lit,
      exact: true,
      candidates: [lit],
      statement: syn("return_statement"),
      block: syn("block"),
      functionBoundary: null,
      hasError: false,
    });
    await introduceFallback(v, "constant", "notReady");
    expect(v.state.doc.toString()).toBe(
      'import os\n\nMAX_RETRIES = "max retries"\n\ndef f():\n    return g(MAX_RETRIES)\n',
    );

    const call = syn("call");
    expressionAt = () => ({
      expression: call,
      exact: true,
      candidates: [call],
      statement: syn("return_statement"),
      block: syn("block"),
      functionBoundary: null,
      hasError: false,
    });
    view!.dispatch({
      changes: { from: 0, to: view!.state.doc.length, insert: src },
      selection: { anchor: src.indexOf("g("), head: src.indexOf("g(") + 'g("max retries")'.length },
    });
    await introduceFallback(view!, "constant", "notReady");
    expect(showHint.mock.calls.at(-1)?.[1]).toMatch(/only literal values/);
  });
});
