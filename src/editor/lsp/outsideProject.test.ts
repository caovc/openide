import { expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { outsideProjectBanner, outsideProjectNotice } from "./outsideProject";
import { setFileDiagnostics } from "./diagnostics";
it("recognizes Rust/Go reports without JVM project advice", () => {
  expect(outsideProjectNotice("No packages found for open file x.go.")?.text).toMatch(/no package/);
  expect(outsideProjectNotice("This file may be excluded due to its GOOS/GOARCH build constraints.")?.text).toMatch(
    /build constraints/,
  );
  expect(outsideProjectNotice("This file is not included in any crates")?.text).toMatch(/not included/);
  expect(outsideProjectNotice("A.java is a non-project file, only syntax errors are reported")).toBeNull();
});
it("updates the diagnostic banner without build-tool reload actions", () => {
  const path = "/p/outside.rs";
  const { result, unmount } = renderHook(() => outsideProjectBanner.useBanner(path));
  expect(result.current).toBeNull();
  act(() =>
    setFileDiagnostics(path, "rust-analyzer", [
      {
        range: { start: { line: 0, col: 0 }, end: { line: 0, col: 1 } },
        severity: "warning",
        message: "This file is not included in any crates",
        source: "rust-analyzer",
        code: null,
      },
    ]),
  );
  expect(result.current?.text).toMatch(/not included/);
  expect(result.current?.actions).toEqual([]);
  act(() => setFileDiagnostics(path, "rust-analyzer", []));
  expect(result.current).toBeNull();
  unmount();
});
