import { create } from "zustand";
import type { Runtime } from "./backend";
import { ConsoleSession } from "./session";

export const useConsoles = create<{
  sessions: ConsoleSession[];
  active: string | null;
}>(() => ({ sessions: [], active: null }));

export function newConsole(runtime: Runtime) {
  if (!runtime.selection.trim() || (runtime.language === "r") !== runtime.selection.startsWith("ark|"))
    throw new Error("Console language does not match runtime selection");
  const session = new ConsoleSession(crypto.randomUUID(), runtime);
  useConsoles.setState((s) => ({ sessions: [...s.sessions, session], active: session.id }));
  return session;
}
export function targetConsole(id: string, language?: "python" | "r") {
  const session = useConsoles.getState().sessions.find((s) => s.id === id);
  if (!session || (language && session.runtime.language !== language))
    throw new Error("Console session/language mismatch");
  return session;
}
export async function closeConsole(id: string) {
  await targetConsole(id).close();
  useConsoles.setState((s) => {
    const sessions = s.sessions.filter((session) => session.id !== id);
    return { sessions, active: s.active === id ? (sessions.at(-1)?.id ?? null) : s.active };
  });
}
