/** OpenIDE's DS surface. Legacy JVM implementations remain available for diagnosis. */
export const jvmEnabled = () => import.meta.env.VITE_OPENIDE_JVM === "1";

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
  "groovy",
  "clojure",
]);
const JVM_ADAPTERS = new Set(["java-debug", "kotlin-debug-adapter"]);
const JVM_SETTINGS = new Set(["languages.java", "build.maven", "build.gradle"]);

export const showRunKind = (kind: string) => jvmEnabled() || !JVM_RUN_KINDS.has(kind);
export const showDebugAdapter = (adapter: string | null | undefined) =>
  jvmEnabled() || !JVM_ADAPTERS.has(adapter ?? "");
export const showRunConfig = (config: { kind: string; debugAdapter?: string | null }) =>
  showRunKind(config.kind) && showDebugAdapter(config.debugAdapter);
export const showSettingsPage = (id: string) => jvmEnabled() || !JVM_SETTINGS.has(id);
export const showRunPath = (path: string) =>
  jvmEnabled() || !/\.(java|kt|kts|scala|sc|groovy|gradle|sbt|clj|cljs|cljc|jsp|jspx|tag|tagx)$/i.test(path);

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
  jvmEnabled() ||
  (!JVM_TOOLS.has(tool.name) &&
    !(tool.languages.length > 0 && tool.languages.every((language) => JVM_LANGUAGES.has(language.toLowerCase()))));
