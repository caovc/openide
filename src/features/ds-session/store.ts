import { createStore } from "zustand/vanilla";
import type { SessionChildren, SessionSnapshot } from "@/bindings";

export interface SessionSource {
  id: string;
  path: string;
  state: string;
  snapshot: SessionSnapshot | null;
  error: string | null;
}

export interface SessionBackend {
  snapshot(id: string): Promise<SessionSnapshot | null>;
  inspect(id: string, generation: string, revision: number, path: string[]): Promise<SessionChildren>;
}

interface State {
  sources: SessionSource[];
  selected: string | null;
}

export class SessionPanels {
  readonly store = createStore<State>(() => ({ sources: [], selected: null }));
  private epoch = 0;
  private serial = new Map<string, number>();
  private pending = new Map<string, symbol>();

  constructor(private readonly backend: SessionBackend) {}

  select(id: string) {
    if (this.store.getState().sources.some((source) => source.id === id)) this.store.setState({ selected: id });
  }

  kernel(event: { id: string; path: string; state: string }) {
    const reset = event.state === "starting" || event.state === "dead";
    this.serial.set(event.id, (this.serial.get(event.id) ?? 0) + 1);
    this.pending.delete(event.id);
    const state = this.store.getState();
    const previous = state.sources.find((source) => source.id === event.id);
    const source: SessionSource = {
      ...event,
      snapshot: reset ? null : (previous?.snapshot ?? null),
      error: null,
    };
    // A reopened document at the same path replaces its retired incarnation.
    const sources = state.sources.filter((item) => item.id !== event.id && item.path !== event.path);
    sources.push(source);
    this.store.setState({
      sources,
      selected: state.selected && sources.some((s) => s.id === state.selected) ? state.selected : event.id,
    });
    if (!reset) void this.refresh(event.id);
  }

  async refresh(id: string) {
    const source = this.store.getState().sources.find((source) => source.id === id);
    if (!source || source.state === "dead" || source.state === "starting" || this.pending.has(id)) return;
    const epoch = this.epoch;
    const serial = this.serial.get(id);
    const token = Symbol();
    this.pending.set(id, token);
    const current = () => epoch === this.epoch && serial === this.serial.get(id) && this.pending.get(id) === token;
    try {
      const snapshot = await this.backend.snapshot(id);
      if (current()) this.update(id, { snapshot, error: null, ...(snapshot ? {} : { state: "dead" }) });
    } catch (error) {
      if (current()) {
        if (error && typeof error === "object" && "kind" in error && error.kind === "notFound") {
          this.store.setState((state) => {
            const sources = state.sources.filter((source) => source.id !== id);
            return { sources, selected: state.selected === id ? (sources.at(-1)?.id ?? null) : state.selected };
          });
        } else this.update(id, { snapshot: null, error: String(error) });
      }
    } finally {
      if (this.pending.get(id) === token) this.pending.delete(id);
    }
  }

  async expand(id: string, path: string[]): Promise<SessionChildren> {
    const epoch = this.epoch;
    const serial = this.serial.get(id);
    const source = this.store.getState().sources.find((source) => source.id === id);
    if (!source?.snapshot) throw new Error("Session is unavailable");
    const { generation, revision } = source.snapshot;
    const children = await this.backend.inspect(id, generation, revision, path);
    const current = this.store.getState().sources.find((source) => source.id === id)?.snapshot;
    if (
      epoch !== this.epoch ||
      serial !== this.serial.get(id) ||
      !current ||
      current.generation !== generation ||
      current.revision !== revision ||
      children.generation !== generation ||
      children.revision !== revision
    ) {
      throw new Error("Session variables changed; expand again");
    }
    return children;
  }

  reset() {
    this.epoch++;
    this.serial.clear();
    this.pending.clear();
    this.store.setState({ sources: [], selected: null });
  }

  private update(id: string, value: Partial<SessionSource>) {
    this.store.setState((state) => ({
      sources: state.sources.map((source) => (source.id === id ? { ...source, ...value } : source)),
    }));
  }
}
