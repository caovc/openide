import { useState } from "react";
import { useTx } from "@/platform/i18n";
import { Dialog } from "@/ui/Dialog";
import type { EditorRunController } from "./controller";
import styles from "./Picker.module.css";

export function EditorRunPicker({ controller }: { controller: EditorRunController }) {
  const state = controller.usePicker();
  const tx = useTx();
  const [targetId, setTargetId] = useState("");
  const [runtimeSelection, setRuntimeSelection] = useState("");
  const { request, targets, runtimes, working, loading, error } = state;
  if (!request) return null;
  const target = targets.find((t) => t.consoleId === targetId);
  const runtime = runtimes.find((r) => r.selection === runtimeSelection);
  return (
    <Dialog
      open
      onClose={controller.dismiss}
      title={tx("Run in Console")}
      width={640}
      buttons={[
        { label: "Cancel", role: "cancel" },
        {
          label: "Run",
          role: "default",
          disabled: !target || target.busy || target.closing || working || loading,
          onClick: () => {
            if (target) void controller.choose(target);
          },
        },
      ]}
    >
      <div className={styles.content}>
        <p>
          {request.source.language === "r" ? "R / Ark" : "Python"} — {request.source.path}:{request.source.startLine}–
          {request.source.endLine}
        </p>
        <p>{tx("Code runs in the selected Console. Output, errors and Stop are available there.")}</p>
        <pre className={styles.source}>{request.source.source}</pre>
        <label>
          {tx("Console target")}
          <select
            aria-label={tx("Console target")}
            value={target?.consoleId ?? ""}
            disabled={working || loading}
            onChange={(e) => setTargetId(e.target.value)}
          >
            <option value="">{tx("Choose a Console")}</option>
            {targets.map((t) => (
              <option key={t.consoleId} value={t.consoleId} disabled={t.busy || t.closing}>
                {t.consoleId} — {t.selection} ({t.generation})
                {t.busy ? ` — ${tx("Busy")}` : t.closing ? ` — ${tx("Closing")}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          {tx("Notebook kernel")}
          <select
            aria-label={tx("Notebook kernel")}
            value={runtime?.selection ?? ""}
            disabled={working || loading}
            onChange={(e) => setRuntimeSelection(e.target.value)}
          >
            <option value="">{tx("Select notebook kernel")}</option>
            {runtimes.map((r) => (
              <option key={r.selection} value={r.selection}>
                {r.name} — {r.selection}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.buttons}>
          <button
            disabled={!runtime || working || loading}
            onClick={() => {
              if (runtime) void controller.create(runtime);
            }}
          >
            {tx("Create Console and Run")}
          </button>
          <button disabled={working || loading} onClick={() => void controller.refresh()}>
            {tx("Refresh notebook kernels")}
          </button>
        </div>
        {!loading && !runtimes.length && (
          <p>
            {request.source.language === "r"
              ? tx(
                  "Install Ark and an R distribution (set R_HOME or put R on PATH), then refresh kernels. OpenIDE does not fall back to Python when an Ark kernel is selected.",
                )
              : tx(
                  "Install Python with ipykernel, then refresh kernels or create a Python Console from the Console window.",
                )}
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </Dialog>
  );
}
