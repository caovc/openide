import { expect, it, vi } from "vitest";
import { showSettingsPage } from "@/platform/productProfile";
import { builtinSpec } from "../pages/registry";

it("removes JVM settings from the built-in settings and search registry", () => {
  for (const id of ["languages.java", "build.gradle", "build.maven"]) expect(builtinSpec(id)).toBeUndefined();
  for (const id of ["python.interpreter", "build.pythonDebugger", "projectStructure"])
    expect(builtinSpec(id)).toBeDefined();
  vi.stubEnv("VITE_OPENIDE_JVM", "1");
  expect(showSettingsPage("languages.java")).toBe(true);
  vi.unstubAllEnvs();
});
