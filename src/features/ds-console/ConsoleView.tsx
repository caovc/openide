import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { executeAction } from "@/platform/actions";
import { useTx } from "@/platform/i18n";
import { useProject } from "@/platform/project";
import { consoleBackend, type Runtime } from "./backend";
import { useConsoles } from "./store";
import type { ConsoleSession } from "./session";
import styles from "./Console.module.css";
import { RuntimeEnvironmentDetails } from "@/ui/RuntimeEnvironmentDetails";

function InputReply({ session }: { session: ConsoleSession }) {
  const tx = useTx();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  if (!state.input) return null;
  const reply = (answer: string | null) => {
    if (sending) return;
    setSending(true);
    setValue("");
    void executeAction("ds.console.reply", { id: session.id, value: answer }).finally(() => setSending(false));
  };
  return (
    <form
      className={styles.controls}
      onSubmit={(e) => {
        e.preventDefault();
        reply(value);
      }}
    >
      <label>
        {state.input.prompt}
        <input
          autoFocus
          aria-label={tx("Kernel input")}
          type={state.input.password ? "password" : "text"}
          autoComplete="off"
          value={value}
          disabled={sending}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <button disabled={sending}>{tx("Reply to kernel")}</button>
      <button type="button" disabled={sending} onClick={() => reply(null)}>
        {tx("Cancel kernel input")}
      </button>
    </form>
  );
}
function SessionView({ session }: { session: ConsoleSession }) {
  const tx = useTx();
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const [source, setSource] = useState("");
  const submit = () => {
    if (state.busy || state.closing || !source.trim()) return;
    const code = source;
    setSource("");
    void executeAction("ds.console.execute", { id: session.id, language: session.runtime.language, source: code });
  };
  return (
    <div className={styles.session}>
      <div className={styles.controls}>
        <span title={session.runtime.selection}>
          {session.runtime.name} · {session.runtime.language === "r" ? "R / Ark" : "Python"}
        </span>
        <button
          disabled={!state.busy || state.closing}
          onClick={() => void executeAction("ds.console.cancel", session.id)}
        >
          {tx("Stop")}
        </button>
        <button
          disabled={state.busy || state.closing}
          onClick={() => void executeAction("ds.console.restart", session.id)}
        >
          {tx("Restart")}
        </button>
        <button disabled={state.closing} onClick={() => void executeAction("ds.console.close", session.id)}>
          {tx("Close")}
        </button>
      </div>
      <RuntimeEnvironmentDetails selection={session.runtime.selection} label={tx("Console environment")} />
      {state.error && <div role="alert">{state.error}</div>}
      <div className={styles.history} role="log" aria-label={tx("Console")}>
        {state.history.map((entry, i) => (
          <section key={i}>
            <pre className={styles.source}>{entry.source}</pre>
            <pre>{entry.output}</pre>
          </section>
        ))}
      </div>
      {state.input && <InputReply key={state.input.requestId} session={session} />}
      <form
        className={styles.controls}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          aria-label={tx("Source")}
          value={source}
          disabled={state.closing}
          onChange={(e) => setSource(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button disabled={state.busy || state.closing || !source.trim()}>{tx("Run")}</button>
      </form>
    </div>
  );
}
export function ConsoleView() {
  const projectRoot = useProject((state) => state.project?.root ?? null);
  return <ProjectConsoleView key={projectRoot ?? "no-project"} />;
}

function ProjectConsoleView() {
  const tx = useTx();
  const { sessions, active } = useConsoles();
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [selection, setSelection] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const refreshState = useRef({ id: 0 });
  const explicitSelection = useRef(false);
  const refresh = () => {
    const id = ++refreshState.current.id;
    setLoading(true);
    setError(null);
    void consoleBackend
      .runtimes()
      .then((values) => {
        if (id !== refreshState.current.id) return;
        setRuntimes(values);
        setSelection((previous) =>
          explicitSelection.current
            ? previous
            : values.find((r) => r.isProjectDefault)?.selection || values[0]?.selection || "",
        );
      })
      .catch((e) => {
        if (id === refreshState.current.id) setError(String(e));
      })
      .finally(() => {
        if (id === refreshState.current.id) setLoading(false);
      });
  };
  useEffect(() => {
    const state = refreshState.current;
    let mounted = true;
    void Promise.resolve().then(() => {
      if (mounted) refresh();
    });
    return () => {
      mounted = false;
      state.id++;
    };
  }, []);
  const session = sessions.find((s) => s.id === active);
  return (
    <div className={styles.root}>
      <div className={styles.controls}>
        <select
          aria-label={tx("Notebook kernel")}
          value={selection}
          onChange={(e) => {
            explicitSelection.current = true;
            setSelection(e.target.value);
          }}
        >
          <option value="">{tx("Select notebook kernel")}</option>
          {selection && !runtimes.some((r) => r.selection === selection) && (
            <option value={selection}>
              {selection} — {tx("Environment unavailable")}
            </option>
          )}
          {runtimes.map((r) => (
            <option key={r.selection} value={r.selection}>
              {r.name} ({r.language === "r" ? "R / Ark" : "Python"}) — {r.selection}
            </option>
          ))}
        </select>
        <button disabled={loading} onClick={refresh}>
          {tx("Refresh notebook kernels")}
        </button>
        <button
          disabled={!selection || loading || !runtimes.some((r) => r.selection === selection)}
          onClick={() =>
            void executeAction(
              "ds.console.new",
              runtimes.find((r) => r.selection === selection),
            )
          }
        >
          {tx("New…")}
        </button>
      </div>
      <RuntimeEnvironmentDetails selection={selection || null} label={tx("New Console environment")} />
      {!loading && !runtimes.length && (
        <p>
          {tx(
            "Install Ark and an R distribution (set R_HOME or put R on PATH), then refresh kernels. OpenIDE does not fall back to Python when an Ark kernel is selected.",
          )}
        </p>
      )}
      {error && <div role="alert">{error}</div>}
      <div className={styles.controls} role="tablist" aria-label={tx("Console")}>
        {sessions.map((s, i) => (
          <button
            role="tab"
            aria-selected={s.id === active}
            key={s.id}
            onClick={() => void executeAction("ds.console.select", s.id)}
          >
            {s.runtime.language === "r" ? "R" : "Python"} {i + 1}
          </button>
        ))}
      </div>
      {session && <SessionView key={session.id} session={session} />}
    </div>
  );
}
