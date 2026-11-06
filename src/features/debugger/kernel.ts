import { create } from "zustand";
import { tx } from "@/platform/i18n";
import type { Variable } from "@/bindings";
import {
  toolWindowService,
  type KernelDebugTarget,
  type KernelDebugHandle,
  type KernelDebugIdentity,
  type KernelDebugFrame,
} from "@/workbench/contributions";

export type DebugTargetSelection = KernelDebugIdentity | { kind: "script"; sessionId: number } | null;
export interface KernelDebugSession {
  key: string;
  target: KernelDebugTarget;
  status: "running" | "paused" | "unknown";
  epoch: number;
  frameEpoch: number;
  thread: number | null;
  frames: KernelDebugFrame[];
  frame: number | null;
  scopes: { name: string; reference: number; expensive: boolean }[];
  watches: string[];
  evaluations: { expression: string; value: Variable | null; error: string | null }[];
  error: string | null;
  busy: boolean;
}
export const useKernelDebug = create<{
  sessions: Record<string, KernelDebugSession>;
  selected: DebugTargetSelection;
  evaluateFocus: number;
}>(() => ({ sessions: {}, selected: null, evaluateFocus: 0 }));
export const kernelKey = (identity: KernelDebugIdentity) => JSON.stringify([identity.documentId, identity.token]);
export function activeKernelDebug(): KernelDebugSession | null {
  const state = useKernelDebug.getState();
  return state.selected?.kind === "kernel" ? (state.sessions[kernelKey(state.selected)] ?? null) : null;
}
export function selectScriptDebugTarget(sessionId: number | null) {
  useKernelDebug.setState({ selected: sessionId == null ? null : { kind: "script", sessionId } });
}
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const number = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : fallback;
const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const rows = (value: unknown) => (Array.isArray(value) ? value.map(record) : []);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
function current(session: KernelDebugSession, epoch = session.epoch, frameEpoch?: number) {
  const live = useKernelDebug.getState().sessions[session.key];
  return (
    live?.target === session.target &&
    live.epoch === epoch &&
    (frameEpoch === undefined || live.frameEpoch === frameEpoch)
  );
}
function patch(session: KernelDebugSession, data: Partial<KernelDebugSession>) {
  useKernelDebug.setState((state) => {
    const live = state.sessions[session.key];
    return live?.target === session.target
      ? { sessions: { ...state.sessions, [session.key]: { ...live, ...data } } }
      : state;
  });
}
class RejectedResponse extends Error {}
async function request(session: KernelDebugSession, command: string, args: Record<string, unknown>) {
  if (!current(session)) throw new Error(tx("Notebook debug target is no longer available"));
  const raw = record(await session.target.request(command, args));
  if (!current(session)) throw new Error(tx("Notebook debug target changed while waiting for a reply"));
  if (raw.success !== true) throw new RejectedResponse(text(raw.message, tx("The debugger rejected the request.")));
  return record(raw.body);
}
function variable(raw: Record<string, unknown>): Variable {
  return {
    name: text(raw.name),
    value: text(raw.value ?? raw.result),
    typeName: typeof raw.type === "string" ? raw.type : null,
    variablesReference: number(raw.variablesReference),
    evaluateName: typeof raw.evaluateName === "string" ? raw.evaluateName : null,
  };
}
export async function kernelVariables(session: KernelDebugSession, reference: number): Promise<Variable[]> {
  if (session.status !== "paused" || !current(session, session.epoch, session.frameEpoch))
    throw new Error(tx("Notebook is not suspended at this frame"));
  const body = await request(session, "variables", { variablesReference: reference });
  if (!current(session, session.epoch, session.frameEpoch)) throw new Error(tx("Notebook stack frame changed"));
  return rows(body.variables).map(variable);
}
async function evaluations(session: KernelDebugSession) {
  if (session.frame == null || session.status !== "paused") return;
  const results = await Promise.all(
    session.watches.map(async (expression) => {
      try {
        const result = await request(session, "evaluate", { expression, frameId: session.frame, context: "watch" });
        return { expression, value: variable({ ...result, name: expression }), error: null };
      } catch (error) {
        return { expression, value: null, error: message(error) };
      }
    }),
  );
  if (
    current(session, session.epoch, session.frameEpoch) &&
    useKernelDebug.getState().sessions[session.key]?.watches === session.watches
  )
    patch(session, { evaluations: results });
}
export async function selectKernelFrame(session: KernelDebugSession, frame: number) {
  if (!current(session) || session.status !== "paused") return;
  const live = useKernelDebug.getState().sessions[session.key];
  if (!live) return;
  const frameEpoch = live.frameEpoch + 1;
  patch(session, { frame, frameEpoch, scopes: [], evaluations: [], error: null });
  const selected = useKernelDebug.getState().sessions[session.key];
  if (!selected) return;
  const source = selected.frames.find((f) => f.id === frame);
  if (source && activeKernelDebug()?.target === selected.target)
    void selected.target.revealFrame(source).catch((error) => {
      if (current(selected, selected.epoch, frameEpoch)) patch(selected, { error: message(error) });
    });
  void evaluations(selected);
  try {
    const body = await request(selected, "scopes", { frameId: frame });
    if (!current(selected, selected.epoch, frameEpoch)) return;
    const scopes = rows(body.scopes)
      .filter((scope) => number(scope.variablesReference) > 0)
      .map((scope) => ({
        name: text(scope.name),
        reference: number(scope.variablesReference),
        expensive: scope.expensive === true,
      }));
    if (current(selected, selected.epoch, frameEpoch)) patch(selected, { scopes });
  } catch (error) {
    if (current(selected, selected.epoch, frameEpoch)) patch(selected, { error: message(error) });
  }
}
async function stopped(session: KernelDebugSession, body: Record<string, unknown>) {
  patch(session, {
    status: "paused",
    epoch: session.epoch + 1,
    frameEpoch: session.frameEpoch + 1,
    frames: [],
    frame: null,
    scopes: [],
    evaluations: [],
    thread: typeof body.threadId === "number" && Number.isSafeInteger(body.threadId) ? body.threadId : null,
    busy: false,
    error: null,
  });
  const paused = useKernelDebug.getState().sessions[session.key];
  if (!paused) return;
  try {
    let thread = paused.thread;
    if (thread == null) {
      const candidate = rows((await request(paused, "threads", {})).threads)[0]?.id;
      thread = typeof candidate === "number" && Number.isSafeInteger(candidate) ? candidate : null;
    }
    if (!current(paused)) return;
    if (thread == null) throw new Error(tx("Notebook debugger returned no thread"));
    patch(paused, { thread });
    const stack = await request(paused, "stackTrace", { threadId: thread, startFrame: 0, levels: 100 });
    if (!current(paused)) return;
    const frames = rows(stack.stackFrames).map((raw): KernelDebugFrame => ({
      id: number(raw.id),
      name: text(raw.name),
      line: number(raw.line, 1),
      column: number(raw.column, 1),
      source: raw.source
        ? {
            path: typeof record(raw.source).path === "string" ? text(record(raw.source).path) : undefined,
            sourceReference:
              typeof record(raw.source).sourceReference === "number"
                ? number(record(raw.source).sourceReference)
                : undefined,
          }
        : null,
    }));
    patch(paused, { frames });
    const live = useKernelDebug.getState().sessions[session.key];
    if (frames[0] && live) await selectKernelFrame(live, frames[0].id);
  } catch (error) {
    if (current(paused)) patch(paused, { error: message(error) });
  }
}
function resumed(session: KernelDebugSession) {
  patch(session, {
    status: "running",
    epoch: session.epoch + 1,
    frameEpoch: session.frameEpoch + 1,
    frames: [],
    frame: null,
    scopes: [],
    evaluations: [],
    busy: false,
  });
}
export function registerKernelTarget(target: KernelDebugTarget): KernelDebugHandle {
  const key = kernelKey(target.identity);
  const session: KernelDebugSession = {
    key,
    target,
    status: "running",
    epoch: 0,
    frameEpoch: 0,
    thread: null,
    frames: [],
    frame: null,
    scopes: [],
    watches: [],
    evaluations: [],
    error: null,
    busy: false,
  };
  useKernelDebug.setState((state) => ({ sessions: { ...state.sessions, [key]: session }, selected: target.identity }));
  const focus = () => {
    if (useKernelDebug.getState().sessions[key]?.target !== target) return;
    useKernelDebug.setState({ selected: target.identity });
    toolWindowService().show("debug", true);
  };
  const dispose = () => {
    useKernelDebug.setState((state) => {
      if (state.sessions[key]?.target !== target) return state;
      const sessions = { ...state.sessions };
      delete sessions[key];
      return {
        sessions,
        selected: state.selected?.kind === "kernel" && kernelKey(state.selected) === key ? null : state.selected,
      };
    });
  };
  focus();
  return {
    focus,
    dispose,
    event: (event) => {
      const live = useKernelDebug.getState().sessions[key];
      if (live?.target !== target) return;
      if (event.event === "stopped") void stopped(live, record(event.body));
      else if (event.event === "continued") resumed(live);
      else if (event.event === "terminated" || event.event === "exited") dispose();
      else if (event.event === "invalidated" && live.status === "paused") void stopped(live, { threadId: live.thread });
    },
  };
}
export function focusKernelTarget(session: KernelDebugSession): boolean {
  if (useKernelDebug.getState().sessions[session.key]?.target === session.target) {
    useKernelDebug.setState({ selected: session.target.identity });
    toolWindowService().show("debug", true);
    return true;
  }
  return false;
}
export async function kernelControl(command: "continue" | "next" | "stepIn" | "stepOut" | "disconnect") {
  const session = activeKernelDebug();
  if (!session || session.busy) return;
  if (command !== "disconnect" && (session.status !== "paused" || session.thread == null)) return;
  // Revoke pause/frame handles before sending a command that may resume execution.
  resumed(session);
  const pending = useKernelDebug.getState().sessions[session.key];
  if (!pending) return;
  patch(pending, { busy: true, error: null });
  try {
    if (command === "disconnect") {
      await pending.target.disconnect();
      if (useKernelDebug.getState().sessions[pending.key]?.target === pending.target)
        useKernelDebug.setState((state) => {
          const sessions = { ...state.sessions };
          delete sessions[pending.key];
          return {
            sessions,
            selected:
              state.selected?.kind === "kernel" && kernelKey(state.selected) === pending.key ? null : state.selected,
          };
        });
    } else {
      await request(pending, command, { threadId: session.thread });
      if (current(pending)) patch(pending, { busy: false });
    }
  } catch (error) {
    if (!current(pending)) return;
    if (error instanceof RejectedResponse && command !== "disconnect") {
      await stopped(pending, { threadId: session.thread });
      const live = useKernelDebug.getState().sessions[pending.key];
      if (live?.target === pending.target && live.epoch === pending.epoch + 1)
        patch(live, { busy: false, error: message(error) });
    } else patch(pending, { status: "unknown", busy: false, error: message(error) });
  }
}
export function addKernelWatch(expression: string, selected = activeKernelDebug()) {
  if (
    !selected ||
    activeKernelDebug()?.target !== selected.target ||
    !current(selected, selected.epoch, selected.frameEpoch) ||
    !expression.trim()
  )
    return;
  const live = useKernelDebug.getState().sessions[selected.key];
  if (!live || live.status !== "paused" || live.busy || live.frame == null) return;
  const watches = [...new Set([...live.watches, expression.trim()])];
  patch(live, { watches });
  const updated = useKernelDebug.getState().sessions[live.key];
  if (updated) void evaluations(updated);
}
export function removeKernelWatch(expression: string, selected = activeKernelDebug()) {
  if (
    !selected ||
    activeKernelDebug()?.target !== selected.target ||
    !current(selected, selected.epoch, selected.frameEpoch)
  )
    return;
  const live = useKernelDebug.getState().sessions[selected.key];
  if (!live) return;
  patch(live, {
    watches: live.watches.filter((value) => value !== expression),
    evaluations: live.evaluations.filter((value) => value.expression !== expression),
  });
}
export function focusKernelEvaluate() {
  if (activeKernelDebug()) {
    toolWindowService().show("debug", true);
    useKernelDebug.setState((state) => ({ evaluateFocus: state.evaluateFocus + 1 }));
  }
}
export function resetKernelTargets() {
  useKernelDebug.setState({ sessions: {}, selected: null });
}
