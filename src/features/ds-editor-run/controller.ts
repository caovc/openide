import { create } from "zustand";
import { tx } from "@/platform/i18n";
import { consoleAction, consoleTargets, discoverRuntimes } from "./bridge";
import {
  captureSource,
  validateTarget,
  type ConsoleLanguage,
  type ConsoleRuntime,
  type ConsoleTarget,
  type EditorRunSource,
  type RunMode,
} from "./model";

interface RunRequest {
  source: EditorRunSource;
  epoch: number;
}

interface PickerState {
  request: RunRequest | null;
  targets: ConsoleTarget[];
  runtimes: ConsoleRuntime[];
  loading: boolean;
  working: boolean;
  error: string | null;
}

export interface EditorRunDependencies {
  capture: typeof captureSource;
  targets: typeof consoleTargets;
  discover: typeof discoverRuntimes;
  action: typeof consoleAction;
  show: () => void;
}

export class EditorRunController {
  readonly usePicker = create<PickerState>(() => ({
    request: null,
    targets: [],
    runtimes: [],
    loading: false,
    working: false,
    error: null,
  }));
  private epoch = 0;
  private last = new Map<ConsoleLanguage, string>();
  private submitted: string | null = null;

  constructor(private readonly deps: EditorRunDependencies) {}

  reset() {
    this.last.clear();
    this.submitted = null;
    this.dismiss();
  }

  dismiss = () => {
    ++this.epoch;
    this.usePicker.setState({ request: null, targets: [], runtimes: [], loading: false, working: false, error: null });
  };

  private check(request: RunRequest) {
    if (request.epoch !== this.epoch) throw new Error(tx("Run request expired. Run the editor code again."));
  }

  async run(mode: RunMode, choose = false, explicit?: ConsoleTarget) {
    this.dismiss();
    const request: RunRequest = { source: this.deps.capture(mode), epoch: this.epoch };
    const targets = await this.deps.targets();
    this.check(request);
    const matching = targets.filter((t) => t.language === request.source.language && !t.closing);
    const target =
      explicit ?? matching.find((t) => t.consoleId === this.last.get(request.source.language)) ?? matching.at(-1);
    if (explicit || (!choose && target)) {
      await this.submit(request, target!);
      return;
    }
    this.usePicker.setState({ request, targets: matching, runtimes: [], loading: true, working: false, error: null });
    await this.refresh();
  }

  refresh = async () => {
    const { request } = this.usePicker.getState();
    if (!request) return;
    this.usePicker.setState({ loading: true, error: null });
    const [targets, runtimes] = await Promise.allSettled([
      this.deps.targets(),
      this.deps.discover(request.source.language),
    ]);
    if (this.usePicker.getState().request !== request) return;
    this.usePicker.setState({
      targets:
        targets.status === "fulfilled" ? targets.value.filter((t) => t.language === request.source.language) : [],
      runtimes: runtimes.status === "fulfilled" ? runtimes.value : [],
      loading: false,
      error:
        targets.status === "rejected"
          ? String(targets.reason)
          : runtimes.status === "rejected"
            ? String(runtimes.reason)
            : null,
    });
  };

  private async submit(request: RunRequest, expected: ConsoleTarget) {
    const targets = await this.deps.targets();
    this.check(request);
    const target = validateTarget(targets, request.source.language, expected);
    // Select and execute without another asynchronous query between validation and admission.
    const selected = this.deps.action("ds.console.select", target.consoleId);
    this.deps.show();
    this.last.set(target.language, target.consoleId);
    this.submitted = target.consoleId;
    const execution = this.deps.action("ds.console.execute", {
      id: target.consoleId,
      language: target.language,
      source: request.source.source,
    });
    if (this.usePicker.getState().request === request) this.dismiss();
    await selected;
    await execution;
  }

  private async pickerOperation(operation: (request: RunRequest) => Promise<void>) {
    const state = this.usePicker.getState();
    if (!state.request || state.working) return;
    const request = state.request;
    this.usePicker.setState({ working: true, error: null });
    try {
      this.check(request);
      await operation(request);
    } catch (error) {
      if (this.usePicker.getState().request === request) this.usePicker.setState({ error: String(error) });
    } finally {
      if (this.usePicker.getState().request === request) this.usePicker.setState({ working: false });
    }
  }

  choose = (target: ConsoleTarget) => this.pickerOperation((request) => this.submit(request, target));

  create = (runtime: ConsoleRuntime) =>
    this.pickerOperation(async (request) => {
      if (runtime.language !== request.source.language || !this.usePicker.getState().runtimes.includes(runtime))
        throw new Error(tx("Refresh kernels and choose a runtime for the editor language."));
      const before = await this.deps.targets();
      this.check(request);
      await this.deps.action("ds.console.new", runtime);
      const after = await this.deps.targets();
      this.check(request);
      const created = after.filter(
        (t) =>
          !before.some((old) => old.consoleId === t.consoleId) &&
          t.language === runtime.language &&
          t.selection === runtime.selection,
      );
      if (created.length !== 1)
        throw new Error(tx("Could not identify the new Console. Choose a Console and run again."));
      await this.submit(request, created[0]!);
    });

  async cancel() {
    const id = this.submitted;
    const target = (await this.deps.targets()).find((t) => t.consoleId === id);
    if (id !== this.submitted || !target || target.closing || !target.busy)
      throw new Error(tx("No running editor submission. Use Stop in the target Console."));
    await this.deps.action("ds.console.select", target.consoleId);
    this.deps.show();
    await this.deps.action("ds.console.cancel", target.consoleId);
  }
}
