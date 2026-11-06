/** Removed built-ins stay recognizable so legacy settings cannot launch them. */

const JVM_RUN_KINDS = new Set([
  "application",
  "spring-boot",
  "tomcat",
  "maven",
  "gradle",
  "remote-jvm",
  "java",
  "java-file",
  "kotlin",
  "kotlinc",
  "scala-cli",
  "scala",
  "jsp",
  "groovy",
  "clojure",
  "android",
]);
const JVM_ADAPTERS = new Set(["java-debug", "kotlin-debug-adapter"]);
const JVM_SETTINGS = new Set(["languages.java", "build.maven", "build.gradle"]);

export const showRunKind = (kind: string) => !JVM_RUN_KINDS.has(kind);
export const showDebugAdapter = (adapter: string | null | undefined) => !JVM_ADAPTERS.has(adapter ?? "");
export const showRunConfig = (config: { kind: string; debugAdapter?: string | null }) =>
  showRunKind(config.kind) && showDebugAdapter(config.debugAdapter);
export const showSettingsPage = (id: string) => !JVM_SETTINGS.has(id);
export const showRunPath = (path: string) =>
  !/\.(java|kt|kts|scala|sc|groovy|gradle|sbt|clj|cljs|cljc|jsp|jspx|tag|tagx)$/i.test(path);

const JVM_LANGUAGES = new Set(["java", "kotlin", "scala", "groovy", "jsp", "clojure"]);
const JVM_TOOLS = new Set([
  "jdtls",
  "java-debug",
  "lombok",
  "kotlin-lsp",
  "kotlin-language-server",
  "kotlin-debug-adapter",
  "clojure-lsp",
  "metals",
  "groovy-language-server",
]);
export const showLanguageTool = (tool: { name: string; languages: readonly string[] }) =>
  !JVM_TOOLS.has(tool.name) &&
  !(tool.languages.length > 0 && tool.languages.every((language) => JVM_LANGUAGES.has(language.toLowerCase())));

/** Preflight the complete launch graph before any process or before-launch task starts. */
export function runConfigIssue(
  config: {
    id: string;
    kind: string;
    debugAdapter?: string | null;
    compound?: string[];
    beforeLaunch?: { kind: string; target?: string }[];
  },
  configs: readonly (typeof config)[],
  ancestors: readonly string[] = [],
): string | null {
  if (!showRunConfig(config)) return "This run configuration uses a removed JVM toolchain.";
  if (ancestors.includes(config.id)) return "Run configurations contain a dependency cycle.";
  const ids = [
    ...(config.kind === "compound" ? (config.compound ?? []) : []),
    ...(config.beforeLaunch ?? []).filter((task) => task.kind === "run").map((task) => task.target ?? ""),
  ];
  if (config.kind === "compound" && !config.compound?.length)
    return "A compound configuration has no runnable targets.";
  for (const id of ids) {
    const child = configs.find((candidate) => candidate.id === id);
    if (!child) return "A referenced run configuration is missing.";
    const issue = runConfigIssue(child, configs, [...ancestors, config.id]);
    if (issue) return issue;
  }
  return null;
}
