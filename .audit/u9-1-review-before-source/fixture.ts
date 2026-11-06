import { SAS_MISSING_CODES } from "./contract";
import type {
  Cell,
  Column,
  HostScope,
  Identity,
  Limits,
  Operation,
  Page,
  SchemaPage,
  TableHandle,
  TableProvider,
  TableState,
  Unsupported,
} from "./contract";
import { FixtureCacheBudget } from "./cache";
import {
  jsonBytes,
  boundedInt,
  checkedIndex,
  ContractError,
  parseHandle,
  parseIdentity,
  parsePage,
  parsePageRequest,
  parseProfileRequest,
  parseQueryRequest,
  parseSchemaPage,
  parseSchemaRequest,
  parseScope,
  parseTableState,
  requireThat,
  sameIdentity,
  sameScope,
  utf8Bytes,
} from "./validation";

export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
  maxRows: 256,
  maxColumns: 32,
  maxResponseBytes: 2 * 1024 * 1024,
  maxPreviewBytes: 4096,
});

export interface FixtureConfig {
  limits: Limits;
  viewCacheBytes: number;
  providerCacheBytes: number;
  maxViews: number;
  maxInFlightPerView: number;
  maxInFlightProvider: number;
}

export const DEFAULT_CONFIG: Readonly<FixtureConfig> = Object.freeze({
  limits: DEFAULT_LIMITS,
  viewCacheBytes: 16 * 1024 * 1024,
  providerCacheBytes: 64 * 1024 * 1024,
  maxViews: 16,
  maxInFlightPerView: 2,
  maxInFlightProvider: 8,
});

const ROWS = 1_000_000;
const COLUMNS = 1000;
const unsupportedOperations: Operation[] = ["sort", "filter", "profile", "export"];
let nextProvider = 0;

interface View {
  identity: Identity;
  projection: string[] | null;
  pending: Map<string, AbortController>;
}

function increment(value: number): number {
  return boundedInt(value + 1, 1, Number.MAX_SAFE_INTEGER);
}

function cloneIdentity(value: Identity): Identity {
  return parseIdentity(value);
}

function unsupported(operation: Operation): Unsupported {
  return { kind: "unsupported", operation, reason: "Fixture supports bounded paging and projection only" };
}

/** Independent authored fixture data; SAS codes are data, never executable SAS source. */
export function representativeCells(): Cell[] {
  const cells: Cell[] = [
    { kind: "boolean", value: false },
    { kind: "integer", value: "92233720368547758081234567890" },
    { kind: "decimal", value: "-12345678901234567890.00000000100" },
    { kind: "float", value: { kind: "finite", value: 1.25 } },
    { kind: "float", value: { kind: "nan" } },
    { kind: "float", value: { kind: "+inf" } },
    { kind: "float", value: { kind: "-inf" } },
    { kind: "float", value: { kind: "-zero" } },
    { kind: "text", preview: { text: "", truncated: false } },
    { kind: "text", preview: { text: "零\n🙂", truncated: false } },
    { kind: "category", dictionaryId: "factor:0", dictionaryRevision: "levels:1", code: "1" },
    {
      kind: "temporal",
      type: "timestamp",
      ticks: "1700000000000000001",
      resolution: "nanosecond",
      timezone: "Asia/Shanghai",
    },
    { kind: "temporal", type: "date", ticks: "-3653", resolution: "day", timezone: null },
    { kind: "temporal", type: "duration", ticks: "123456", resolution: "microsecond", timezone: null },
    { kind: "binary", preview: { text: "00ff", truncated: true } },
    { kind: "nested", type: "list", size: "100000000000000000000", preview: { text: "list summary", truncated: true } },
    { kind: "unsupported", preview: { text: "Custom object", truncated: false } },
    { kind: "error", preview: { text: "Unavailable value", truncated: false } },
    { kind: "integer", value: "0" },
  ];
  for (const value of ["none", "pandas-na", "nat"] as const)
    cells.push({ kind: "missing", value: { system: "python", value } });
  for (const value of ["logical", "integer", "double", "complex", "character", "date", "timestamp"] as const)
    cells.push({ kind: "missing", value: { system: "r", value } });
  cells.push({ kind: "missing", value: { system: "sql", value: "null" } });
  for (const value of SAS_MISSING_CODES) {
    cells.push({ kind: "missing", value: { system: "sas", value } });
  }
  return cells;
}

function boundedPreview(text: string, max: number): { text: string; truncated: boolean } {
  let result = "";
  let bytes = 0;
  for (const char of text) {
    bytes += utf8Bytes(char);
    if (bytes > max) break;
    result += char;
  }
  return { text: result, truncated: result.length < text.length };
}

function columnIndex(id: string): number {
  requireThat(/^column:(0|[1-9][0-9]*)$/.test(id), "Unknown column");
  return checkedIndex(id.slice(7), COLUMNS - 1);
}

function configCopy(config: FixtureConfig, budget: FixtureCacheBudget): FixtureConfig {
  const limits = {
    maxRows: boundedInt(config.limits.maxRows, 1, DEFAULT_LIMITS.maxRows),
    maxColumns: boundedInt(config.limits.maxColumns, 1, DEFAULT_LIMITS.maxColumns),
    maxResponseBytes: boundedInt(config.limits.maxResponseBytes, 1, DEFAULT_LIMITS.maxResponseBytes),
    maxPreviewBytes: boundedInt(config.limits.maxPreviewBytes, 1, DEFAULT_LIMITS.maxPreviewBytes),
  };
  const providerCacheBytes = boundedInt(config.providerCacheBytes, 1, budget.maxBytes);
  return {
    limits,
    providerCacheBytes,
    viewCacheBytes: boundedInt(config.viewCacheBytes, 1, providerCacheBytes),
    maxViews: boundedInt(config.maxViews, 1, 128),
    maxInFlightPerView: boundedInt(config.maxInFlightPerView, 1, 2),
    maxInFlightProvider: boundedInt(config.maxInFlightProvider, 1, 16),
  };
}

/**
 * Fixture-only authorization. `authorize` is host-supplied, never an envelope field.
 * Predictable tokens and in-process callbacks are NOT production security capabilities.
 */
export class FixtureTableProvider implements TableProvider {
  private readonly config: FixtureConfig;
  private readonly namespace = `fixture:${++nextProvider}`;
  private readonly views = new Map<string, View>();
  private sequence = 0;
  private inFlight = 0;
  private generatedCells = 0;
  private cacheHits = 0;

  constructor(
    private readonly budget: FixtureCacheBudget,
    private readonly authorize: (scope: HostScope) => boolean,
    config: FixtureConfig = DEFAULT_CONFIG,
    private readonly beforeWork: (signal: AbortSignal) => Promise<void> = () => Promise.resolve(),
    private readonly backend = "fixture/neutral",
  ) {
    this.config = configCopy(config, budget);
    requireThat(typeof authorize === "function" && typeof beforeWork === "function");
    requireThat(typeof backend === "string" && backend.length > 0 && utf8Bytes(backend) <= 128);
  }

  get limits(): Limits {
    return { ...this.config.limits };
  }

  stats(): {
    views: number;
    inFlight: number;
    generatedCells: number;
    cacheHits: number;
    cacheBytes: number;
    cacheEntries: number;
  } {
    const cache = this.budget.stats(this);
    return {
      views: this.views.size,
      inFlight: this.inFlight,
      generatedCells: this.generatedCells,
      cacheHits: this.cacheHits,
      cacheBytes: cache.bytes,
      cacheEntries: cache.entries,
    };
  }

  private authorized(scope: HostScope): void {
    requireThat(this.authorize({ ...scope }), "Fixture host denied scope");
  }

  private resolve(scope: HostScope, handle: TableHandle): View {
    this.authorized(scope);
    requireThat(sameScope(scope, handle.scope), "Handle scope mismatch");
    const view = this.views.get(handle.id);
    requireThat(view && sameScope(view.identity.handle.scope, scope), "Unknown or revoked handle");
    return view;
  }

  private current(scope: HostScope, identity: Identity): View {
    const view = this.resolve(scope, identity.handle);
    requireThat(sameIdentity(view.identity, identity), "Stale revision or query epoch");
    return view;
  }

  private snapshot(view: View): TableState {
    return parseTableState(
      {
        identity: cloneIdentity(view.identity),
        backend: this.backend,
        rows: { kind: "exact", value: String(ROWS) },
        columnCount: String(COLUMNS),
        capabilities: { paging: true, projection: true, unsupported: [...unsupportedOperations] },
      },
      view.identity.handle,
    );
  }

  open(input: unknown): TableState {
    const scope = parseScope(input);
    this.authorized(scope);
    requireThat(this.views.size < this.config.maxViews, "View limit reached");
    const id = `${this.namespace}:${++this.sequence}`;
    const view: View = {
      identity: { handle: { id, scope }, dataRevision: 1, schemaRevision: 1, queryEpoch: 1 },
      projection: null,
      pending: new Map(),
    };
    this.views.set(id, view);
    return this.snapshot(view);
  }

  state(input: unknown, value: unknown): TableState {
    return this.snapshot(this.resolve(parseScope(input), parseHandle(value)));
  }

  private cancel(view: View): void {
    for (const controller of view.pending.values()) controller.abort();
    this.budget.clear(this, view.identity.handle.id);
  }

  close(input: unknown, value: unknown): void {
    const scope = parseScope(input);
    const handle = parseHandle(value);
    this.authorized(scope);
    requireThat(sameScope(scope, handle.scope), "Handle scope mismatch");
    const view = this.views.get(handle.id);
    if (!view) return;
    requireThat(sameScope(view.identity.handle.scope, scope), "Handle scope mismatch");
    this.cancel(view);
    this.views.delete(handle.id);
  }

  /** Host lifecycle notification: release even after the host authorization was withdrawn. */
  revoke(input: unknown): void {
    const scope = parseScope(input);
    for (const [id, view] of this.views) {
      if (sameScope(view.identity.handle.scope, scope)) {
        this.cancel(view);
        this.views.delete(id);
      }
    }
  }

  refresh(input: unknown, value: unknown): TableState {
    const scope = parseScope(input);
    const identity = parseIdentity(value);
    const target = this.current(scope, identity);
    // A refresh invalidates every viewer of this owning object, but keeps their queries isolated.
    const owner = identity.handle.scope;
    const related = [...this.views.values()].filter((view) =>
      sameScope({ ...view.identity.handle.scope, viewer: owner.viewer }, owner),
    );
    for (const view of related) {
      const dataRevision = increment(view.identity.dataRevision);
      const schemaRevision = increment(view.identity.schemaRevision);
      this.cancel(view);
      view.identity = { ...view.identity, dataRevision, schemaRevision };
    }
    return this.snapshot(target);
  }

  query(input: unknown, value: unknown): { kind: "applied"; state: TableState } | Unsupported {
    const scope = parseScope(input);
    const request = parseQueryRequest(value, this.config.limits);
    const view = this.current(scope, request.identity);
    request.query.projection.forEach(columnIndex);
    request.query.sort.forEach((sort) => columnIndex(sort.column));
    if (request.query.filter) columnIndex(request.query.filter.column);
    if (request.query.sort.length) return unsupported("sort");
    if (request.query.filter) return unsupported("filter");
    const queryEpoch = increment(view.identity.queryEpoch);
    this.cancel(view);
    view.projection = request.query.projection;
    view.identity = { ...view.identity, queryEpoch };
    return { kind: "applied", state: this.snapshot(view) };
  }

  profile(input: unknown, value: unknown): Unsupported {
    const scope = parseScope(input);
    const request = parseProfileRequest(value, this.config.limits);
    this.current(scope, request.identity);
    request.columns.forEach(columnIndex);
    return unsupported("profile");
  }

  export(input: unknown, value: unknown): Unsupported {
    this.current(parseScope(input), parseIdentity(value));
    return unsupported("export");
  }

  private async guarded<T>(
    scope: HostScope,
    identity: Identity,
    requestId: string,
    signal: AbortSignal | undefined,
    work: () => T,
  ): Promise<T> {
    const view = this.current(scope, identity);
    requireThat(!signal?.aborted, "Cancelled");
    requireThat(!view.pending.has(requestId), "Duplicate in-flight request id");
    requireThat(
      view.pending.size < this.config.maxInFlightPerView && this.inFlight < this.config.maxInFlightProvider,
      "In-flight limit reached",
    );
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    signal?.addEventListener("abort", forwardAbort, { once: true });
    view.pending.set(requestId, controller);
    this.inFlight++;
    let rejectAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new ContractError("Cancelled"));
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    try {
      await Promise.race([this.beforeWork(controller.signal), aborted]);
      requireThat(!controller.signal.aborted, "Cancelled");
      this.current(scope, identity);
      const result = work();
      this.current(scope, identity);
      requireThat(!controller.signal.aborted, "Cancelled");
      return result;
    } finally {
      signal?.removeEventListener("abort", forwardAbort);
      if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
      view.pending.delete(requestId);
      this.inFlight--;
    }
  }

  async schema(input: unknown, value: unknown, signal?: AbortSignal): Promise<SchemaPage> {
    const scope = parseScope(input);
    const request = parseSchemaRequest(value, this.config.limits);
    return this.guarded(scope, request.identity, request.requestId, signal, () => {
      const start = BigInt(request.offset) >= BigInt(COLUMNS) ? COLUMNS : checkedIndex(request.offset, COLUMNS);
      const count = Math.min(request.limit, COLUMNS - start);
      const columns: Column[] = Array.from({ length: count }, (_, index) => ({
        id: `column:${start + index}`,
        ordinal: start + index,
        name: start + index < 2 ? "duplicate" : start + index === 2 ? "" : `value ${start + index}`,
        runtimeType: "fixture/mixed",
        nullable: true,
        type:
          start + index === 9
            ? { kind: "category", dictionaryId: "factor:0", dictionaryRevision: "levels:1", size: "2", ordered: true }
            : { kind: "unknown" },
      }));
      return parseSchemaPage(
        {
          identity: request.identity,
          requestId: request.requestId,
          offset: request.offset,
          columns,
          hasMore: start + count < COLUMNS,
        },
        request,
        this.config.limits,
      );
    });
  }

  async page(input: unknown, value: unknown, signal?: AbortSignal): Promise<Page> {
    const scope = parseScope(input);
    const request = parsePageRequest(value, this.config.limits);
    const view = this.current(scope, request.identity);
    request.columns.forEach(columnIndex);
    requireThat(
      view.projection === null || request.columns.every((id) => view.projection?.includes(id)),
      "Column outside query projection",
    );
    return this.guarded(scope, request.identity, request.requestId, signal, () => {
      const key = JSON.stringify([request.identity, request.offset, request.limit, request.columns]);
      const cached = this.budget.get(key, this);
      if (cached !== undefined) {
        this.cacheHits++;
        const decoded: unknown = JSON.parse(cached);
        // Cache stores an envelope too: validate it before copying/recorrelating its request id.
        const original = parsePage(decoded, { ...request, requestId: "cached" }, this.config.limits);
        return parsePage({ ...original, requestId: request.requestId }, request, this.config.limits);
      }
      const start = BigInt(request.offset) >= BigInt(ROWS) ? ROWS : checkedIndex(request.offset, ROWS);
      const rowCount = Math.min(request.limit, ROWS - start);
      const samples = representativeCells();
      let payloadBytes = 0;
      const account = (cell: Cell): Cell => {
        payloadBytes += jsonBytes(cell);
        requireThat(payloadBytes <= this.config.limits.maxResponseBytes, "Response byte budget exceeded");
        return cell;
      };
      const longPreview = request.columns.includes("column:999")
        ? boundedPreview("long🙂\n".repeat(1200), this.config.limits.maxPreviewBytes)
        : null;
      const columns = request.columns.map((id) => {
        const ordinal = columnIndex(id);
        return {
          id,
          values: Array.from({ length: rowCount }, (_, index) => {
            this.generatedCells++;
            if (ordinal === 9)
              return account({
                kind: "category",
                dictionaryId: "factor:0",
                dictionaryRevision: "levels:1",
                code: String((start + index) % 2),
              });
            if (ordinal === COLUMNS - 1) {
              requireThat(longPreview);
              return account({ kind: "text", preview: longPreview });
            }
            const cell = samples[(start + index + ordinal) % samples.length];
            requireThat(cell);
            // Honor even tiny configured previews without truncating lossless numeric payloads.
            return account(
              "preview" in cell
                ? {
                    ...cell,
                    preview: {
                      ...boundedPreview(cell.preview.text, this.config.limits.maxPreviewBytes),
                      truncated:
                        cell.preview.truncated || utf8Bytes(cell.preview.text) > this.config.limits.maxPreviewBytes,
                    },
                  }
                : cell,
            );
          }),
        };
      });
      const page = parsePage(
        {
          identity: request.identity,
          requestId: request.requestId,
          offset: request.offset,
          rowCount,
          columns,
          hasMore: start + rowCount < ROWS,
        },
        request,
        this.config.limits,
      );
      const cachedPage = { ...page, requestId: "cached" };
      if (jsonBytes(cachedPage) <= this.config.limits.maxResponseBytes) {
        this.budget.put(
          key,
          this,
          view.identity.handle.id,
          JSON.stringify(cachedPage),
          this.config.viewCacheBytes,
          this.config.providerCacheBytes,
        );
      }
      return page;
    });
  }
}
