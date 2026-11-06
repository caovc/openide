import { executeAction } from "@/platform/actions";
import { tx } from "@/platform/i18n";
import { call, commands } from "@/platform/ipc";
import type { ConsoleLanguage, ConsoleRuntime, ConsoleTarget } from "./model";

export async function consoleAction(id: string, arg?: unknown): Promise<void> {
  if (!(await executeAction(id, arg))) throw new Error(tx("Console action unavailable. Open a project and try again."));
}

export async function consoleTargets(): Promise<ConsoleTarget[]> {
  let targets: ConsoleTarget[] | undefined;
  await consoleAction("ds.console.targets", (values: ConsoleTarget[]) => {
    targets = values;
  });
  if (!targets) throw new Error(tx("Console targets unavailable. Reopen the project and try again."));
  return targets;
}

export async function discoverRuntimes(language: ConsoleLanguage): Promise<ConsoleRuntime[]> {
  if (language === "python") {
    const sdks = await call(commands.sdkDetect("python"));
    return sdks
      .filter((sdk) => !!sdk.path && !sdk.path.startsWith("ark|"))
      .map((sdk) => ({
        selection: sdk.path,
        name: sdk.name,
        language,
      }));
  }
  const runtimes = await call(commands.notebookDetectRuntimes());
  return runtimes
    .filter((runtime) => runtime.id.startsWith("ark|"))
    .map((runtime) => ({
      selection: runtime.id,
      name: runtime.name,
      language,
    }));
}
