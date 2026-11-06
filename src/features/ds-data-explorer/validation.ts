import { SAS_MISSING_CODES } from "./contract";
import type {
  Cell,
  Column,
  HostScope,
  Identity,
  Limits,
  LogicalType,
  Missing,
  Page,
  PageRequest,
  Preview,
  ProfileRequest,
  QueryRequest,
  Resolution,
  SchemaPage,
  SchemaRequest,
  TableHandle,
  TableState,
  Unsupported,
} from "./contract";

export class ContractError extends Error {}

export function requireThat(condition: unknown, message = "Invalid envelope"): asserts condition {
  if (!condition) throw new ContractError(message);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  requireThat(record(value));
  requireThat(Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)));
  return value;
}

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function string(value: unknown, max = 128, empty = false): string {
  requireThat(typeof value === "string" && (empty || value.length > 0) && value.length <= max);
  requireThat(utf8Bytes(value) <= max);
  return value;
}

function boolean(value: unknown): boolean {
  requireThat(typeof value === "boolean");
  return value;
}

export function boundedInt(value: unknown, min: number, max: number): number {
  requireThat(typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max);
  return value;
}

function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  for (const candidate of choices) if (candidate === value) return candidate;
  throw new ContractError("Invalid tag");
}

export function unsigned(value: unknown): string {
  const result = string(value);
  requireThat(/^(0|[1-9][0-9]*)$/.test(result));
  return result;
}

function signed(value: unknown): string {
  const result = string(value);
  requireThat(/^(0|-?[1-9][0-9]*)$/.test(result));
  return result;
}

/** Never use Number(offset) before this range check. Huge valid offsets remain usable on the wire. */
export function checkedIndex(value: unknown, max: number): number {
  boundedInt(max, 0, Number.MAX_SAFE_INTEGER);
  const result = BigInt(unsigned(value));
  requireThat(result <= BigInt(max), "Index exceeds local bound");
  return Number(result);
}

function array(value: unknown, max: number): unknown[] {
  requireThat(Array.isArray(value) && value.length <= max);
  requireThat(Object.keys(value).length === value.length);
  for (let index = 0; index < value.length; index++) requireThat(Object.hasOwn(value, index));
  return value;
}

export function ids(value: unknown, max: number): string[] {
  const result = array(value, max).map((item) => string(item));
  requireThat(result.length > 0 && new Set(result).size === result.length);
  return result;
}

export function parseScope(value: unknown): HostScope {
  const v = object(value, ["project", "window", "document", "generation", "objectId", "objectRevision", "viewer"]);
  return {
    project: string(v.project),
    window: string(v.window),
    document: string(v.document),
    generation: string(v.generation),
    objectId: string(v.objectId),
    objectRevision: string(v.objectRevision),
    viewer: string(v.viewer),
  };
}

export function parseHandle(value: unknown): TableHandle {
  const v = object(value, ["id", "scope"]);
  return { id: string(v.id), scope: parseScope(v.scope) };
}

export function parseIdentity(value: unknown): Identity {
  const v = object(value, ["handle", "dataRevision", "schemaRevision", "queryEpoch"]);
  return {
    handle: parseHandle(v.handle),
    dataRevision: boundedInt(v.dataRevision, 1, Number.MAX_SAFE_INTEGER),
    schemaRevision: boundedInt(v.schemaRevision, 1, Number.MAX_SAFE_INTEGER),
    queryEpoch: boundedInt(v.queryEpoch, 1, Number.MAX_SAFE_INTEGER),
  };
}

export function sameScope(a: HostScope, b: HostScope): boolean {
  return (
    a.project === b.project &&
    a.window === b.window &&
    a.document === b.document &&
    a.generation === b.generation &&
    a.objectId === b.objectId &&
    a.objectRevision === b.objectRevision &&
    a.viewer === b.viewer
  );
}

export function sameIdentity(a: Identity, b: Identity): boolean {
  return (
    a.handle.id === b.handle.id &&
    sameScope(a.handle.scope, b.handle.scope) &&
    a.dataRevision === b.dataRevision &&
    a.schemaRevision === b.schemaRevision &&
    a.queryEpoch === b.queryEpoch
  );
}

function preview(value: unknown, limits: Limits): Preview {
  const v = object(value, ["text", "truncated"]);
  return { text: string(v.text, limits.maxPreviewBytes, true), truncated: boolean(v.truncated) };
}

function missing(value: unknown): Missing {
  const v = object(value, ["system", "value"]);
  switch (v.system) {
    case "python":
      return { system: "python", value: choice(v.value, ["none", "pandas-na", "nat"]) };
    case "r":
      return {
        system: "r",
        value: choice(v.value, ["logical", "integer", "double", "complex", "character", "date", "timestamp"]),
      };
    case "sql":
      return { system: "sql", value: choice(v.value, ["null"]) };
    case "sas":
      return { system: "sas", value: choice(v.value, SAS_MISSING_CODES) };
    default:
      throw new ContractError("Invalid missing system");
  }
}

function resolution(value: unknown): Resolution {
  return choice(value, ["day", "second", "millisecond", "microsecond", "nanosecond"]);
}

function timezone(value: unknown): string | null {
  return value === null ? null : string(value);
}

export function parseCell(value: unknown, limits: Limits): Cell {
  requireThat(record(value));
  switch (value.kind) {
    case "boolean": {
      const v = object(value, ["kind", "value"]);
      return { kind: "boolean", value: boolean(v.value) };
    }
    case "integer":
    case "decimal": {
      const v = object(value, ["kind", "value"]);
      const number = value.kind === "integer" ? signed(v.value) : string(v.value);
      requireThat(value.kind === "integer" || /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(number));
      return { kind: value.kind, value: number };
    }
    case "float": {
      const v = object(value, ["kind", "value"]);
      requireThat(record(v.value));
      if (v.value.kind === "finite") {
        const f = object(v.value, ["kind", "value"]);
        requireThat(typeof f.value === "number" && Number.isFinite(f.value) && !Object.is(f.value, -0));
        return { kind: "float", value: { kind: "finite", value: f.value } };
      }
      const f = object(v.value, ["kind"]);
      return { kind: "float", value: { kind: choice(f.kind, ["nan", "+inf", "-inf", "-zero"]) } };
    }
    case "missing": {
      const v = object(value, ["kind", "value"]);
      return { kind: "missing", value: missing(v.value) };
    }
    case "text":
    case "binary":
    case "unsupported":
    case "error": {
      const v = object(value, ["kind", "preview"]);
      return { kind: value.kind, preview: preview(v.preview, limits) };
    }
    case "category": {
      const v = object(value, ["kind", "dictionaryId", "dictionaryRevision", "code"]);
      return {
        kind: "category",
        dictionaryId: string(v.dictionaryId),
        dictionaryRevision: string(v.dictionaryRevision),
        code: unsigned(v.code),
      };
    }
    case "temporal": {
      const v = object(value, ["kind", "type", "ticks", "resolution", "timezone"]);
      return {
        kind: "temporal",
        type: choice(v.type, ["date", "time", "timestamp", "duration"]),
        ticks: signed(v.ticks),
        resolution: resolution(v.resolution),
        timezone: timezone(v.timezone),
      };
    }
    case "nested": {
      const v = object(value, ["kind", "type", "size", "preview"]);
      return {
        kind: "nested",
        type: choice(v.type, ["list", "struct", "array"]),
        size: unsigned(v.size),
        preview: preview(v.preview, limits),
      };
    }
    default:
      throw new ContractError("Invalid cell tag");
  }
}

function logicalType(value: unknown): LogicalType {
  requireThat(record(value));
  if (value.kind === "category") {
    const v = object(value, ["kind", "dictionaryId", "dictionaryRevision", "size", "ordered"]);
    return {
      kind: "category",
      dictionaryId: string(v.dictionaryId),
      dictionaryRevision: string(v.dictionaryRevision),
      size: unsigned(v.size),
      ordered: boolean(v.ordered),
    };
  }
  if (value.kind === "temporal") {
    const v = object(value, ["kind", "type", "resolution", "timezone"]);
    return {
      kind: "temporal",
      type: choice(v.type, ["date", "time", "timestamp", "duration"]),
      resolution: resolution(v.resolution),
      timezone: timezone(v.timezone),
    };
  }
  const v = object(value, ["kind"]);
  return { kind: choice(v.kind, ["boolean", "integer", "decimal", "float", "text", "binary", "nested", "unknown"]) };
}

function column(value: unknown, limits: Limits): Column {
  const v = object(value, ["id", "ordinal", "name", "runtimeType", "nullable", "type"]);
  return {
    id: string(v.id),
    ordinal: boundedInt(v.ordinal, 0, Number.MAX_SAFE_INTEGER),
    name: string(v.name, limits.maxPreviewBytes, true),
    runtimeType: string(v.runtimeType),
    nullable: boolean(v.nullable),
    type: logicalType(v.type),
  };
}

export function parsePageRequest(value: unknown, limits: Limits): PageRequest {
  const v = object(value, ["identity", "requestId", "offset", "limit", "columns"]);
  return {
    identity: parseIdentity(v.identity),
    requestId: string(v.requestId),
    offset: unsigned(v.offset),
    limit: boundedInt(v.limit, 1, limits.maxRows),
    columns: ids(v.columns, limits.maxColumns),
  };
}

export function parseSchemaRequest(value: unknown, limits: Limits): SchemaRequest {
  const v = object(value, ["identity", "requestId", "offset", "limit"]);
  return {
    identity: parseIdentity(v.identity),
    requestId: string(v.requestId),
    offset: unsigned(v.offset),
    limit: boundedInt(v.limit, 1, limits.maxColumns),
  };
}

export function parseQueryRequest(value: unknown, limits: Limits): QueryRequest {
  const v = object(value, ["identity", "query"]);
  const q = object(v.query, ["projection", "sort", "filter"]);
  const sort = array(q.sort, limits.maxColumns).map((item) => {
    const s = object(item, ["column", "direction", "missing"]);
    return {
      column: string(s.column),
      direction: choice(s.direction, ["asc", "desc"]),
      missing: choice(s.missing, ["first", "last"]),
    };
  });
  let filter = null;
  if (q.filter !== null) {
    const f = object(q.filter, ["column", "operator", "value"]);
    filter = { column: string(f.column), operator: choice(f.operator, ["equals"]), value: parseCell(f.value, limits) };
  }
  return {
    identity: parseIdentity(v.identity),
    query: { projection: ids(q.projection, limits.maxColumns), sort, filter },
  };
}

export function parseProfileRequest(value: unknown, limits: Limits): ProfileRequest {
  const v = object(value, ["identity", "columns", "scope", "kinds"]);
  const kinds: ProfileRequest["kinds"] = array(v.kinds, 4).map((kind) =>
    choice(kind, ["missing", "distinct", "numeric", "frequencies"]),
  );
  requireThat(kinds.length > 0 && new Set(kinds).size === kinds.length);
  return {
    identity: parseIdentity(v.identity),
    columns: ids(v.columns, limits.maxColumns),
    scope: choice(v.scope, ["dataset", "filtered"]),
    kinds,
  };
}

export function jsonBytes(value: unknown): number {
  const wire = JSON.stringify(value);
  requireThat(typeof wire === "string");
  return utf8Bytes(wire);
}

function correlate(identity: Identity, requestId: string, offset: string, request: SchemaRequest): void {
  requireThat(
    sameIdentity(identity, request.identity) && requestId === request.requestId && offset === request.offset,
    "Uncorrelated response",
  );
}

export function parsePage(value: unknown, expected: PageRequest, limits: Limits): Page {
  const request = parsePageRequest(expected, limits);
  const v = object(value, ["identity", "requestId", "offset", "rowCount", "columns", "hasMore"]);
  const identity = parseIdentity(v.identity);
  const requestId = string(v.requestId);
  const offset = unsigned(v.offset);
  correlate(identity, requestId, offset, request);
  const rowCount = boundedInt(v.rowCount, 0, request.limit);
  const columns = array(v.columns, limits.maxColumns).map((item, i) => {
    const c = object(item, ["id", "values"]);
    const id = string(c.id);
    requireThat(id === request.columns[i]);
    const values = array(c.values, request.limit).map((cell) => parseCell(cell, limits));
    requireThat(values.length === rowCount);
    return { id, values };
  });
  requireThat(columns.length === request.columns.length);
  const hasMore = boolean(v.hasMore);
  requireThat(!hasMore || rowCount === request.limit);
  const result = { identity, requestId, offset, rowCount, columns, hasMore };
  requireThat(jsonBytes(result) <= limits.maxResponseBytes, "Response byte budget exceeded");
  return result;
}

export function parseSchemaPage(value: unknown, expected: SchemaRequest, limits: Limits): SchemaPage {
  const request = parseSchemaRequest(expected, limits);
  const v = object(value, ["identity", "requestId", "offset", "columns", "hasMore"]);
  const identity = parseIdentity(v.identity);
  const requestId = string(v.requestId);
  const offset = unsigned(v.offset);
  correlate(identity, requestId, offset, request);
  const columns = array(v.columns, request.limit).map((item) => column(item, limits));
  columns.forEach((c, i) => requireThat(BigInt(c.ordinal) === BigInt(offset) + BigInt(i)));
  requireThat(new Set(columns.map((c) => c.id)).size === columns.length);
  const hasMore = boolean(v.hasMore);
  requireThat(!hasMore || columns.length === request.limit);
  const result = { identity, requestId, offset, columns, hasMore };
  requireThat(jsonBytes(result) <= limits.maxResponseBytes, "Response byte budget exceeded");
  return result;
}

export function parseUnsupported(value: unknown): Unsupported {
  const v = object(value, ["kind", "operation", "reason"]);
  requireThat(v.kind === "unsupported");
  return {
    kind: "unsupported",
    operation: choice(v.operation, ["sort", "filter", "profile", "export"]),
    reason: string(v.reason, 512),
  };
}

export function parseTableState(value: unknown, expectedHandle: TableHandle): TableState {
  const handle = parseHandle(expectedHandle);
  const v = object(value, ["identity", "backend", "rows", "columnCount", "capabilities"]);
  const identity = parseIdentity(v.identity);
  requireThat(identity.handle.id === handle.id && sameScope(identity.handle.scope, handle.scope), "Uncorrelated state");
  requireThat(record(v.rows));
  let rows: TableState["rows"];
  if (v.rows.kind === "unknown") {
    object(v.rows, ["kind"]);
    rows = { kind: "unknown" };
  } else {
    const r = object(v.rows, ["kind", "value"]);
    rows = { kind: choice(r.kind, ["exact", "estimated"]), value: unsigned(r.value) };
  }
  const c = object(v.capabilities, ["paging", "projection", "unsupported"]);
  requireThat(c.paging === true && c.projection === true);
  const unsupported: Unsupported["operation"][] = array(c.unsupported, 4).map((op) =>
    choice(op, ["sort", "filter", "profile", "export"]),
  );
  requireThat(new Set(unsupported).size === unsupported.length);
  return {
    identity,
    backend: string(v.backend),
    rows,
    columnCount: unsigned(v.columnCount),
    capabilities: { paging: true, projection: true, unsupported },
  };
}
