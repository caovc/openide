import { useEffect, useState } from "react";
import type { PythonEnvironmentInfo, RProjectEnvironment } from "@/bindings";
import { executeAction } from "@/platform/actions";
import { useTx } from "@/platform/i18n";
import { runtimeEnvironmentBackend } from "@/platform/runtimeEnvironment";
import styles from "./RuntimeEnvironmentDetails.module.css";

type Result =
  | { kind: "python"; info: PythonEnvironmentInfo }
  | { kind: "r"; info: RProjectEnvironment; ark: string; home: string };

export function RuntimeEnvironmentDetails({
  selection,
  near = null,
  label,
}: {
  selection: string | null;
  near?: string | null;
  label?: string;
}) {
  const tx = useTx();
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    selection: string;
    near: string | null;
    revision: number;
    value?: Result;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!open || !selection) return;
    let active = true;
    const load = async (): Promise<Result> => {
      if (!selection.startsWith("ark|"))
        return { kind: "python", info: await runtimeEnvironmentBackend.python(selection) };
      const parts = selection.split("|");
      const absolute = (path: string) =>
        path.startsWith("/") || path.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(path);
      if (parts.length !== 3 || !parts[1] || !parts[2] || !absolute(parts[1]) || !absolute(parts[2]))
        throw new Error(tx("Invalid R environment selection"));
      return { kind: "r", info: await runtimeEnvironmentBackend.rProject(near), ark: parts[1], home: parts[2] };
    };
    void load().then(
      (value) => {
        if (active) setResult({ selection, near, revision, value });
      },
      (error: unknown) => {
        if (active) setResult({ selection, near, revision, error: String(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [open, selection, near, revision, tx]);
  const current =
    result?.selection === selection && result.near === near && result.revision === revision ? result : null;
  const value = current?.value;
  return (
    <details className={styles.root} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{label ?? tx("Environment details")}</summary>
      {open && (
        <div className={styles.body}>
          <p>{tx("Changing project defaults does not change running sessions.")}</p>
          {!selection && <p>{tx("Select notebook kernel")}</p>}
          {selection && !selection.startsWith("ark|") && <code className={styles.path}>{selection}</code>}
          {selection && !current && <p role="status">{tx("Checking environment…")}</p>}
          {current?.error && <p role="alert">{current.error}</p>}
          {value?.kind === "python" && (
            <>
              <dl>
                <dt>{tx("Interpreter")}</dt>
                <dd>{value.info.executable}</dd>
                <dt>{tx("Version")}</dt>
                <dd>{value.info.version}</dd>
                <dt>{tx("Environment prefix")}</dt>
                <dd>{value.info.prefix}</dd>
                <dt>{tx("Base environment prefix")}</dt>
                <dd>{value.info.basePrefix}</dd>
                <dt>{tx("Virtual environment")}</dt>
                <dd>{tx(value.info.isVirtualenv ? "Yes" : "No")}</dd>
                {(["ipykernel", "debugpy", "pip"] as const).map((name) => (
                  <div className={styles.module} key={name}>
                    <dt>{name}</dt>
                    <dd>{tx(value.info[name] ? "Module found" : "Module not found")}</dd>
                  </div>
                ))}
              </dl>
              {!value.info.ipykernel && (
                <p>
                  {tx(
                    "Install ipykernel in the selected Python environment, then restart the kernel. No packages are installed automatically.",
                  )}
                </p>
              )}
              {!value.info.debugpy && <p>{tx("Install debugpy in this interpreter to debug Python scripts.")}</p>}
              <p>{tx("Module discovery does not verify that a package can run successfully.")}</p>
            </>
          )}
          {value?.kind === "r" && (
            <>
              <dl>
                <dt>Ark</dt>
                <dd>{value.ark}</dd>
                <dt>R_HOME</dt>
                <dd>{value.home}</dd>
                <dt>{tx("Project root")}</dt>
                <dd>{value.info.projectRoot}</dd>
                <dt>renv</dt>
                <dd>
                  {tx(
                    value.info.renvStatus === "not-present"
                      ? "No renv project detected"
                      : value.info.renvStatus === "detected-inactive"
                        ? "renv detected; activation not verified"
                        : "renv project unavailable",
                  )}
                </dd>
                {value.info.lockedRVersion && (
                  <>
                    <dt>{tx("Locked R version")}</dt>
                    <dd>{value.info.lockedRVersion}</dd>
                  </>
                )}
                {value.info.lockedPackageCount !== null && (
                  <>
                    <dt>{tx("Locked packages")}</dt>
                    <dd>{value.info.lockedPackageCount}</dd>
                  </>
                )}
              </dl>
              <p>
                {tx(
                  "Project files are inspected without running R startup scripts. A lockfile does not mean renv is active in this session.",
                )}
              </p>
              {value.info.diagnostics.map((message, index) => (
                <p role="status" key={index}>
                  {message}
                </p>
              ))}
            </>
          )}
          <div className={styles.buttons}>
            <button type="button" disabled={!selection} onClick={() => setRevision((v) => v + 1)}>
              {tx("Refresh environment details")}
            </button>
            {(!selection || !selection.startsWith("ark|")) && (
              <button type="button" onClick={() => void executeAction("python.interpreterSettings")}>
                {tx("Manage Python environments")}
              </button>
            )}
          </div>
        </div>
      )}
    </details>
  );
}
