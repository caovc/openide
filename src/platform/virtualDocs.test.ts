import { describe, expect, it } from "vitest";
import { isVirtualUri, virtualName, virtualParent, virtualContainer } from "./virtualDocs";
import { basename, relativePath, relativeDir } from "./project";
const URI = "rust-analyzer://library/core/iter.rs?version=1";
describe("virtual source documents", () => {
  it("distinguishes server URIs from file paths", () => {
    expect(isVirtualUri(URI)).toBe(true);
    for (const path of ["/tmp/a.py", "C:\\src\\a.py", "file:///a.py", "file:///a.class", "", undefined])
      expect(isVirtualUri(path)).toBe(false);
  });
  it("names and locates generic language-server documents", () => {
    expect(virtualName(URI)).toBe("iter.rs");
    expect(virtualParent(URI)).toBe("rust-analyzer://library/core");
    expect(virtualContainer(URI)).toBe("library › core");
    expect(virtualName("server://lib/my%20file.py")).toBe("my file.py");
  });
  it("uses virtual location labels consistently", () => {
    expect(basename(URI)).toBe("iter.rs");
    expect(relativePath("/p", URI)).toBe("library › core › iter.rs");
    expect(relativeDir("/p", URI)).toBe("library › core");
    expect(relativePath("/p", "/p/a.py")).toBe("a.py");
  });
});
