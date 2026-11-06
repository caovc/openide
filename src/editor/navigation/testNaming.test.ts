import { describe, expect, it } from "vitest";
import {
  isTestName,
  newTestName,
  rankCandidates,
  rustTestModuleOffset,
  subjectNamesFor,
  testNamesFor,
} from "./testNaming";

describe("test naming conventions (Go to Test)", () => {
  it.each([
    ["Foo.cs", ["FooTest.cs", "FooTests.cs", "TestFoo.cs", "FooIT.cs", "FooSpec.cs"]],
    ["foo.go", ["foo_test.go"]],
    ["foo.py", ["test_foo.py", "foo_test.py"]],
    ["foo.ts", ["foo.test.ts", "foo.spec.ts"]],
    ["Button.tsx", ["Button.test.tsx", "Button.spec.tsx"]],
    ["lexer.rs", ["lexer.rs", "lexer_test.rs", "lexer_tests.rs"]],
    ["user.rb", ["user_spec.rb", "user_test.rb"]],
  ])("%s → tests", (name, tests) => {
    expect(testNamesFor(name)).toEqual(tests);
  });

  it.each([
    ["FooTest.cs", ["Foo.cs"]],
    ["FooTests.kt", ["Foo.kt"]],
    ["TestFoo.cs", ["Foo.cs"]],
    ["foo_test.go", ["foo.go"]],
    ["test_foo.py", ["foo.py"]],
    ["foo_test.py", ["foo.py"]],
    ["lexer.rs", ["lexer.rs"]],
  ])("%s → subjects", (name, subjects) => {
    expect(subjectNamesFor(name)).toEqual(subjects);
  });

  it("JS/TS tests may test any script extension", () => {
    expect(subjectNamesFor("foo.spec.ts").slice(0, 3)).toEqual(["foo.ts", "foo.tsx", "foo.js"]);
  });

  it("recognises test file names", () => {
    for (const n of [
      "FooTest.cs",
      "TestFoo.cs",
      "FooTests.cs",
      "foo_test.go",
      "test_foo.py",
      "foo.test.tsx",
      "foo.spec.js",
      "foo_spec.rb",
      "bar_test.cc",
    ])
      expect(isTestName(n), n).toBe(true);
    for (const n of ["Foo.cs", "Test.cs", "Testing.cs", "foo.go", "foo.py", "foo.ts", "contest.py", "latest.ts"])
      expect(isTestName(n), n).toBe(false);
    expect(newTestName("Foo.cs")).toBe("FooTest.cs");
  });

  it("ranks the mirrored package first, then the closest file", () => {
    const below = (p: string) => p.replace(/^\/p\/(?:a|b)\/src\/(?:main|test)\/java\//, "");
    const ranked = rankCandidates(
      "/p/a/src/main/java/com/x/Foo.cs",
      [
        "/p/b/src/test/java/com/y/FooTest.cs",
        "/p/a/src/test/java/com/z/FooTest.cs",
        "/p/a/src/test/java/com/x/FooTest.cs",
      ],
      below,
    );
    expect(ranked).toEqual([
      "/p/a/src/test/java/com/x/FooTest.cs",
      "/p/a/src/test/java/com/z/FooTest.cs",
      "/p/b/src/test/java/com/y/FooTest.cs",
    ]);
  });

  it("finds a Rust #[cfg(test)] module", () => {
    const text = "fn a() {}\n\n#[cfg(test)]\nmod tests {\n}\n";
    expect(rustTestModuleOffset(text)).toBe(text.indexOf("#[cfg"));
    expect(rustTestModuleOffset("fn a() {}")).toBeNull();
  });
});
