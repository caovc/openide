/**
 * Clickable locations in run output: compiler diagnostics and stack traces for
 * common toolchains, plus URLs. Positions are 1-based as printed; consumers
 * convert to the IDE's 0-based lines.
 */

export interface FileTarget {
  /** As printed (relative, absolute or a bare file name). */
  path: string;
  line?: number;
  col?: number;
  /**
   * `path`: resolve against the run directory; `name`: a file name from a JVM
   * stack frame — look it up in the project (`path` then is the file under its
   * package directory, `com/acme/OrderController.kt`, when the frame names the class);
   * `rubyTest`: a Minitest test with no file in its output — `className` is its class, `path` its
   * method name — found by searching the project (`rubyTests.ts`).
   */
  resolve: "path" | "name" | "rubyTest";
  /** JVM frames: the class's binary name (`com.acme.OrderController$Inner`). */
  className?: string;
}

export type OutputLink =
  | { kind: "url"; start: number; end: number; url: string }
  | { kind: "file"; start: number; end: number; target: FileTarget };

interface Pattern {
  re: RegExp;
  /** Builds the link from a match; `start`/`end` are relative to the whole line. */
  build: (m: RegExpMatchArray) => OutputLink | null;
}

const num = (s: string | undefined) => (s ? Number(s) : undefined);

const PATH = String.raw`(?:[A-Za-z]:[\\/]|~?\/|\.{1,2}\/)?(?:[\w.@+\-]+[\\/])*[\w@+\-][\w.@+\-]*\.[A-Za-z][\w]{0,9}`;

const PATTERNS: Pattern[] = [
  // Python: File "app/main.py", line 12, in <module>
  {
    re: /File "([^"]+)", line (\d+)/dg,
    build: (m) => {
      const [start, end] = [m.index!, m.index! + m[0].length];
      return { kind: "file", start, end, target: { path: m[1]!, line: num(m[2]), resolve: "path" } };
    },
  },
  // JS / Node: at foo (src/a.ts:3:7) · at file:///abs/a.mjs:3:7 · at /abs/a.js:3:7
  {
    re: new RegExp(String.raw`(?:file:\/\/)?(${PATH}):(\d+):(\d+)`, "dg"),
    build: (m) => {
      const [start, end] = [m.index!, m.index! + m[0].length];
      return {
        kind: "file",
        start,
        end,
        target: { path: m[1]!, line: num(m[2]), col: num(m[3]), resolve: "path" },
      };
    },
  },
  // Generic `path:line` (Go `file.go:12`, Rust `--> src/main.rs:10`, gcc, eslint…) and `path(line,col)`.
  {
    re: new RegExp(String.raw`(${PATH})(?::(\d+)(?::(\d+))?|\((\d+)(?:,(\d+))?\))`, "dg"),
    build: (m) => {
      if (m.index! > 0 && /[\w/.~-]/.test(m.input![m.index! - 1]!)) return null;
      const [start, end] = [m.index!, m.index! + m[0].length];
      return {
        kind: "file",
        start,
        end,
        target: { path: m[1]!, line: num(m[2] ?? m[4]), col: num(m[3] ?? m[5]), resolve: "path" },
      };
    },
  },
];

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/g;

function trimUrl(url: string): string {
  let out = url;
  for (;;) {
    const last = out[out.length - 1];
    if (!last) return out;
    if (".,;:!?'\"".includes(last)) {
      out = out.slice(0, -1);
      continue;
    }
    if (last === ")" && out.split("(").length < out.split(")").length) {
      out = out.slice(0, -1);
      continue;
    }
    return out;
  }
}

/** Finds non-overlapping links in `text`; earlier (more specific) patterns win. */
export function findOutputLinks(text: string): OutputLink[] {
  if (text.length > 4000) return [];
  const links: OutputLink[] = [];
  const free = (s: number, e: number) => !links.some((l) => s < l.end && e > l.start);
  for (const m of text.matchAll(URL_RE)) {
    const url = trimUrl(m[0]);
    links.push({ kind: "url", start: m.index, end: m.index + url.length, url });
  }
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    for (const m of text.matchAll(p.re)) {
      const link = p.build(m);
      if (link && free(link.start, link.end)) links.push(link);
    }
  }
  return links.sort((a, b) => a.start - b.start);
}

/** Joins `path` onto `base` (POSIX), normalising `.`/`..`. Absolute paths are kept. */
export function joinPath(base: string, path: string): string {
  const p = path.replace(/\\/g, "/").replace(/^file:\/\//, "");
  const full = p.startsWith("/") || /^[A-Za-z]:\//.test(p) ? p : `${base.replace(/\/+$/, "")}/${p}`;
  const out: string[] = [];
  for (const seg of full.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return (/^[A-Za-z]:$/.test(out[0] ?? "") ? "" : "/") + out.join("/");
}
