import { afterEach, describe, expect, it } from "vitest";
import { isLibraryPath, setLibraryRoots } from "@/editor/api";
import { librariesRoot, touchesManifest } from "./index";

describe("External Libraries", () => {
  let dispose = () => {};
  afterEach(() => dispose());

  it("groups each SDK's folders under one read-only root", () => {
    expect(librariesRoot([])).toBeNull();
    const root = librariesRoot([
      {
        name: "Python 3.12 (.venv)",
        kind: "python",
        roots: [
          { name: "python3.12", path: "/py/lib/python3.12" },
          { name: "site-packages", path: "/p/.venv/lib/python3.12/site-packages" },
        ],
      },
    ])!;
    expect(root).toMatchObject({ id: "externalLibraries", label: "External Libraries", readOnly: true });
    expect(root.children?.[0]).toMatchObject({ label: "< Python 3.12 (.venv) >", icon: "file-python" });
    expect(root.children?.[0]?.children?.map((c) => [c.label, c.path, c.detail])).toEqual([
      ["python3.12", "/py/lib/python3.12", "library root"],
      ["site-packages", "/p/.venv/lib/python3.12/site-packages", "library root"],
    ]);
  });

  it("gives supported ecosystems their icons and legacy or unknown kinds a generic icon", () => {
    const root = librariesRoot(
      ["jdk", "nodeCore", "nodeModules", "rust", "cargo", "go", "goModules", "maven", "gradle", "other"].map(
        (kind) => ({
          name: kind,
          kind,
          roots: [{ name: "r", path: `/libs/${kind}` }],
        }),
      ),
    )!;
    expect(root.children?.map((g) => g.icon)).toEqual([
      "library",
      "file-js",
      "file-npm",
      "file-rust",
      "file-cargo",
      "file-go",
      "file-gomod",
      "library",
      "library",
      "library",
    ]);
  });

  it("lists generic source archives as browsable read-only roots", () => {
    const root = librariesRoot([
      {
        name: "Python sources",
        kind: "python",
        roots: [
          { name: "lib", path: "/py/lib" },
          { name: "sources.zip", path: "/py/sources.zip!" },
        ],
      },
    ])!;
    expect(root.children?.[0]?.children?.map((c) => c.icon)).toEqual(["folder-library", "file-archive"]);
    dispose = setLibraryRoots("test", ["/py/sources.zip!"]);
    expect(isLibraryPath("/py/sources.zip!/os.py")).toBe(true);
  });

  it("refreshes on manifest changes outside node_modules", () => {
    expect(touchesManifest(["/p/src/main.rs", "/p/Cargo.toml"])).toBe(true);
    expect(touchesManifest(["C:\\p\\go.mod"])).toBe(true);
    expect(touchesManifest(["/p/.venv/pyvenv.cfg"])).toBe(true);
    expect(touchesManifest(["/p/pom.xml", "/p/build.gradle", "/p/settings.gradle.kts"])).toBe(false);
    expect(touchesManifest(["/p/node_modules/react/package.json"])).toBe(false);
    expect(touchesManifest(["/p/src/package.json.bak", "/p/README.md"])).toBe(false);
  });

  it("marks files below library roots for read-only editors", () => {
    dispose = setLibraryRoots("test", ["/py/lib/python3.12"]);
    expect(isLibraryPath("/py/lib/python3.12/os.py")).toBe(true);
    expect(isLibraryPath("/py/lib/python3.120/x.py")).toBe(false);
    dispose();
    expect(isLibraryPath("/py/lib/python3.12/os.py")).toBe(false);
  });
});
