import { describe, expect, it } from "vitest";
import { findOutputLinks, joinPath, type OutputLink } from "./links";

function files(text: string) {
  return findOutputLinks(text)
    .filter((l): l is Extract<OutputLink, { kind: "file" }> => l.kind === "file")
    .map((l) => ({ ...l.target, text: text.slice(l.start, l.end) }));
}

describe("findOutputLinks", () => {
  it("rust diagnostics and panics", () => {
    expect(files("  --> src/main.rs:10:5")).toEqual([
      { path: "src/main.rs", line: 10, col: 5, resolve: "path", text: "src/main.rs:10:5" },
    ]);
    expect(files("thread 'main' panicked at crates/app/src/lib.rs:42:9:")[0]).toMatchObject({
      path: "crates/app/src/lib.rs",
      line: 42,
      col: 9,
    });
  });

  it("node / v8 stack frames", () => {
    expect(files("    at foo (src/server.ts:3:7)")).toEqual([
      { path: "src/server.ts", line: 3, col: 7, resolve: "path", text: "src/server.ts:3:7" },
    ]);
    expect(files("    at file:///Users/me/app/index.mjs:12:1")[0]).toMatchObject({
      path: "/Users/me/app/index.mjs",
      line: 12,
    });
    expect(files("    at Object.<anonymous> (/abs/dir/x.js:1:2)")[0]).toMatchObject({ path: "/abs/dir/x.js" });
  });

  it("python tracebacks", () => {
    const [link] = files('  File "app/main.py", line 3, in <module>');
    expect(link).toEqual({ path: "app/main.py", line: 3, resolve: "path", text: 'File "app/main.py", line 3' });
  });

  it("go and generic path:line", () => {
    expect(files("    math_test.go:12: expected 1")[0]).toMatchObject({ path: "math_test.go", line: 12 });
    expect(files("./cmd/server/main.go:8:2: undefined: x")[0]).toMatchObject({
      path: "./cmd/server/main.go",
      line: 8,
      col: 2,
    });
    expect(files("src/App.tsx(14,3): error TS2322")[0]).toMatchObject({ path: "src/App.tsx", line: 14, col: 3 });
  });

  it("URLs, trimming trailing punctuation", () => {
    const links = findOutputLinks("Listening on http://localhost:8080/api. (see https://x.dev/a_(b))");
    expect(links.filter((l) => l.kind === "url").map((l) => (l.kind === "url" ? l.url : ""))).toEqual([
      "http://localhost:8080/api",
      "https://x.dev/a_(b)",
    ]);
  });

  it("doesn't link URL ports or versions as files", () => {
    expect(files("Started at http://127.0.0.1:3000")).toEqual([]);
    expect(files("version 1.2.3:4")).toEqual([]);
    expect(files("plain text 12:30")).toEqual([]);
  });

  it("returns links sorted and non-overlapping", () => {
    const links = findOutputLinks("a.rs:1 then b.ts:2:3");
    expect(links.map((l) => l.start)).toEqual([0, 12]);
  });
});

describe("joinPath", () => {
  it("joins and normalises", () => {
    expect(joinPath("/p/app", "src/main.rs")).toBe("/p/app/src/main.rs");
    expect(joinPath("/p/app", "./a/../b.ts")).toBe("/p/app/b.ts");
    expect(joinPath("/p/app", "/abs/x.py")).toBe("/abs/x.py");
    expect(joinPath("/p/app/", "file:///abs/y.js")).toBe("/abs/y.js");
  });
});
