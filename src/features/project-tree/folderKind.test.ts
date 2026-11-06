import { describe, expect, it } from "vitest";
import { folderKind } from "./folderKind";
import type { RootFolder } from "@/platform/languageSettings";

const roots: RootFolder[] = [
  { path: "src", kind: "source", detectedFrom: "pyproject.toml" },
  { path: "tests", kind: "test", detectedFrom: "pyproject.toml" },
  { path: ".venv", kind: "excluded", detectedFrom: null },
];
describe("language-independent folder presentation", () => {
  it.each([
    ["src", "source"],
    ["tests", "test"],
    ["src/analysis", "package"],
    [".venv", "excluded"],
  ])("keeps Python roots: %s", (path, kind) => {
    expect(folderKind({ path: `/p/${path}`, excluded: false }, roots, "/p")).toBe(kind);
  });
  it("does not infer JVM build outputs or module roles", () => {
    for (const path of ["target/classes", "build/generated", "src/main/java/com"])
      expect(folderKind({ path: `/p/${path}`, excluded: false }, [], "/p")).toBe("plain");
  });
  it("honors explicit marks and exclusion", () => {
    expect(folderKind({ path: "/p/out", excluded: true }, [], "/p")).toBe("excluded");
    expect(
      folderKind({ path: "/p/out", excluded: true }, [{ path: "out", kind: "source", detectedFrom: null }], "/p"),
    ).toBe("source");
    expect(folderKind({ path: "/p/.github", excluded: false }, [], "/p")).toBe("github");
  });
});
