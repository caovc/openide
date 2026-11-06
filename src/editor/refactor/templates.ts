/**
 * Per-language declaration templates and literal typing for the syntax-only
 * Introduce Variable / Constant. Only what is certain from the text: no type
 * inference beyond literals and plain constructor calls.
 */

const TS_JS = new Set(["typescript", "typescriptreact", "javascript", "javascriptreact"]);

export function isTsJs(language: string): boolean {
  return TS_JS.has(language);
}

/** Facts about the project / file a template depends on. */
export interface DeclContext {
  /** C: C23 (`auto`). */
  cAuto?: boolean;
  /** TS/JS: the file ends statements with `;`. */
  semicolons?: boolean;
  /** Explicit type for languages that need one (Java without `var`, C without `auto`). */
  type?: string | null;
}

export interface Declaration {
  text: string;
  /** Offset of the variable name within `text`. */
  nameOffset: number;
  /** How occurrences refer to the variable (`$name` in PHP). */
  reference: string;
  /** Offset of the name within `reference`. */
  referenceNameOffset: number;
  /** `text` ends with a statement terminator. */
  terminated: boolean;
}

export type DeclResult = { ok: true; decl: Declaration } | { ok: false; reason: string };

function build(prefix: string, name: string, middle: string, suffix: string, sigil = ""): Declaration {
  return {
    text: `${prefix}${sigil}${name}${middle}${suffix}`,
    nameOffset: prefix.length + sigil.length,
    reference: `${sigil}${name}`,
    referenceNameOffset: sigil.length,
    terminated: suffix.endsWith(";"),
  };
}

/** `T name` with C's `char *name` spacing. */
function typed(type: string): string {
  return type.endsWith("*") ? type : `${type} `;
}

export function variableDeclaration(language: string, name: string, expr: string, cx: DeclContext = {}): DeclResult {
  const ok = (decl: Declaration): DeclResult => ({ ok: true, decl });
  const v = (prefix: string, op: string, suffix = "") => ok(build(prefix, name, ` ${op} ${expr}`, suffix));
  switch (language) {
    case "csharp":
      return v("var ", "=", ";");
    case "swift":
      return v("let ", "=");
    case "rust":
      return v("let ", "=", ";");
    case "go":
      return v("", ":=");
    case "python":
    case "ruby":
    case "elixir":
      return v("", "=");
    case "lua":
      return v("local ", "=");
    case "php":
      return ok(build("", name, ` = ${expr}`, ";", "$"));
    case "cpp":
      return v("auto ", "=", ";");
    case "c":
      if (cx.cAuto) return v("auto ", "=", ";");
      if (cx.type) return v(typed(cx.type), "=", ";");
      return { ok: false, reason: "the type of the expression is unknown (`auto` needs C23)" };
    case "dart":
      return v("final ", "=", ";");
    case "zig":
      return v("const ", "=", ";");
    default:
      if (TS_JS.has(language)) return v("const ", "=", cx.semicolons === false ? "" : ";");
      return { ok: false, reason: `not supported for ${language} without the language server` };
  }
}

export function constantDeclaration(language: string, name: string, expr: string, cx: DeclContext = {}): DeclResult {
  const ok = (prefix: string, suffix = ""): DeclResult => ({
    ok: true,
    decl: build(prefix, name, ` = ${expr}`, suffix),
  });
  switch (language) {
    case "python":
      return ok("");
    default:
      if (TS_JS.has(language)) return ok("const ", cx.semicolons === false ? "" : ";");
      return { ok: false, reason: `Introduce Constant is not supported for ${language} without the language server` };
  }
}

/** Languages whose block-level expression statements discard their value. */
const STATEMENT_VALUE_DISCARDED = new Set([
  "csharp",
  "python",
  "go",
  "c",
  "cpp",
  "php",
  "dart",
  "lua",
  "zig",
  ...TS_JS,
]);

/**
 * May an expression statement that consists of exactly the extracted
 * expression be replaced by the declaration (IDEA: `foo();` → `var x = foo();`)?
 * Not where a trailing expression is the block's value (Rust tail
 * expressions, Kotlin / Scala / Ruby / Elixir / Swift blocks).
 */
export function replacesBareStatement(language: string, statementKind: string): boolean {
  if (language === "rust") return statementKind === "expression_statement";
  return STATEMENT_VALUE_DISCARDED.has(language);
}

const NUMERIC_INT = /^(0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*)([lL]?)$/;
const NUMERIC_FLOAT = /^(\d[\d_]*\.?[\d_]*([eE][+-]?\d+)?|\.\d[\d_]*([eE][+-]?\d+)?)([fFdD]?)$/;

function numericType(text: string, intTypes: [string, string], floatTypes: [string, string]): string | null {
  const t = text.replace(/^-\s*/, "");
  const i = NUMERIC_INT.exec(t);
  if (i) return i[2] ? intTypes[1] : intTypes[0];
  const f = NUMERIC_FLOAT.exec(t);
  if (f && /[.eEfFdD]/.test(t)) return /[fF]$/.test(t) ? floatTypes[1] : floatTypes[0];
  return null;
}

/**
 * Is `kind`/`text` a literal (optionally negated number) whose value does not
 * depend on anything in scope? Interpolating strings are not.
 */
export function isLiteral(language: string, kind: string, text: string): boolean {
  const t = text.trim();
  const negNumber = /^-\s*[\d.]/.test(t) && /unary|prefix/.test(kind);
  switch (language) {
    case "python":
      if (negNumber) return true;
      if (kind === "string" || kind === "concatenated_string") return !/(^|["'\s])[rRbBuU]*[fF][rRbB]*["']/.test(t);
      return ["integer", "float", "true", "false"].includes(kind);
    case "c":
    case "cpp":
      return negNumber || ["string_literal", "char_literal", "number_literal", "true", "false"].includes(kind);
    default:
      if (TS_JS.has(language)) {
        if (negNumber) return true;
        if (kind === "template_string") return !t.includes("${");
        return ["string", "number", "true", "false", "regex"].includes(kind);
      }
      return false;
  }
}

/** Java / C type of a literal, or null when it has none (or is not a literal). */
export function literalType(language: string, kind: string, text: string): string | null {
  if (!isLiteral(language, kind, text)) return null;
  const t = text.trim();
  if (language === "c") {
    if (kind === "string_literal") return "const char *";
    if (kind === "char_literal") return "char";
    if (kind === "true" || kind === "false") return null;
    const n = t.replace(/^-\s*/, "");
    if (/^(0[xX][\da-fA-F]+|\d+)[uU]?[lL]{1,2}[uU]?$/.test(n))
      return /[uU]/.test(n) ? null : /[lL]{2}/.test(n) ? "long long" : "long";
    if (/^(0[xX][\da-fA-F]+|\d+)$/.test(n)) return "int";
    return numericType(n, ["int", "long"], ["double", "float"]);
  }
  return null;
}
