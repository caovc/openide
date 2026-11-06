import { Channel } from "@tauri-apps/api/core";
import type { NotebookOutputEvent, NotebookSnapshot, RequestId } from "@/bindings";
import { call, commands, nextRequestId } from "@/platform/ipc";

export interface Runtime {
  selection: string;
  name: string;
  language: "python" | "r";
  isProjectDefault?: boolean;
}
export const consoleBackend = {
  open: (key: string) => call(commands.notebookOpen(`openide-console:${key}`)),
  get: (id: string) => call(commands.notebookGet(id)),
  insert: (s: NotebookSnapshot) =>
    call(
      commands.notebookEdit(s.id, s.version, {
        type: "insertCell",
        after: s.cells.at(-1)?.id ?? null,
        cellType: "code",
      }),
    ),
  source: (s: NotebookSnapshot, cell: string, source: string) =>
    call(commands.notebookEdit(s.id, s.version, { type: "setSource", cell, source })),
  execute: (
    s: NotebookSnapshot,
    cell: string,
    selection: string,
    request: RequestId,
    receive: (e: NotebookOutputEvent) => void,
  ) => {
    const channel = new Channel<NotebookOutputEvent>();
    channel.onmessage = receive;
    return call(commands.notebookExecute(s.id, [cell], selection, request, channel));
  },
  request: nextRequestId,
  cancel: (request: RequestId) => commands.cancelRequest(request),
  interrupt: (id: string) => call(commands.notebookInterrupt(id)),
  stop: (id: string) => call(commands.notebookStopKernel(id)),
  close: (id: string) => call(commands.notebookClose(id)),
  reply: (id: string, prompt: string, value: string | null) => call(commands.notebookInputReply(id, prompt, value)),
  runtimes: async (): Promise<Runtime[]> => {
    const results = await Promise.allSettled([
      call(commands.sdkDetect("python")),
      call(commands.notebookDetectRuntimes()),
      call(commands.sdkPythonEffective(null)),
    ]);
    const runtimes: Runtime[] = [];
    const [python, ark, effective] = results;
    if (python.status === "fulfilled")
      for (const sdk of python.value) runtimes.push({ selection: sdk.path, name: sdk.name, language: "python" });
    if (ark.status === "fulfilled")
      for (const runtime of ark.value) runtimes.push({ selection: runtime.id, name: runtime.name, language: "r" });
    if (effective.status === "fulfilled" && effective.value) {
      const selected = runtimes.find((r) => r.selection === effective.value);
      if (selected) selected.isProjectDefault = true;
      else
        runtimes.unshift({
          selection: effective.value,
          name: effective.value,
          language: "python",
          isProjectDefault: true,
        });
    }
    if (!runtimes.length && results.some((r) => r.status === "rejected"))
      throw new Error(
        results
          .filter((r) => r.status === "rejected")
          .map((r) => String(r.reason))
          .join("\n"),
      );
    return runtimes;
  },
};
export type ConsoleBackend = typeof consoleBackend;
