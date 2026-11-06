import { fireEvent, render, screen } from "@testing-library/react";
import { ConfigForm } from "./ConfigForm";
import { filterTools } from "../tools/LanguageServersPage";
import { sampleTools } from "../tools/backend";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RunConfig } from "@/platform/ipc";
import { showDebugAdapter, showLanguageTool, showRunConfig, showRunKind } from "@/platform/productProfile";
import { registerRunConfigType, runConfigTypes } from "@/workbench/contributions";
import { remoteJvmType, pythonRemoteType } from "../debugger/remote";
import { buildRows } from "./ConfigChooser";
import { treeRows } from "./EditConfigsDialog";
import { groupConfigs } from "./configs";
import { fileTargets, OPTIMISTIC, produceContext, produceDirectory, produceFile } from "./producers";
import { matchingConfigs } from "./runAnything";
import { registerBuiltinTypes } from "./types";

const config = (kind: string, debugAdapter: string | null = null): RunConfig => ({
  id: kind,
  name: kind,
  kind,
  command: "tool",
  args: [],
  cwd: null,
  env: {},
  detected: false,
  isTest: false,
  debugAdapter,
});

let off: (() => void)[];
beforeEach(() => {
  vi.stubEnv("VITE_OPENIDE_JVM", "0");
  off = [registerBuiltinTypes(), registerRunConfigType(remoteJvmType), registerRunConfigType(pythonRemoteType)];
});
afterEach(() => {
  off.forEach((dispose) => dispose());
  vi.unstubAllEnvs();
});

it("excludes JVM types and adapters from default pickers while preserving DS types", () => {
  const kinds = runConfigTypes().map((type) => type.id);
  for (const kind of ["application", "spring-boot", "gradle", "maven", "tomcat", "remote-jvm"])
    expect(kinds).not.toContain(kind);
  expect(kinds).toContain("pytest");
  expect(kinds).toContain(pythonRemoteType.id);
  expect(showDebugAdapter("java-debug")).toBe(false);
  expect(showDebugAdapter("kotlin-debug-adapter")).toBe(false);
  expect(showDebugAdapter("debugpy")).toBe(true);
  expect(showDebugAdapter("ark_dap")).toBe(true);
  for (const name of ["jdtls", "java-debug", "lombok", "kotlin-lsp", "kotlin-debug-adapter"])
    expect(showLanguageTool({ name, languages: [] })).toBe(false);
  expect(showLanguageTool({ name: "custom-scala", languages: ["scala"] })).toBe(false);
  expect(showLanguageTool({ name: "debugpy", languages: ["python"] })).toBe(true);
  expect(showLanguageTool({ name: "ark", languages: ["r"] })).toBe(true);
  expect(showRunKind("r")).toBe(true);
});

it("hides saved, detected, pinned, recent and temporary JVM entries without mutating them", () => {
  const jvm = config("application", "java-debug");
  const python = config("python", "debugpy");
  const r = config("r");
  const configs = [jvm, python, r];
  expect(groupConfigs(configs).map((group) => group.kind)).toEqual(["python", "r"]);
  expect(matchingConfigs(configs, "")).toEqual([python, r]);
  const rows = buildRows(configs, "", jvm, [jvm.id], [jvm.id], [jvm.id]);
  expect(rows.some((row) => (row.type === "config" || row.type === "save") && row.config === jvm)).toBe(false);
  expect(
    treeRows(configs, [{ kind: "application", name: "Legacy" }]).some((row) => row.key.includes("application")),
  ).toBe(false);
  expect(configs).toEqual([jvm, python, r]);
  expect(showRunConfig(config("program", "java-debug"))).toBe(false);
});

it("suppresses JVM file/caret/gutter and build-directory producers, not Python/R", () => {
  const input = {
    root: "/p",
    configs: [config("maven")],
    path: "/p/Main.java",
    content: "public class Main { public static void main(String[] args) {} }",
    line: 0,
  };
  for (const path of ["Main.java", "Main.kt", "build.gradle.kts", "Main.scala", "Main.groovy"]) {
    expect(produceFile({ ...input, path: `/p/${path}` }, OPTIMISTIC)).toBeNull();
    expect(produceContext({ ...input, path: `/p/${path}` }, OPTIMISTIC)).toBeNull();
    expect(fileTargets({ ...input, path: `/p/${path}` }, input.content)).toEqual([]);
  }
  expect(produceDirectory({ ...input, path: "/p/src/test/java" })).toBeNull();
  expect(produceFile({ ...input, path: "/p/analysis.py", content: "print(42)" }, OPTIMISTIC)?.config?.kind).toBe(
    "python",
  );
  expect(produceFile({ ...input, path: "/p/analysis.R", content: "print(42)" }, OPTIMISTIC)?.config?.kind).toBe("r");
});

it("explicit diagnostic opt-in restores JVM UI and producers", () => {
  vi.stubEnv("VITE_OPENIDE_JVM", "1");
  expect(runConfigTypes().map((type) => type.id)).toContain("application");
  expect(runConfigTypes().map((type) => type.id)).toContain("remote-jvm");
  expect(showDebugAdapter("java-debug")).toBe(true);
  expect(
    produceFile(
      {
        root: null,
        configs: [],
        path: "/Main.java",
        content: "public class Main { public static void main(String[] args) {} }",
      },
      OPTIMISTIC,
    ),
  ).not.toBeNull();
});

it("offers Python, not JVM adapters, in the real configuration form", async () => {
  const config = {
    id: "python",
    name: "python",
    kind: "python",
    command: "python",
    args: [],
    cwd: null,
    env: {},
    detected: false,
    isTest: false,
    debugAdapter: "debugpy",
  };
  render(
    <ConfigForm config={config} all={[config]} type={undefined} errors={{}} onChange={() => {}} modifyRequest={0} />,
  );
  fireEvent.click(screen.getByLabelText("Debug adapter"));
  expect(await screen.findByRole("option", { name: "debugpy (Python)" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /java-debug|kotlin-debug-adapter/ })).toBeNull();
});

it("filters JVM tools from the settings tool list, with an explicit diagnostic opt-in", () => {
  const tools = sampleTools();
  expect(tools.some((tool) => tool.name === "kotlin-lsp")).toBe(true);
  expect(filterTools(tools, "", "all").some((tool) => tool.name === "kotlin-lsp")).toBe(false);
  vi.stubEnv("VITE_OPENIDE_JVM", "1");
  expect(filterTools(tools, "", "all").some((tool) => tool.name === "kotlin-lsp")).toBe(true);
});
