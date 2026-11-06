import type { NotebookOutputEvent, NotebookSnapshot, RequestId } from "@/bindings";
import { consoleBackend, type ConsoleBackend, type Runtime } from "./backend";

export interface ConsoleInput {
  requestId: string;
  prompt: string;
  password: boolean;
}
export interface HistoryEntry {
  source: string;
  output: string;
}
export interface ConsoleState {
  busy: boolean;
  closing: boolean;
  closed: boolean;
  error: string | null;
  history: HistoryEntry[];
  input: ConsoleInput | null;
  generation: number;
}

/** The selected runtime is immutable. Create another Console to change language/environment. */
export class ConsoleSession {
  private state: ConsoleState = {
    busy: false,
    closing: false,
    closed: false,
    error: null,
    history: [],
    input: null,
    generation: 0,
  };
  private listeners = new Set<() => void>();
  private snapshot: NotebookSnapshot | null = null;
  private opening: Promise<void> | null = null;
  private execution: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private request: RequestId | null = null;
  private cancelled = false;
  private replying = false;
  private lifecycle: Promise<void> | null = null;
  private epoch = 0;
  constructor(
    readonly id: string,
    readonly runtime: Runtime,
    private backend: ConsoleBackend = consoleBackend,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getState = () => this.state;
  /** U8/session panels: id is available after the first successful execute admission. */
  target = () => ({
    consoleId: this.id,
    notebookId: this.snapshot?.id ?? null,
    language: this.runtime.language,
    selection: this.runtime.selection,
    generation: this.state.generation,
  });
  private publish(patch: Partial<ConsoleState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  report(error: unknown) {
    this.publish({ error: error instanceof Error ? error.message : String(error) });
  }
  private open() {
    if (!this.opening)
      this.opening = this.backend
        .open(this.id)
        .then((snapshot) => {
          this.snapshot = snapshot;
        })
        .catch((error) => {
          this.opening = null;
          throw error;
        });
    return this.opening;
  }
  execute(source: string): Promise<void> {
    if (this.state.busy || this.lifecycle || this.state.closing || this.state.closed)
      return Promise.reject(new Error("Console is busy or closed"));
    if (!source.trim()) return Promise.resolve();
    this.cancelled = false;
    const epoch = ++this.epoch;
    this.publish({ busy: true, error: null, history: [...this.state.history, { source, output: "" }] });
    const entry = this.state.history.length - 1;
    this.execution = (async () => {
      await this.open();
      if (this.cancelled || this.state.closing) return;
      this.snapshot = await this.backend.get(this.snapshot!.id);
      if (this.cancelled || this.state.closing) return;
      this.snapshot = await this.backend.insert(this.snapshot);
      if (this.cancelled || this.state.closing) return;
      const cell = this.snapshot.cells.at(-1)!.id;
      this.snapshot = await this.backend.source(this.snapshot, cell, source);
      if (this.cancelled || this.state.closing) return;
      this.request = this.backend.request();
      this.snapshot = await this.backend.execute(this.snapshot, cell, this.runtime.selection, this.request, (event) => {
        if (
          epoch !== this.epoch ||
          !this.state.busy ||
          this.cancelled ||
          this.state.closing ||
          event.id !== this.snapshot?.id ||
          event.cell !== cell
        )
          return;
        this.receive(event, entry);
      });
      if (epoch === this.epoch && !this.cancelled && !this.state.closing) {
        const executed = this.snapshot.cells.find((c) => c.id === cell);
        if (executed)
          this.publish({
            history: this.state.history.map((h, i) =>
              i === entry ? { ...h, output: executed.outputs.map(outputText).join("").slice(-1_000_000) } : h,
            ),
          });
      }
    })()
      .catch((error) => {
        if (!this.cancelled && !this.state.closing) this.report(error);
      })
      .finally(() => {
        this.request = null;
        this.publish({ busy: false, input: null });
      });
    return this.execution;
  }
  private receive(event: NotebookOutputEvent, index: number) {
    const c = event.content as Record<string, unknown> | null;
    if (!c || typeof c !== "object") return;
    if (event.kind === "input_request") {
      if (typeof c.requestId === "string" && typeof c.prompt === "string" && typeof c.password === "boolean")
        this.publish({ input: { requestId: c.requestId, prompt: c.prompt, password: c.password } });
      else {
        this.report(new Error("Invalid kernel input request"));
        void this.cancel().catch((e) => this.report(e));
      }
      return;
    }
    let output = "";
    if (event.kind === "stream" && typeof c.text === "string") output = c.text;
    if (event.kind === "error") output = `${String(c.ename ?? "Error")}: ${String(c.evalue ?? "")}\n`;
    if (event.kind === "execute_result" || event.kind === "display_data") {
      const data = c.data as Record<string, unknown> | undefined;
      if (typeof data?.["text/plain"] === "string") output = data["text/plain"] + "\n";
    }
    if (event.kind === "clear_output") {
      this.publish({ history: this.state.history.map((h, i) => (i === index ? { ...h, output: "" } : h)) });
    } else if (output) {
      this.publish({
        history: this.state.history.map((h, i) =>
          i === index ? { ...h, output: (h.output + output).slice(-1_000_000) } : h,
        ),
      });
    }
  }
  async reply(value: string | null) {
    const input = this.state.input;
    if (!input || this.replying || !this.snapshot || this.state.closing) return;
    this.replying = true;
    try {
      await this.backend.reply(this.snapshot.id, input.requestId, value);
      if (this.state.input === input) this.publish({ input: null });
    } catch (error) {
      this.report(error);
    } finally {
      this.replying = false;
    }
  }
  cancel(): Promise<void> {
    if (this.lifecycle) return this.lifecycle;
    this.cancelled = true;
    this.epoch++;
    this.publish({ input: null });
    this.lifecycle = (async () => {
      const results = await Promise.allSettled([
        this.request !== null ? this.backend.cancel(this.request) : Promise.resolve(),
        this.snapshot && this.state.busy ? this.backend.interrupt(this.snapshot.id) : Promise.resolve(),
        this.execution,
      ]);
      const failure = results.find((r) => r.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    })().finally(() => {
      this.lifecycle = null;
      this.publish({});
    });
    return this.lifecycle;
  }
  restart(): Promise<void> {
    if (this.lifecycle || this.state.closing || this.state.closed || this.state.busy) return Promise.resolve();
    this.epoch++;
    this.publish({ busy: true, error: null, input: null });
    this.lifecycle = (async () => {
      try {
        await Promise.resolve();
        // Stop is lazy restart: the next execute starts a fresh selected runtime.
        if (this.snapshot) await this.backend.stop(this.snapshot.id);
        this.publish({ generation: this.state.generation + 1 });
      } catch (error) {
        this.report(error);
      } finally {
        this.lifecycle = null;
        this.publish({ busy: false });
      }
    })();
    return this.lifecycle;
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    if (this.state.closed) return Promise.resolve();
    this.cancelled = true;
    this.epoch++;
    this.publish({ closing: true, input: null });
    this.closing = (async () => {
      // Await admission even when close races with the initial open or source edit.
      await this.lifecycle?.catch(() => {});
      if (this.request !== null) await this.backend.cancel(this.request).catch(() => {});
      if (this.snapshot) await this.backend.close(this.snapshot.id);
      await this.execution;
      if (this.snapshot) await this.backend.close(this.snapshot.id);
      this.publish({ closed: true });
    })()
      .catch((error) => {
        this.report(error);
        throw error;
      })
      .finally(() => {
        this.closing = null;
        this.publish({ closing: false });
      });
    return this.closing;
  }
}

function outputText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const output = value as Record<string, unknown>;
  if (output.output_type === "stream")
    return typeof output.text === "string" ? output.text : Array.isArray(output.text) ? output.text.join("") : "";
  if (output.output_type === "error") return `${String(output.ename ?? "Error")}: ${String(output.evalue ?? "")}\n`;
  const data = output.data as Record<string, unknown> | undefined;
  const text = data?.["text/plain"];
  return typeof text === "string" ? text + "\n" : Array.isArray(text) ? text.join("") + "\n" : "";
}
