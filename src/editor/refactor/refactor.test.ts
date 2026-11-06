import { describe, expect, it } from "vitest";
import { suggestNames, uniqueNames } from "./names";
import { constantDeclaration, isLiteral, literalType, replacesBareStatement, variableDeclaration } from "./templates";
import { cStandardIs23 } from "./projectLevel";
import { expressionWords, findTextOccurrences, normalizeExpression } from "./occurrences";

describe("suggestNames", () => {
  const s = (text: string, kind = "call_expression", language = "java", constant = false) =>
    suggestNames({ text, kind, language, constant });

  it("names calls after the callee without get/to/create prefixes", () => {
    expect(s("getUser()")).toEqual(["user", "value"]);
    expect(s("repo.getUserName(id)")).toEqual(["userName", "name", "value"]);
    expect(s("self.get_user_name()", "call", "python")).toEqual(["user_name", "name", "value"]);
    expect(s("list.isEmpty()")).toEqual(["empty", "isEmpty", "value"]);
    expect(s("await fetchOrders()", "await_expression", "typescript")).toEqual(["orders", "value"]);
    expect(s("users.get(0)")).toEqual(["user", "value"]);
    expect(s("compute(a + b, c)")).toEqual(["compute", "value"]);
  });

  it("names constructions after the type", () => {
    expect(s("new StringBuilder()", "object_creation_expression")).toEqual(["stringBuilder", "builder"]);
    expect(s("new java.util.ArrayList<String>()", "object_creation_expression")).toEqual(["arrayList", "list"]);
    expect(s("StringBuilder()", "call_expression", "kotlin")).toEqual(["stringBuilder", "builder"]);
    expect(s("HashMap::new()", "call_expression", "rust")).toEqual(["hash_map", "map"]);
  });

  it("names literals, members, indexing and conditions", () => {
    expect(s('"hello world"', "string_literal")).toEqual(["helloWorld", "s", "text"]);
    expect(s('"a/b?c"', "string")).toEqual(["s", "text"]);
    expect(s("42", "decimal_integer_literal")).toEqual(["i", "value"]);
    expect(s("1.5", "float")).toEqual(["value", "v"]);
    expect(s("true", "true")).toEqual(["b", "flag"]);
    expect(s("order.totalPrice", "field_access")).toEqual(["totalPrice", "price", "value"]);
    expect(s("$o->name", "member_access_expression", "php")).toEqual(["name", "value"]);
    expect(s("items[i]", "array_access")).toEqual(["item", "element"]);
    expect(s("a > b && c", "binary_expression")).toEqual(["b", "flag"]);
    expect(s("(a + b)", "parenthesized_expression")).toEqual(["value"]);
  });

  it("gives UPPER_SNAKE_CASE constants and drops keywords", () => {
    expect(s('"max retries"', "string_literal", "java", true)).toEqual(["MAX_RETRIES", "S", "TEXT"]);
    expect(s("100", "integer", "python", true)).toEqual(["I", "VALUE"]);
    expect(s("new Object()", "object_creation_expression")).toEqual(["object"]);
    expect(s("getClass()")).toEqual(["value"]);
  });

  it("drops taken names and numbers the best one when all are taken", async () => {
    const taken = new Set(["user", "value", "user1"]);
    const isTaken = (n: string) => Promise.resolve(taken.has(n));
    expect(await uniqueNames(["user", "name", "value"], isTaken)).toEqual(["name"]);
    expect(await uniqueNames(["user", "value"], isTaken)).toEqual(["user2"]);
  });
});

describe("templates", () => {
  const decl = (language: string, cx = {}) => {
    const r = variableDeclaration(language, "n", "e()", cx);
    return r.ok ? r.decl.text : r.reason;
  };

  it("declares variables per language", () => {
    expect(decl("csharp")).toBe("var n = e();");
    expect(decl("typescript", { semicolons: true })).toBe("const n = e();");
    expect(decl("javascript", { semicolons: false })).toBe("const n = e()");
    expect(decl("python")).toBe("n = e()");
    expect(decl("rust")).toBe("let n = e();");
    expect(decl("go")).toBe("n := e()");
    expect(decl("swift")).toBe("let n = e()");
    expect(decl("ruby")).toBe("n = e()");
    expect(decl("lua")).toBe("local n = e()");
    expect(decl("elixir")).toBe("n = e()");
    expect(decl("cpp")).toBe("auto n = e();");
    expect(decl("c")).toMatch(/C23/);
    expect(decl("c", { cAuto: true })).toBe("auto n = e();");
    expect(decl("c", { type: "const char *" })).toBe("const char *n = e();");
    expect(decl("dart")).toBe("final n = e();");
    expect(decl("haskell")).toMatch(/not supported/);
    const php = variableDeclaration("php", "n", "e()");
    expect(php.ok && php.decl).toMatchObject({
      text: "$n = e();",
      nameOffset: 1,
      reference: "$n",
      referenceNameOffset: 1,
    });
  });

  it("declares constants per language", () => {
    const c = (language: string, cx = {}) => {
      const r = constantDeclaration(language, "N", "1", cx);
      return r.ok ? r.decl.text : r.reason;
    };
    expect(c("typescript")).toBe("const N = 1;");
    expect(c("python")).toBe("N = 1");
    expect(c("go")).toMatch(/not supported/);
  });

  it("replaces bare statements only where they discard their value", () => {
    expect(replacesBareStatement("python", "expression_statement")).toBe(true);
    expect(replacesBareStatement("rust", "expression_statement")).toBe(true);
    expect(replacesBareStatement("rust", "call_expression")).toBe(false);
    expect(replacesBareStatement("ruby", "call")).toBe(false);
  });

  it("types literals and plain constructions", () => {
    expect(literalType("c", "string_literal", '"x"')).toBe("const char *");
    expect(literalType("c", "number_literal", "3UL")).toBeNull();
  });

  it("recognises literals that do not depend on scope", () => {
    expect(isLiteral("typescript", "template_string", "`a${b}`")).toBe(false);
    expect(isLiteral("typescript", "template_string", "`ab`")).toBe(true);
    expect(isLiteral("typescript", "identifier", "x")).toBe(false);
    expect(isLiteral("python", "string", 'f"{x}"')).toBe(false);
    expect(isLiteral("python", "string", '"x"')).toBe(true);
    expect(isLiteral("python", "unary_operator", "-1")).toBe(true);
  });
});

describe("project language levels", () => {
  it("detects C23", () => {
    expect(cStandardIs23("CMakeLists.txt", "set(CMAKE_C_STANDARD 23)")).toBe(true);
    expect(cStandardIs23("compile_flags.txt", "-std=c2x\n-Wall")).toBe(true);
    expect(cStandardIs23("Makefile", "CFLAGS=-std=c11")).toBe(false);
  });
});

describe("occurrences", () => {
  it("normalises whitespace between tokens but not inside strings", () => {
    expect(normalizeExpression("a  +\n b")).toBe("a+b");
    expect(normalizeExpression("new   Foo( 1 )")).toBe("new Foo(1)");
    expect(normalizeExpression('f( "a  b" )')).toBe('f("a  b")');
  });

  it("finds spans equal up to whitespace, whole words only", () => {
    const text = 'x = a + b; y = a+b; z = aa + b; w = "a + b"; v = a + bc;';
    const found = findTextOccurrences(text, 0, text.length, "a + b").map((o) => text.slice(o.from, o.to));
    expect(found).toEqual(["a + b", "a+b", "a + b"]);
    expect(findTextOccurrences(text, 10, text.length, "a+b").length).toBe(2);
  });

  it("lists the names of an expression outside literals", () => {
    expect(expressionWords('foo(bar, "baz", qux.x)').map((w) => w.word)).toEqual(["foo", "bar", "qux", "x"]);
  });
});
