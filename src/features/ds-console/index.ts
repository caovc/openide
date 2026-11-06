import { registerActions } from "@/platform/actions";
import { useProject } from "@/platform/project";
import { registerToolWindow, toolWindowService } from "@/workbench/contributions";
import { ConsoleView } from "./ConsoleView";
import type { Runtime } from "./backend";
import { closeConsole, newConsole, targetConsole, useConsoles } from "./store";

export function activate() {
  const run = async (id: string, operation: "cancel" | "restart" | "close") => {
    const session = targetConsole(id);
    try {
      if (operation === "close") await closeConsole(id);
      else await session[operation]();
    } catch (error) {
      session.report(error);
    }
  };
  const dispose = [
    registerToolWindow({
      id: "ds-console",
      title: "Console",
      icon: "toolwindow-terminal",
      anchor: "bottom",
      order: 11,
      component: ConsoleView,
    }),
    registerActions([
      {
        id: "ds.console.targets",
        title: "Console",
        category: "Console",
        hidden: true,
        run: ({ arg }) => {
          if (typeof arg === "function")
            arg(
              useConsoles.getState().sessions.map((session) => ({
                ...session.target(),
                busy: session.getState().busy,
                closing: session.getState().closing,
              })),
            );
        },
      },
      {
        id: "ds.console.new",
        title: "New…",
        category: "Console",
        when: "projectOpen",
        run: ({ arg }) => {
          const runtime = arg as Runtime | undefined;
          if (
            runtime &&
            typeof runtime.selection === "string" &&
            typeof runtime.name === "string" &&
            (runtime.language === "r" || runtime.language === "python")
          )
            newConsole(runtime);
          toolWindowService().show("ds-console", true);
        },
      },
      {
        id: "ds.console.select",
        title: "Console",
        hidden: true,
        run: ({ arg }) => {
          if (typeof arg === "string") {
            targetConsole(arg);
            useConsoles.setState({ active: arg });
          }
        },
      },
      {
        id: "ds.console.execute",
        title: "Run",
        category: "Console",
        hidden: true,
        when: "projectOpen",
        run: async ({ arg }) => {
          const a = arg as { id?: unknown; language?: unknown; source?: unknown } | undefined;
          if (
            !a ||
            typeof a.id !== "string" ||
            typeof a.source !== "string" ||
            (a.language !== "python" && a.language !== "r")
          )
            throw new Error("Console execute requires id, language and source");
          const session = targetConsole(a.id, a.language);
          try {
            await session.execute(a.source);
          } catch (error) {
            session.report(error);
          }
        },
      },
      ...(["cancel", "restart", "close"] as const).map((operation) => ({
        id: `ds.console.${operation}`,
        title: { cancel: "Stop", restart: "Restart", close: "Close" }[operation],
        category: "Console",
        hidden: true,
        run: ({ arg }: { arg?: unknown }) => (typeof arg === "string" ? run(arg, operation) : undefined),
      })),
      {
        id: "ds.console.reply",
        title: "Reply to kernel",
        hidden: true,
        run: async ({ arg }) => {
          const a = arg as { id?: unknown; value?: unknown } | undefined;
          if (a && typeof a.id === "string" && (typeof a.value === "string" || a.value === null))
            await targetConsole(a.id).reply(a.value);
        },
      },
    ]),
    useProject.subscribe((s, previous) => {
      if (s.project?.root !== previous.project?.root) {
        const old = useConsoles.getState().sessions;
        useConsoles.setState({ sessions: [], active: null });
        for (const session of old) void session.close().catch((e) => session.report(e));
      }
    }),
  ];
  return () => {
    dispose.reverse().forEach((d) => d());
    for (const session of useConsoles.getState().sessions) void session.close().catch((e) => session.report(e));
    useConsoles.setState({ sessions: [], active: null });
  };
}
