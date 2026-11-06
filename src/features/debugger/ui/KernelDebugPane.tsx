import { useEffect, useMemo, useRef, useState } from "react";
import { executeAction } from "@/platform/actions";
import { useTx } from "@/platform/i18n";
import { IconButton, SplitGroup, SplitPanel, SplitHandle } from "@/ui";
import {
  addKernelWatch,
  kernelVariables,
  removeKernelWatch,
  selectKernelFrame,
  useKernelDebug,
  type KernelDebugSession,
} from "../kernel";
import { VariablesView, type VarRoot } from "./VariablesView";
import styles from "./DebugToolWindow.module.css";
import kernelStyles from "./KernelDebugPane.module.css";

export function KernelDebugPane({ session }: { session: KernelDebugSession }) {
  const tx = useTx();
  const [expression, setExpression] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const focus = useKernelDebug((state) => state.evaluateFocus);
  useEffect(() => {
    if (focus) input.current?.focus();
  }, [focus]);
  const paused = session.status === "paused" && !session.busy;
  const roots = useMemo<VarRoot[]>(
    () => [
      ...session.evaluations.map((row): VarRoot => ({
        key: `watch:${row.expression}`,
        kind: "watch",
        name: row.expression,
        variable: row.value,
        error: row.error,
      })),
      ...session.scopes.map((scope, index): VarRoot => ({
        key: `scope:${index}:${scope.name}`,
        kind: "scope",
        name: scope.name,
        reference: scope.reference,
        expensive: scope.expensive,
      })),
    ],
    [session.evaluations, session.scopes],
  );
  const load = useMemo(() => (reference: number) => kernelVariables(session, reference), [session]);
  return (
    <div className={styles.root}>
      <div className={styles.toolbar} role="toolbar" aria-label={tx("Debugger actions")}>
        <IconButton
          icon="stop"
          title="Disconnect Notebook Debugger"
          disabled={session.busy}
          onClick={() => void executeAction("debug.stop")}
        />
        <IconButton
          icon="resume"
          title="Resume Program"
          disabled={!paused}
          onClick={() => void executeAction("debug.resume")}
        />
        <IconButton
          icon="step-over"
          title="Step Over"
          disabled={!paused}
          onClick={() => void executeAction("debug.stepOver")}
        />
        <IconButton
          icon="step-into"
          title="Step Into"
          disabled={!paused}
          onClick={() => void executeAction("debug.stepInto")}
        />
        <IconButton
          icon="step-out"
          title="Step Out"
          disabled={!paused}
          onClick={() => void executeAction("debug.stepOut")}
        />
        <span role="status">
          {tx(
            session.status === "paused"
              ? "Suspended"
              : session.status === "unknown"
                ? "Debugger state unavailable"
                : "Running…",
          )}
        </span>
      </div>
      {session.error && (
        <div role="alert" className={kernelStyles.error}>
          {session.error}
        </div>
      )}
      <SplitGroup orientation="horizontal" id="debug-kernel-threads-variables" className={styles.split}>
        <SplitPanel id="frames" defaultSize="34%" minSize="160px">
          <div className={styles.frameList} role="listbox" aria-label={tx("Frames")}>
            {session.frames.map((frame) => (
              <button
                key={frame.id}
                type="button"
                role="option"
                aria-selected={frame.id === session.frame}
                className={styles.frame}
                disabled={!paused}
                onClick={() => void selectKernelFrame(session, frame.id)}
              >
                {frame.name} · {frame.line}
              </button>
            ))}
          </div>
        </SplitPanel>
        <SplitHandle />
        <SplitPanel id="variables" minSize="200px">
          <div className={kernelStyles.variables}>
            <form
              className={kernelStyles.watch}
              onSubmit={(event) => {
                event.preventDefault();
                addKernelWatch(expression, session);
                setExpression("");
              }}
            >
              <input
                ref={input}
                aria-label={tx("Watch expression")}
                value={expression}
                disabled={!paused || session.frame == null}
                onChange={(event) => setExpression(event.target.value)}
              />
              <button disabled={!paused || session.frame == null || !expression.trim()}>{tx("Add Watch")}</button>
            </form>
            <VariablesView
              key={`${session.key}:${session.epoch}:${session.frameEpoch}:${session.scopes.map((scope) => scope.reference).join(",")}`}
              session={null}
              roots={roots}
              generation={session.frameEpoch}
              loadVariables={load}
              readOnly
              defaultExpanded={session.scopes
                .flatMap((scope, index) => (!scope.expensive ? [`scope:${index}:${scope.name}`] : []))
                .slice(0, 1)}
              onAddWatch={(expression) => addKernelWatch(expression, session)}
              onRemoveWatch={(expression) => removeKernelWatch(expression, session)}
              aria-label="Variables"
            />
          </div>
        </SplitPanel>
      </SplitGroup>
    </div>
  );
}
