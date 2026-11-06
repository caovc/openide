import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import type { SessionVariable } from "@/bindings";
import { basename } from "@/platform/project";
import { Icon } from "@/ui/icons";
import { panels } from "./runtime";
import type { SessionSource } from "./store";
import styles from "./Session.module.css";

function useSession() {
  const sources = useStore(panels.store, (state) => state.sources);
  const selected = useStore(panels.store, (state) => state.selected);
  return { sources, source: sources.find((source) => source.id === selected) };
}

function SessionPicker({ source, sources }: { source?: SessionSource; sources: SessionSource[] }) {
  return (
    <div className={styles.toolbar}>
      <label className={styles.picker}>
        Session
        <select aria-label="Session" value={source?.id ?? ""} onChange={(event) => panels.select(event.target.value)}>
          {!sources.length && <option value="">No running session</option>}
          {sources.map((item) => (
            <option key={item.id} value={item.id}>
              {basename(item.path)} · {item.snapshot?.language ?? "Session"} · {item.state}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        aria-label="Refresh session"
        title="Refresh session"
        disabled={!source || source.state === "dead"}
        onClick={() => source && void panels.refresh(source.id)}
      >
        <Icon name="refresh" />
      </button>
    </div>
  );
}

function Empty({ source }: { source?: SessionSource }) {
  return (
    <p className={styles.empty} role={source?.error ? "alert" : "status"}>
      {source?.error ??
        source?.snapshot?.error ??
        (!source
          ? "Execute Python or R in a notebook or Console to inspect its session."
          : source.state === "dead"
            ? "Session stopped. Execute again to start a new session."
            : !source.snapshot?.ready
              ? "Waiting for session variables…"
              : "No variables in this session.")}
    </p>
  );
}

function VariableRow({
  variable,
  source,
  path,
  depth = 0,
}: {
  variable: SessionVariable;
  source: SessionSource;
  path: string[];
  depth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<SessionVariable[] | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (children || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await panels.expand(source.id, path);
      if (mounted.current) {
        setChildren(result.variables);
        setTotal(result.total);
      }
    } catch (error) {
      if (mounted.current) setError(String(error));
    } finally {
      if (mounted.current) setLoading(false);
    }
  };
  return (
    <>
      <tr>
        <td>
          <span className={styles.name} style={{ paddingInlineStart: depth * 14 }}>
            {variable.hasChildren && depth < 31 ? (
              <button
                type="button"
                aria-label={`${open ? "Collapse" : "Expand"} ${variable.name}`}
                aria-expanded={open}
                onClick={() => void toggle()}
              >
                <Icon name={open ? "chevron-down" : "chevron-right"} size={12} />
              </button>
            ) : (
              <span className={styles.spacer} />
            )}
            <span title={variable.name}>{variable.name}</span>
          </span>
        </td>
        <td title={variable.typeName}>{variable.typeName}</td>
        <td title={variable.summary}>{variable.summary}</td>
      </tr>
      {open && (
        <>
          {loading && (
            <tr>
              <td colSpan={3} role="status">
                Loading children…
              </td>
            </tr>
          )}
          {error && (
            <tr>
              <td colSpan={3} role="alert">
                {error}
              </td>
            </tr>
          )}
          {children?.map((child) => (
            <VariableRow
              key={child.key}
              variable={child}
              source={source}
              path={[...path, child.key]}
              depth={depth + 1}
            />
          ))}
          {children && total > children.length && (
            <tr>
              <td colSpan={3}>
                Showing {children.length} of {total} children
              </td>
            </tr>
          )}
        </>
      )}
    </>
  );
}

export function VariablesPanel() {
  const { source, sources } = useSession();
  const snapshot = source?.snapshot;
  return (
    <section className={styles.panel} aria-label="Session Variables">
      <SessionPicker source={source} sources={sources} />
      {!source || source.error || snapshot?.error || !snapshot?.variables.length ? (
        <Empty source={source} />
      ) : (
        <div className={styles.content}>
          <table className={styles.variables} aria-label="Session variables">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Type</th>
                <th scope="col">Summary</th>
              </tr>
            </thead>
            <tbody key={`${source.id}:${snapshot.generation}:${snapshot.revision}`}>
              {snapshot.variables.map((variable) => (
                <VariableRow key={variable.key} variable={variable} source={source} path={[variable.key]} />
              ))}
            </tbody>
          </table>
          {snapshot.total > snapshot.variables.length && (
            <p className={styles.empty}>
              Showing {snapshot.variables.length} of {snapshot.total} variables
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function plotUrl(mime: string, data: string) {
  if (mime === "image/svg+xml") {
    // Jupyter SVG is XML, Ark pre_render SVG is base64. SVG stays inside an
    // image document, which cannot run scripts or access the workbench DOM.
    return data.trimStart().startsWith("<")
      ? `data:${mime};charset=utf-8,${encodeURIComponent(data)}`
      : `data:${mime};base64,${data}`;
  }
  return `data:${mime};base64,${data}`;
}

function PlotHistory({ source }: { source: SessionSource }) {
  const plots = source.snapshot?.plots ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const previousNewest = useRef<string | null>(null);
  const newest = plots.at(-1)?.id ?? null;
  useEffect(() => {
    if (newest !== previousNewest.current) setSelected(newest);
    previousNewest.current = newest;
  }, [newest]);
  const index = Math.max(
    0,
    plots.findIndex((plot) => plot.id === selected),
  );
  const plot = plots[index];
  if (!plot)
    return (
      <p className={styles.empty} role="status">
        No plots in this session. Plot history keeps up to 50 images / 16 MiB.
      </p>
    );
  return (
    <>
      <div className={styles.toolbar}>
        <button
          type="button"
          aria-label="Previous plot"
          disabled={index === 0}
          onClick={() => setSelected(plots[index - 1]?.id ?? null)}
        >
          <Icon name="chevron-left" />
        </button>
        <span role="status">
          Plot {index + 1} / {plots.length}
        </span>
        <button
          type="button"
          aria-label="Next plot"
          disabled={index === plots.length - 1}
          onClick={() => setSelected(plots[index + 1]?.id ?? null)}
        >
          <Icon name="chevron-right" />
        </button>
      </div>
      <div className={styles.plot}>
        <img
          src={plotUrl(plot.mime, plot.data)}
          alt={`Plot ${index + 1} from ${source.snapshot?.language} session ${basename(source.path)}`}
        />
      </div>
    </>
  );
}

export function PlotsPanel() {
  const { source, sources } = useSession();
  return (
    <section className={styles.panel} aria-label="Session Plots">
      <SessionPicker source={source} sources={sources} />
      {source?.snapshot ? (
        <PlotHistory key={`${source.id}:${source.snapshot.generation}`} source={source} />
      ) : (
        <Empty source={source} />
      )}
    </section>
  );
}
