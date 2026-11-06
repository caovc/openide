/** Transport-injected Ark → U9.1 TableProvider mapping (U9.2a). No session/UI imports. */
import type {
  Cell,
  Column,
  HostScope,
  Identity,
  Limits,
  LogicalType,
  Page,
  TableHandle,
  TableProvider,
  TableState,
  Unsupported,
} from "./contract";
import {
  ContractError,
  boundedInt,
  checkedIndex,
  parseIdentity,
  parseHandle,
  parsePage,
  parsePageRequest,
  parseProfileRequest,
  parseQueryRequest,
  parseSchemaPage,
  parseSchemaRequest,
  parseTableState,
  parseScope,
  requireThat,
  sameIdentity,
  sameScope,
  utf8Bytes,
} from "./validation";

/** Verified against Ark format.rs at pinned revision. */
export const ARK_NULL = 0;
export const ARK_NA = 1;
export const ARK_NAN = 2;
export const ARK_INF = 10;
export const ARK_NEG_INF = 11;

export interface ArkExplorerTransport {
  getState(signal?: AbortSignal): Promise<unknown>;
  getSchema(columnIndices: number[], signal?: AbortSignal): Promise<unknown>;
  getDataValues(
    args: {
      columns: { column_index: number; spec: { first_index: number; last_index: number } }[];
      format_options: Record<string, unknown>;
    },
    signal?: AbortSignal,
  ): Promise<unknown>;
  close(): Promise<void>;
}

export interface PreparedArkExplorer {
  scope: HostScope;
  handle: TableHandle;
  identity: Identity;
  backendState: unknown;
  transport: ArkExplorerTransport;
}

const DEFAULT_LIMITS: Limits = {
  maxRows: 256,
  maxColumns: 32,
  maxResponseBytes: 2 * 1024 * 1024,
  maxPreviewBytes: 4 * 1024,
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function resultOf(payload: unknown): Record<string, unknown> {
  requireThat(record(payload), "Ark reply must be object");
  if (record(payload.result)) return payload.result;
  return payload;
}

export function mapArkDisplayType(typeDisplay: unknown, typeName: string): LogicalType {
  switch (typeDisplay) {
    case "boolean":
      return { kind: "boolean" };
    case "integer":
      return { kind: "integer" };
    case "floating":
    case "decimal":
      return { kind: "float" };
    case "string":
      return { kind: "text" };
    case "date":
      return { kind: "temporal", type: "date", resolution: "day", timezone: null };
    case "datetime":
      return { kind: "temporal", type: "timestamp", resolution: "second", timezone: null };
    case "time":
      return { kind: "temporal", type: "time", resolution: "second", timezone: null };
    default:
      return typeName.toLowerCase().includes("factor")
        ? { kind: "category", dictionaryId: "ark-factor", dictionaryRevision: "1", size: "0", ordered: false }
        : { kind: "unknown" };
  }
}

export function mapArkColumn(raw: unknown, limits: Limits = DEFAULT_LIMITS): Column {
  requireThat(record(raw), "column schema");
  const name = typeof raw.column_name === "string" ? raw.column_name : "";
  requireThat(utf8Bytes(name) <= limits.maxPreviewBytes, "column name too large");
  const ordinal = boundedInt(raw.column_index, 0, Number.MAX_SAFE_INTEGER);
  const runtimeType = typeof raw.type_name === "string" ? raw.type_name : "unknown";
  return {
    id: `ark-col-${ordinal}`,
    ordinal,
    name,
    runtimeType,
    nullable: true,
    type: mapArkDisplayType(raw.type_display, runtimeType),
  };
}

function preview(text: string, limits: Limits) {
  const bytes = utf8Bytes(text);
  if (bytes <= limits.maxPreviewBytes) return { text, truncated: false };
  let result = "";
  let size = 0;
  for (const char of text) {
    size += utf8Bytes(char);
    if (size > limits.maxPreviewBytes) break;
    result += char;
  }
  return { text: result, truncated: true };
}

/** Map one Ark ColumnValue; doubles/factors/temporals stay lossy previews when formatted. */
export function mapArkCell(raw: unknown, column: Column, limits: Limits = DEFAULT_LIMITS): Cell {
  if (typeof raw === "number" && Number.isSafeInteger(raw)) {
    switch (raw) {
      case ARK_NULL:
        return { kind: "missing", value: { system: "sql", value: "null" } };
      case ARK_NA:
        return {
          kind: "missing",
          value: {
            system: "r",
            value:
              column.type.kind === "boolean"
                ? "logical"
                : column.type.kind === "integer"
                  ? "integer"
                  : column.type.kind === "float"
                    ? "double"
                    : column.type.kind === "text"
                      ? "character"
                      : "double",
          },
        };
      case ARK_NAN:
        return { kind: "float", value: { kind: "nan" } };
      case ARK_INF:
        return { kind: "float", value: { kind: "+inf" } };
      case ARK_NEG_INF:
        return { kind: "float", value: { kind: "-inf" } };
      default:
        throw new ContractError(`unknown Ark special value code: ${raw}`);
    }
  }
  requireThat(typeof raw === "string", "Ark cell must be string or special code");
  switch (column.type.kind) {
    case "boolean":
      if (raw === "TRUE" || raw === "True" || raw === "true") return { kind: "boolean", value: true };
      if (raw === "FALSE" || raw === "False" || raw === "false") return { kind: "boolean", value: false };
      return { kind: "unsupported", preview: preview(raw, limits) };
    case "integer":
      requireThat(/^-?\d+$/.test(raw), "integer cell");
      return { kind: "integer", value: raw };
    case "text":
      return { kind: "text", preview: preview(raw, limits) };
    case "float":
      // Formatted finite floats are lossy previews, not lossless typed floats.
      return { kind: "unsupported", preview: preview(raw, limits) };
    case "temporal":
    case "category":
    case "unknown":
    case "binary":
    case "nested":
    case "decimal":
      return { kind: "unsupported", preview: preview(raw, limits) };
    default: {
      const _exhaustive: never = column.type;
      return _exhaustive;
    }
  }
}

export async function prepareArkExplorer(args: {
  scope: unknown;
  transport: ArkExplorerTransport;
  authorize: (scope: HostScope) => boolean;
  handleId?: string;
}): Promise<PreparedArkExplorer> {
  const scope = parseScope(args.scope);
  requireThat(args.authorize({ ...scope }), "host authorization denied");
  try {
    const backendState = await args.transport.getState();
    requireThat(args.authorize({ ...scope }), "host authorization denied");
    const handle = parseHandle({ id: args.handleId ?? `ark-${scope.objectId}`, scope });
    const identity: Identity = { handle, dataRevision: 1, schemaRevision: 1, queryEpoch: 1 };
    return { scope, handle, identity, backendState, transport: args.transport };
  } catch (error) {
    try {
      await args.transport.close();
    } catch {
      /* Preserve the preparation error. */
    }
    throw error;
  }
}

export function createArkTableProvider(
  prepared: PreparedArkExplorer,
  authorize: (scope: HostScope) => boolean,
  limits: Limits = DEFAULT_LIMITS,
): TableProvider {
  limits = {
    maxRows: boundedInt(limits.maxRows, 1, DEFAULT_LIMITS.maxRows),
    maxColumns: boundedInt(limits.maxColumns, 1, DEFAULT_LIMITS.maxColumns),
    maxResponseBytes: boundedInt(limits.maxResponseBytes, 1, DEFAULT_LIMITS.maxResponseBytes),
    maxPreviewBytes: boundedInt(limits.maxPreviewBytes, 1, DEFAULT_LIMITS.maxPreviewBytes),
  };
  const owner = parseScope(prepared.scope);
  let identity = parseIdentity(prepared.identity);
  requireThat(sameScope(owner, identity.handle.scope), "scope mismatch");
  const handle = parseHandle(prepared.handle);
  requireThat(handle.id === identity.handle.id && sameScope(handle.scope, owner), "handle mismatch");
  const transport = prepared.transport;
  const shape = resultOf(prepared.backendState).table_shape;
  requireThat(record(shape), "Ark table shape");
  const rows = boundedInt(shape.num_rows, 0, Number.MAX_SAFE_INTEGER);
  const columnCount = boundedInt(shape.num_columns, 0, Number.MAX_SAFE_INTEGER);
  let live = true;
  let projection: string[] | null = null;
  const pending = new Map<string, AbortController>();
  const check = (scope: unknown, expected?: Identity) => {
    requireThat(live, "explorer closed");
    const parsed = parseScope(scope);
    requireThat(authorize({ ...parsed }), "host authorization denied");
    requireThat(sameScope(parsed, owner), "scope mismatch");
    if (expected) requireThat(sameIdentity(expected, identity), "stale identity");
  };
  const checkHandle = (value: unknown) => {
    const parsed = parseHandle(value);
    requireThat(parsed.id === handle.id && sameScope(parsed.scope, owner), "handle mismatch");
  };
  const snapshot = (): TableState =>
    parseTableState(
      {
        identity,
        backend: "ark",
        rows: { kind: "exact", value: String(rows) },
        columnCount: String(columnCount),
        capabilities: { paging: true, projection: true, unsupported: ["sort", "filter", "profile", "export"] },
      },
      handle,
    );
  const cancel = () => {
    for (const controller of pending.values()) controller.abort();
  };
  const dispose = () => {
    if (!live) return;
    live = false;
    cancel();
    // The synchronous TableProvider lifecycle cannot return a transport close promise.
    void transport.close().catch(() => {});
  };
  const ordinal = (id: string) => {
    requireThat(/^ark-col-(0|[1-9][0-9]*)$/.test(id), "unknown column id");
    return checkedIndex(id.slice(8), columnCount - 1);
  };
  const unsupported = (operation: Unsupported["operation"]): Unsupported => ({
    kind: "unsupported",
    operation,
    reason: "U9.2a read-only; operation deferred",
  });
  const guarded = async <T>(
    scope: HostScope,
    expected: Identity,
    requestId: string,
    signal: AbortSignal | undefined,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    check(scope, expected);
    requireThat(!signal?.aborted, "Cancelled");
    requireThat(!pending.has(requestId), "Duplicate in-flight request id");
    requireThat(pending.size < 2, "In-flight limit reached");
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    pending.set(requestId, controller);
    let rejectAbort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new ContractError("Cancelled"));
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    try {
      const result = await Promise.race([work(controller.signal), cancelled]);
      requireThat(!controller.signal.aborted, "Cancelled");
      check(scope, expected);
      return result;
    } finally {
      signal?.removeEventListener("abort", abort);
      controller.signal.removeEventListener("abort", rejectAbort);
      pending.delete(requestId);
    }
  };
  const schemaColumns = async (indices: number[], signal: AbortSignal): Promise<Column[]> => {
    if (!indices.length) return [];
    const raw = resultOf(await transport.getSchema(indices, signal));
    requireThat(Array.isArray(raw.columns) && raw.columns.length === indices.length, "schema dimensions");
    return raw.columns.map((value, i) => {
      const column = mapArkColumn(value, limits);
      requireThat(column.ordinal === indices[i], "schema projection mismatch");
      return column;
    });
  };
  return {
    open(scope) {
      check(scope);
      return snapshot();
    },
    state(scope, value) {
      check(scope);
      checkHandle(value);
      return snapshot();
    },
    async schema(input, value, signal) {
      const scope = parseScope(input);
      const request = parseSchemaRequest(value, limits);
      return guarded(scope, request.identity, request.requestId, signal, async (cancelSignal) => {
        const offset =
          BigInt(request.offset) >= BigInt(columnCount) ? columnCount : checkedIndex(request.offset, columnCount);
        const count = Math.min(request.limit, columnCount - offset);
        const columns = await schemaColumns(
          Array.from({ length: count }, (_, i) => offset + i),
          cancelSignal,
        );
        return parseSchemaPage(
          {
            identity: request.identity,
            requestId: request.requestId,
            offset: request.offset,
            columns,
            hasMore: offset + count < columnCount,
          },
          request,
          limits,
        );
      });
    },
    async page(input, value, signal) {
      const scope = parseScope(input);
      const request = parsePageRequest(value, limits);
      const ordinals = request.columns.map(ordinal);
      requireThat(
        projection === null || request.columns.every((id) => projection?.includes(id)),
        "Column outside query projection",
      );
      return guarded(scope, request.identity, request.requestId, signal, async (cancelSignal) => {
        const offset = BigInt(request.offset) >= BigInt(rows) ? rows : checkedIndex(request.offset, rows);
        const count = Math.min(request.limit, rows - offset);
        let columns: Page["columns"] = request.columns.map((id) => ({ id, values: [] }));
        if (count) {
          const schema = await schemaColumns(ordinals, cancelSignal);
          requireThat(!cancelSignal.aborted, "Cancelled");
          check(scope, request.identity);
          const raw = resultOf(
            await transport.getDataValues(
              {
                columns: ordinals.map((column_index) => ({
                  column_index,
                  spec: { first_index: offset, last_index: offset + count - 1 },
                })),
                format_options: {
                  large_num_digits: 2,
                  small_num_digits: 4,
                  max_integral_digits: 7,
                  max_value_length: limits.maxPreviewBytes,
                  thousands_sep: null,
                },
              },
              cancelSignal,
            ),
          );
          requireThat(Array.isArray(raw.columns) && raw.columns.length === schema.length, "page dimensions");
          columns = raw.columns.map((values, i) => {
            requireThat(Array.isArray(values) && values.length === count, "column values dimensions");
            const column = schema[i];
            requireThat(column, "schema projection mismatch");
            return { id: column.id, values: values.map((cell) => mapArkCell(cell, column, limits)) };
          });
        }
        return parsePage(
          {
            identity: request.identity,
            requestId: request.requestId,
            offset: request.offset,
            rowCount: count,
            columns,
            hasMore: offset + count < rows,
          },
          request,
          limits,
        );
      });
    },
    query(scope, value) {
      const request = parseQueryRequest(value, limits);
      check(scope, request.identity);
      request.query.projection.forEach(ordinal);
      request.query.sort.forEach((sort) => ordinal(sort.column));
      if (request.query.filter) ordinal(request.query.filter.column);
      if (request.query.sort.length) return unsupported("sort");
      if (request.query.filter) return unsupported("filter");
      const queryEpoch = boundedInt(identity.queryEpoch + 1, 1, Number.MAX_SAFE_INTEGER);
      cancel();
      projection = request.query.projection;
      identity = { ...identity, queryEpoch };
      return { kind: "applied", state: snapshot() };
    },
    profile(scope, value) {
      const request = parseProfileRequest(value, limits);
      check(scope, request.identity);
      request.columns.forEach(ordinal);
      return unsupported("profile");
    },
    export(scope, value) {
      check(scope, parseIdentity(value));
      return unsupported("export");
    },
    // Invalidates this prepared snapshot only. Runtime mutations require a new preparation.
    refresh(scope, value) {
      check(scope, parseIdentity(value));
      const dataRevision = boundedInt(identity.dataRevision + 1, 1, Number.MAX_SAFE_INTEGER);
      const schemaRevision = boundedInt(identity.schemaRevision + 1, 1, Number.MAX_SAFE_INTEGER);
      cancel();
      identity = { ...identity, dataRevision, schemaRevision };
      return snapshot();
    },
    close(scope, value) {
      const parsed = parseScope(scope);
      requireThat(authorize({ ...parsed }) && sameScope(parsed, owner), "host authorization denied");
      checkHandle(value);
      dispose();
    },
    revoke(scope) {
      if (sameScope(parseScope(scope), owner)) dispose();
    },
  };
}

/** Typed page helper when schema columns are known (preferred over unknown inference). */
export function mapArkPageWithSchema(args: {
  identity: Identity;
  requestId: string;
  offset: string;
  schemaColumns: Column[];
  wireColumns: unknown[][];
  limits?: Limits;
}): Page {
  const limits = args.limits ?? DEFAULT_LIMITS;
  requireThat(args.schemaColumns.length === args.wireColumns.length, "projection/schema mismatch");
  boundedInt(args.schemaColumns.length, 1, limits.maxColumns);
  const rowCount = boundedInt(args.wireColumns[0]?.length ?? 0, 0, limits.maxRows);
  requireThat(
    args.wireColumns.every((values) => values.length === rowCount),
    "column values dimensions",
  );
  const request = parsePageRequest(
    {
      identity: args.identity,
      requestId: args.requestId,
      offset: args.offset,
      limit: limits.maxRows,
      columns: args.schemaColumns.map((column) => column.id),
    },
    limits,
  );
  return parsePage(
    {
      identity: args.identity,
      requestId: args.requestId,
      offset: args.offset,
      rowCount: args.wireColumns[0]?.length ?? 0,
      columns: args.schemaColumns.map((column, index) => ({
        id: column.id,
        values: (args.wireColumns[index] ?? []).map((cell) => mapArkCell(cell, column, limits)),
      })),
      hasMore: false,
    },
    request,
    limits,
  );
}
