/** JSON contract only. Host adapters must provide their own authorization and transport. */
export interface HostScope {
  project: string;
  window: string;
  document: string;
  generation: string;
  /** Host-issued opaque identity, 1–128 UTF-8 bytes; never a name, path or expression. */
  objectId: string;
  objectRevision: string;
  viewer: string;
}

export interface TableHandle {
  id: string;
  scope: HostScope;
}

export interface Identity {
  handle: TableHandle;
  dataRevision: number;
  schemaRevision: number;
  queryEpoch: number;
}

export const SAS_MISSING_CODES = [
  ".",
  "._",
  ".A",
  ".B",
  ".C",
  ".D",
  ".E",
  ".F",
  ".G",
  ".H",
  ".I",
  ".J",
  ".K",
  ".L",
  ".M",
  ".N",
  ".O",
  ".P",
  ".Q",
  ".R",
  ".S",
  ".T",
  ".U",
  ".V",
  ".W",
  ".X",
  ".Y",
  ".Z",
] as const;

export type Missing =
  | { system: "python"; value: "none" | "pandas-na" | "nat" }
  | {
      system: "r";
      value: "logical" | "integer" | "double" | "complex" | "character" | "date" | "timestamp";
    }
  | { system: "sql"; value: "null" }
  | { system: "sas"; value: (typeof SAS_MISSING_CODES)[number] };

export interface Preview {
  text: string;
  truncated: boolean;
}

/** Date/timestamp: Unix origin; time: midnight; duration: elapsed ticks. */
export type Resolution = "day" | "second" | "millisecond" | "microsecond" | "nanosecond";
export type Cell =
  | { kind: "boolean"; value: boolean }
  | { kind: "integer" | "decimal"; value: string }
  | { kind: "float"; value: { kind: "finite"; value: number } | { kind: "nan" | "+inf" | "-inf" | "-zero" } }
  | { kind: "missing"; value: Missing }
  | { kind: "text" | "binary" | "unsupported" | "error"; preview: Preview }
  | { kind: "category"; dictionaryId: string; dictionaryRevision: string; code: string }
  | {
      kind: "temporal";
      type: "date" | "time" | "timestamp" | "duration";
      ticks: string;
      resolution: Resolution;
      timezone: string | null;
    }
  | { kind: "nested"; type: "list" | "struct" | "array"; size: string; preview: Preview };

export type LogicalType =
  | { kind: "boolean" | "integer" | "decimal" | "float" | "text" | "binary" | "nested" | "unknown" }
  | {
      kind: "category";
      dictionaryId: string;
      dictionaryRevision: string;
      size: string;
      ordered: boolean;
    }
  | {
      kind: "temporal";
      type: "date" | "time" | "timestamp" | "duration";
      resolution: Resolution;
      timezone: string | null;
    };

export interface Column {
  id: string;
  ordinal: number;
  name: string;
  runtimeType: string;
  nullable: boolean;
  type: LogicalType;
}

export type RowCount = { kind: "exact" | "estimated"; value: string } | { kind: "unknown" };
export type Operation = "sort" | "filter" | "profile" | "export";
export interface Unsupported {
  kind: "unsupported";
  operation: Operation;
  reason: string;
}

export interface QuerySpec {
  projection: string[];
  sort: { column: string; direction: "asc" | "desc"; missing: "first" | "last" }[];
  filter: { column: string; operator: "equals"; value: Cell } | null;
}

export interface TableState {
  identity: Identity;
  backend: string;
  rows: RowCount;
  columnCount: string;
  capabilities: { paging: true; projection: true; unsupported: Operation[] };
}

export interface PageRequest {
  identity: Identity;
  requestId: string;
  offset: string;
  limit: number;
  columns: string[];
}

export interface Page {
  identity: Identity;
  requestId: string;
  offset: string;
  rowCount: number;
  columns: { id: string; values: Cell[] }[];
  hasMore: boolean;
}

export interface SchemaRequest {
  identity: Identity;
  requestId: string;
  offset: string;
  limit: number;
}

export interface SchemaPage {
  identity: Identity;
  requestId: string;
  offset: string;
  columns: Column[];
  hasMore: boolean;
}

export interface QueryRequest {
  identity: Identity;
  query: QuerySpec;
}

export interface ProfileRequest {
  identity: Identity;
  columns: string[];
  scope: "dataset" | "filtered";
  kinds: ("missing" | "distinct" | "numeric" | "frequencies")[];
}

export interface Limits {
  maxRows: number;
  maxColumns: number;
  maxResponseBytes: number;
  maxPreviewBytes: number;
}

export interface TableProvider {
  open(scope: unknown): TableState;
  state(scope: unknown, handle: unknown): TableState;
  schema(scope: unknown, request: unknown, signal?: AbortSignal): Promise<SchemaPage>;
  page(scope: unknown, request: unknown, signal?: AbortSignal): Promise<Page>;
  query(scope: unknown, request: unknown): { kind: "applied"; state: TableState } | Unsupported;
  profile(scope: unknown, request: unknown): Unsupported;
  export(scope: unknown, identity: unknown): Unsupported;
  refresh(scope: unknown, identity: unknown): TableState;
  close(scope: unknown, handle: unknown): void;
  revoke(scope: unknown): void;
}
