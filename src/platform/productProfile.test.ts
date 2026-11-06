import { afterEach, describe, expect, it, vi } from "vitest";
import { runConfigIssue, showRunConfig } from "./productProfile";

const config = (id: string, kind = "python") => ({ id, kind, debugAdapter: null });
afterEach(() => vi.unstubAllEnvs());

describe("removed toolchain compatibility", () => {
  it("cannot re-enable legacy JVM configurations through the old environment flag", () => {
    vi.stubEnv("VITE_OPENIDE_JVM", "1");
    for (const kind of [
      "application",
      "java",
      "java-file",
      "kotlin",
      "kotlinc",
      "scala",
      "scala-cli",
      "groovy",
      "clojure",
      "jsp",
      "gradle",
      "maven",
      "tomcat",
      "android",
      "remote-jvm",
    ])
      expect(showRunConfig(config(kind, kind))).toBe(false);
    expect(showRunConfig({ ...config("x", "program"), debugAdapter: "java-debug" })).toBe(false);
    expect(showRunConfig(config("r", "r"))).toBe(true);
    expect(showRunConfig(config("python"))).toBe(true);
  });
  it("preflights all nested compounds and before-launch dependencies", () => {
    const python = config("python");
    const legacy = config("legacy", "maven");
    const nested = { ...config("nested", "compound"), compound: [python.id, legacy.id] };
    const root = { ...config("root"), beforeLaunch: [{ kind: "run", target: nested.id }] };
    const configs = [root, nested, python, legacy];
    expect(runConfigIssue(root, configs)).toMatch(/removed JVM/);
    expect(configs[3]).toEqual(legacy);
    expect(runConfigIssue({ ...nested, compound: ["missing"] }, configs)).toMatch(/missing/);
    expect(runConfigIssue({ ...nested, compound: [] }, configs)).toMatch(/no runnable/);
  });
  it("rejects cycles without rejecting a shared valid dependency", () => {
    const leaf = config("leaf");
    const a = { ...config("a"), beforeLaunch: [{ kind: "run", target: "leaf" }] };
    const b = { ...config("b", "compound"), compound: ["leaf", "a"] };
    expect(runConfigIssue(b, [a, b, leaf])).toBeNull();
    expect(runConfigIssue(b, [{ ...a, beforeLaunch: [{ kind: "run", target: "b" }] }, b, leaf])).toMatch(/cycle/);
  });
});
