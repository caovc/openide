import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { lineHasCode } from "../breakpoints/codeLines";

const lines = (state: EditorState) => Array.from({ length: state.doc.lines }, (_, i) => lineHasCode(state, i));

describe("lines that take a breakpoint", () => {
  it("skips blank and comment-only lines", () => {
    const doc = [
      "class A {",
      "",
      "   \t",
      "  // note",
      "  /** doc",
      "   * more",
      "   */",
      "  f() { return 1; } // trailing",
      "  /* a */ x = 1;",
      "  /* a */ /* b */",
      "}",
    ].join("\n");
    const state = EditorState.create({ doc, extensions: [javascript()] });
    expect(lines(state)).toEqual([true, false, false, false, false, false, false, true, true, false, true]);
  });

  it("only skips blank lines in a file without a parser", () => {
    expect(lines(EditorState.create({ doc: "x\n\n  \n// y" }))).toEqual([true, false, false, true]);
  });
});
