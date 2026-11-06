/** Transport-injected Ark → U9.1 TableProvider mapping (U9.2a). No session/UI imports. */
import type {
  Cell,
  Column,
  HostScope,
  Identity,
  Limits,
  LogicalType,
  Page,
  SchemaPage,
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
  getState(): Promise<unknown>;
  getSchema(columnIndices: number[]): Promise<unknown>;
  getDataValues(args: {
    columns: { column_index: number; spec: { first_index: number; last_index: number } }[];
    format_options: Record<string, unknown>;
  }): Promise<unknown>;
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
  let end = text.length;
  while (end > 0 && utf8Bytes(text.slice(0, end)) > limits.maxPreviewBytes) end -= 1;
  return { text: text.slice(0, end), truncated: true };
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
  requireThat(args.authorize(scope), "host authorization denied");
  const backendState = await args.transport.getState();
  const handle: TableHandle = { id: args.handleId ?? `ark-${scope.objectId}`, scope };
  const identity: Identity = { handle, dataRevision: 1, schemaRevision: 1, queryEpoch: 1 };
  return { scope, handle, identity, backendState, transport: args.transport };
}

<<<<<<< Updated upstream
export function createArkTableProvider(
  prepared: PreparedArkExplorer,
  authorize: (scope: HostScope) => boolean,
  limits: Limits = DEFAULT_LIMITS,
): TableProvider {
=======
export function createArkTableProvider(prepared: PreparedArkExplorer, authorize: (scope: HostScope) => boolean, limits: Limits = DEFAULT_LIMITS): TableProvider {
>>>>>>> Stashed changes
  let live = true;
  const check = (scope: unknown, identity?: Identity) => {
    requireThat(live, "explorer closed");
    const parsed = parseScope(scope);
    requireThat(authorize(parsed), "host authorization denied");
    requireThat(sameScope(parsed, prepared.scope), "scope mismatch");
    if (identity) requireThat(sameIdentity(identity, prepared.identity), "stale identity");
  };

  const unsupported = (operation: Unsupported["operation"], reason: string): Unsupported => ({
    kind: "unsupported",
    operation,
    reason,
  });

  return {
    open() {
      const state = resultOf(prepared.backendState);
      const shape = record(state.table_shape) ? state.table_shape : {};
      return {
        identity: prepared.identity,
        backend: "ark",
        rows: { kind: "exact", value: String(shape.num_rows ?? 0) },
        columnCount: String(shape.num_columns ?? 0),
        capabilities: { paging: true, projection: true, unsupported: ["sort", "filter", "profile", "export"] },
      } satisfies TableState;
    },
    state(scope) {
      check(scope);
      return this.open(scope);
    },
    async schema(scope, request) {
      check(scope);
      requireThat(record(request));
      const identity = parseIdentity(request.identity);
      requireThat(sameIdentity(identity, prepared.identity), "stale identity");
      const offset = checkedIndex(request.offset, Number.MAX_SAFE_INTEGER);
      const limit = boundedInt(request.limit, 1, limits.maxColumns);
      const indices = Array.from({ length: limit }, (_, i) => offset + i);
      const raw = await prepared.transport.getSchema(indices);
      check(scope);
      const result = resultOf(raw);
      const columns = Array.isArray(result.columns) ? result.columns.map((c) => mapArkColumn(c, limits)) : [];
      return {
        identity: prepared.identity,
        requestId: String(request.requestId),
        offset: String(offset),
        columns,
        hasMore: columns.length === limit,
      } satisfies SchemaPage;
    },
    async page(scope, request) {
      check(scope);
      requireThat(record(request));
      const identity = parseIdentity(request.identity);
      requireThat(sameIdentity(identity, prepared.identity), "stale identity");
      const offset = checkedIndex(request.offset, Number.MAX_SAFE_INTEGER);
      const limit = boundedInt(request.limit, 1, limits.maxRows);
      const columnIds = Array.isArray(request.columns) ? request.columns.map(String) : [];
      requireThat(columnIds.length > 0 && columnIds.length <= limits.maxColumns, "projection bound");
      const ordinals = columnIds.map((id) => {
        const match = /^ark-col-(\d+)$/.exec(id);
        requireThat(match, `unknown column id ${id}`);
        return Number(match[1]);
      });
      const last = offset + limit - 1;
      const raw = await prepared.transport.getDataValues({
        columns: ordinals.map((column_index) => ({
          column_index,
          spec: { first_index: offset, last_index: last },
        })),
        format_options: {
          large_num_digits: 2,
          small_num_digits: 4,
          max_integral_digits: 7,
          max_value_length: 100,
          thousands_sep: null,
        },
      });
      check(scope);
      const result = resultOf(raw);
      const wireColumns = Array.isArray(result.columns) ? result.columns : [];
      const schemaCols = ordinals.map((ordinal) =>
        mapArkColumn({ column_name: "", column_index: ordinal, type_name: "unknown", type_display: "object" }, limits),
      );
      // Prefer logical types from ids alone when schema not re-fetched: mark float/text carefully via id only.
      const columns = wireColumns.map((values, index) => {
        const id = columnIds[index];
        const column: Column = {
          id,
          ordinal: ordinals[index],
          name: "",
          runtimeType: "unknown",
          nullable: true,
          type: { kind: "unknown" },
        };
        // Infer from prepared schema if available via ark-col ordinal only — caller should pass typed columns via prior schema page.
        void schemaCols;
        requireThat(Array.isArray(values), "column values");
        return {
          id,
          values: values.map((cell) => mapArkCell(cell, column, limits)),
        };
      });
      return {
        identity: prepared.identity,
        requestId: String(request.requestId),
        offset: String(offset),
        rowCount: limit,
        columns,
        hasMore: true,
      } satisfies Page;
    },
    query: () => unsupported("sort", "U9.2a read-only; sort/filter deferred"),
    profile: () => unsupported("profile", "U9.2a read-only; profile deferred"),
    export: () => unsupported("export", "U9.2a read-only; export deferred"),
    refresh(scope) {
      check(scope);
      return this.open(scope);
    },
    close(scope) {
      check(scope);
      live = false;
      void prepared.transport.close();
    },
    revoke(scope) {
      const parsed = parseScope(scope);
      if (sameScope(parsed, prepared.scope)) live = false;
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
  return {
    identity: args.identity,
    requestId: args.requestId,
    offset: args.offset,
    rowCount: args.wireColumns[0]?.length ?? 0,
    columns: args.schemaColumns.map((column, index) => ({
      id: column.id,
      values: (args.wireColumns[index] ?? []).map((cell) => mapArkCell(cell, column, limits)),
    })),
    hasMore: false,
  };
}
