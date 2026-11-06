import { describe, expect, it, vi } from "vitest";
import {
  ARK_INF,
  ARK_NA,
  ARK_NAN,
  ARK_NEG_INF,
  ARK_NULL,
  mapArkCell,
  mapArkColumn,
  mapArkPageWithSchema,
  prepareArkExplorer,
  createArkTableProvider,
} from "./ark";
import type { Column } from "./contract";

const scope = {
  project: "p",
  window: "w",
  document: "d",
  generation: "g1",
  objectId: "obj-df",
  objectRevision: "1",
  viewer: "v1",
};

const intCol: Column = {
  id: "ark-col-0",
  ordinal: 0,
  name: "i",
  runtimeType: "integer",
  nullable: true,
  type: { kind: "integer" },
};
const logicalCol: Column = {
  id: "ark-col-1",
  ordinal: 1,
  name: "l",
  runtimeType: "logical",
  nullable: true,
  type: { kind: "boolean" },
};
const textCol: Column = {
  id: "ark-col-2",
  ordinal: 2,
  name: "s",
  runtimeType: "character",
  nullable: true,
  type: { kind: "text" },
};
const floatCol: Column = {
  id: "ark-col-3",
  ordinal: 3,
  name: "d",
  runtimeType: "double",
  nullable: true,
  type: { kind: "float" },
};

describe("ark wire mapping", () => {
  it("maps schema ordinals and duplicate names", () => {
    const a = mapArkColumn({ column_name: "s", column_index: 2, type_name: "character", type_display: "string" });
    const b = mapArkColumn({ column_name: "s", column_index: 4, type_name: "character", type_display: "string" });
    expect(a.name).toBe("s");
    expect(b.name).toBe("s");
    expect(a.id).not.toBe(b.id);
    expect(a.ordinal).toBe(2);
    expect(b.ordinal).toBe(4);
  });

  it("preserves NA/NaN/Inf/-Inf and exact logical/integer/text", () => {
    expect(mapArkCell(ARK_NA, intCol)).toEqual({ kind: "missing", value: { system: "r", value: "integer" } });
    expect(mapArkCell(ARK_NA, logicalCol)).toEqual({ kind: "missing", value: { system: "r", value: "logical" } });
    expect(mapArkCell(ARK_NA, textCol)).toEqual({ kind: "missing", value: { system: "r", value: "character" } });
    expect(mapArkCell(ARK_NAN, floatCol)).toEqual({ kind: "float", value: { kind: "nan" } });
    expect(mapArkCell(ARK_INF, floatCol)).toEqual({ kind: "float", value: { kind: "+inf" } });
    expect(mapArkCell(ARK_NEG_INF, floatCol)).toEqual({ kind: "float", value: { kind: "-inf" } });
    expect(mapArkCell(ARK_NULL, floatCol)).toEqual({ kind: "missing", value: { system: "sql", value: "null" } });
    expect(mapArkCell("1", intCol)).toEqual({ kind: "integer", value: "1" });
    expect(mapArkCell("TRUE", logicalCol)).toEqual({ kind: "boolean", value: true });
    expect(mapArkCell("", textCol)).toEqual({ kind: "text", preview: { text: "", truncated: false } });
    expect(mapArkCell("1.50", floatCol)).toEqual({
      kind: "unsupported",
      preview: { text: "1.50", truncated: false },
    });
  });

  it("rejects unknown sentinel codes", () => {
    expect(() => mapArkCell(99, intCol)).toThrow(/unknown Ark special value code/);
  });

  it("maps a bounded page with schema", () => {
    const page = mapArkPageWithSchema({
      identity: {
        handle: { id: "h", scope },
        dataRevision: 1,
        schemaRevision: 1,
        queryEpoch: 1,
      },
      requestId: "r1",
      offset: "0",
      schemaColumns: [intCol, floatCol],
      wireColumns: [
        ["1", ARK_NA, "3"],
        ["1.50", ARK_NAN, ARK_INF],
      ],
    });
    expect(page.columns[0]?.values[1]).toEqual({ kind: "missing", value: { system: "r", value: "integer" } });
    expect(page.columns[1]?.values[1]).toEqual({ kind: "float", value: { kind: "nan" } });
    expect(page.columns[1]?.values[2]).toEqual({ kind: "float", value: { kind: "+inf" } });
  });

  it("prepare + provider revoke/close and stale identity", async () => {
    const transport = {
      getState: async () => ({
        method: "GetStateReply",
        result: {
          display_name: "df",
          table_shape: { num_rows: 3, num_columns: 2 },
          table_unfiltered_shape: { num_rows: 3, num_columns: 2 },
        },
      }),
      getSchema: async () => ({
        method: "GetSchemaReply",
        result: {
          columns: [
            { column_name: "i", column_index: 0, type_name: "integer", type_display: "integer" },
            { column_name: "d", column_index: 1, type_name: "double", type_display: "floating" },
          ],
        },
      }),
      getDataValues: async () => ({
        method: "GetDataValuesReply",
        result: { columns: [["1"], ["1.00"]] },
      }),
      close: async () => {},
    };
    const prepared = await prepareArkExplorer({ scope, transport, authorize: () => true });
    const provider = createArkTableProvider(prepared, () => true);
    const state = provider.open(scope);
    expect(state.rows).toEqual({ kind: "exact", value: "3" });
    const schema = await provider.schema(scope, {
      identity: prepared.identity,
      requestId: "s1",
      offset: "0",
      limit: 2,
    });
    expect(schema.columns.map((c) => c.name)).toEqual(["i", "d"]);
    provider.revoke(scope);
    expect(() => provider.state(scope, prepared.handle)).toThrow();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setup(authorize = () => true) {
  const transport = {
    getState: vi.fn(async () => ({ table_shape: { num_rows: 3, num_columns: 2 } })),
    getSchema: vi.fn(async (indices: number[], _signal?: AbortSignal): Promise<unknown> => ({
      columns: indices.map((column_index) => ({
        column_index,
        column_name: "i",
        type_name: "integer",
        type_display: "integer",
      })),
    })),
    getDataValues: vi.fn(
      async (args: { columns: { spec: { first_index: number; last_index: number } }[] }): Promise<unknown> => ({
        columns: args.columns.map(({ spec }) =>
          Array.from({ length: spec.last_index - spec.first_index + 1 }, (_, i) => String(spec.first_index + i)),
        ),
      }),
    ),
    close: vi.fn(async () => {}),
  };
  const prepared = await prepareArkExplorer({ scope, transport, authorize });
  const provider = createArkTableProvider(prepared, authorize);
  const request = {
    identity: provider.open(scope).identity,
    requestId: "page",
    offset: "0",
    limit: 2,
    columns: ["ark-col-0"],
  };
  return { transport, prepared, provider, request };
}

describe("Ark provider boundary", () => {
  it("checks scope and handles and keeps returned identities independent", async () => {
    const { provider, prepared, request } = await setup();
    expect(() => provider.open({ ...scope, objectId: "other" })).toThrow(/scope/);
    expect(() => provider.state(scope, { ...prepared.handle, id: "other" })).toThrow(/handle/);
    expect(() => provider.close(scope, { ...prepared.handle, id: "other" })).toThrow(/handle/);
    provider.open(scope).identity.handle.scope.objectId = "mutated";
    prepared.identity.handle.scope.objectId = "also-mutated";
    expect((await provider.page(scope, request)).rowCount).toBe(2);
  });

  it("rechecks authority after preparation and async work", async () => {
    let allowed = true;
    const { provider, transport, request } = await setup(() => allowed);
    const reply = deferred<unknown>();
    transport.getSchema.mockReturnValueOnce(reply.promise);
    const page = provider.page(scope, request);
    allowed = false;
    reply.resolve({ columns: [{ column_index: 0, type_name: "integer", type_display: "integer" }] });
    await expect(page).rejects.toThrow(/authorization/);
    expect(transport.getDataValues).not.toHaveBeenCalled();
    expect(() => provider.export(scope, request.identity)).toThrow(/authorization/);
    const getState = deferred<unknown>();
    allowed = true;
    const preparing = prepareArkExplorer({
      scope,
      authorize: () => allowed,
      transport: { ...transport, getState: () => getState.promise },
    });
    allowed = false;
    getState.resolve({ table_shape: { num_rows: 0, num_columns: 0 } });
    await expect(preparing).rejects.toThrow(/authorization/);
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it("clamps the final page and returns an empty huge offset without backend calls", async () => {
    const { provider, transport, request } = await setup();
    const page = await provider.page(scope, { ...request, offset: "2" });
    expect(page).toMatchObject({
      rowCount: 1,
      hasMore: false,
      columns: [{ id: "ark-col-0", values: [{ kind: "integer", value: "2" }] }],
    });
    transport.getDataValues.mockClear();
    const empty = await provider.page(scope, { ...request, offset: "9999999999999999999999" });
    expect(empty).toMatchObject({ offset: "9999999999999999999999", rowCount: 0, hasMore: false });
    expect(transport.getDataValues).not.toHaveBeenCalled();
    const schema = await provider.schema(scope, { identity: request.identity, requestId: "s", offset: "1", limit: 2 });
    expect(schema.columns).toHaveLength(1);
    expect(schema.hasMore).toBe(false);
  });

  it("rejects malformed requests and backend dimensions", async () => {
    const { provider, transport, request } = await setup();
    await expect(provider.page(scope, { ...request, columns: ["ark-col-0", "ark-col-0"] })).rejects.toThrow();
    await expect(provider.page(scope, { ...request, columns: ["ark-col-9007199254740992"] })).rejects.toThrow();
    await expect(provider.page(scope, { ...request, requestId: {} })).rejects.toThrow();
    transport.getDataValues.mockResolvedValueOnce({ columns: [["1"]] });
    await expect(provider.page(scope, request)).rejects.toThrow(/dimensions/);
    transport.getSchema.mockResolvedValueOnce({ columns: [{ column_index: 1 }] });
    await expect(provider.page(scope, request)).rejects.toThrow(/projection/);
  });

  it("cancels stalled work, passes cancellation to transport and snapshots requests", async () => {
    const { provider, transport, request } = await setup();
    const reply = deferred<unknown>();
    transport.getSchema.mockReturnValueOnce(reply.promise);
    const controller = new AbortController();
    const page = provider.page(scope, request, controller.signal);
    const signal = transport.getSchema.mock.calls[0]?.[1];
    request.identity.dataRevision = 9;
    request.requestId = "mutated";
    controller.abort();
    await expect(page).rejects.toThrow(/Cancelled/);
    expect(signal?.aborted).toBe(true);
    reply.resolve({ columns: [{ column_index: 0 }] });
    await Promise.resolve();
    expect(transport.getDataValues).not.toHaveBeenCalled();
  });

  it("revokes pending work and releases transport once, even after authorization loss", async () => {
    let allowed = true;
    const { provider, transport, request } = await setup(() => allowed);
    transport.getSchema.mockReturnValueOnce(new Promise(() => {}));
    const page = provider.page(scope, request);
    await expect(provider.page(scope, request)).rejects.toThrow(/Duplicate/);
    allowed = false;
    provider.revoke(scope);
    provider.revoke(scope);
    await expect(page).rejects.toThrow(/Cancelled/);
    expect(transport.close).toHaveBeenCalledTimes(1);
    expect(() => provider.open(scope)).toThrow(/closed/);
  });

  it("invalidates old requests on projection and refresh, and closes idempotently", async () => {
    const { provider, request, transport } = await setup();
    const query = provider.query(scope, {
      identity: request.identity,
      query: { projection: ["ark-col-1"], sort: [], filter: null },
    });
    expect(query.kind).toBe("applied");
    if (query.kind !== "applied") throw new Error("projection rejected");
    await expect(provider.page(scope, { ...request, columns: ["ark-col-1"] })).rejects.toThrow(/stale/);
    const refreshed = provider.refresh(scope, query.state.identity);
    await expect(provider.page(scope, { ...request, identity: refreshed.identity })).rejects.toThrow(/projection/);
    expect(() => provider.refresh(scope, query.state.identity)).toThrow(/stale/);
    provider.close(scope, refreshed.identity.handle);
    provider.close(scope, refreshed.identity.handle);
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it("enforces configured response budgets and bounded typed helper dimensions", async () => {
    const { prepared, request } = await setup();
    const provider = createArkTableProvider(prepared, () => true, {
      maxRows: 2,
      maxColumns: 2,
      maxPreviewBytes: 8,
      maxResponseBytes: 32,
    });
    await expect(provider.page(scope, request)).rejects.toThrow(/byte budget/);
    expect(() =>
      mapArkPageWithSchema({
        identity: request.identity,
        requestId: "p",
        offset: "0",
        schemaColumns: [intCol, textCol],
        wireColumns: [["1"], []],
      }),
    ).toThrow();
    expect(
      mapArkCell("🙂x", textCol, { maxRows: 1, maxColumns: 1, maxPreviewBytes: 3, maxResponseBytes: 1000 }),
    ).toEqual({ kind: "text", preview: { text: "", truncated: true } });
  });
});

describe("Ark asynchronous correlation", () => {
  it("snapshots caller-owned request/scope across transport waits", async () => {
    const { provider, request, transport } = await setup();
    const reply = deferred<unknown>();
    transport.getSchema.mockReturnValueOnce(reply.promise);
    const callerScope = { ...scope };
    const pagePromise = provider.page(callerScope, request);
    request.requestId = "mutated";
    request.offset = "2";
    request.columns[0] = "ark-col-1";
    request.identity.dataRevision = 55;
    callerScope.objectId = "mutated";
    reply.resolve({ columns: [{ column_index: 0, type_name: "integer", type_display: "integer" }] });
    const page = await pagePromise;
    expect(page).toMatchObject({ requestId: "page", offset: "0", rowCount: 2, columns: [{ id: "ark-col-0" }] });
    expect(page.identity.dataRevision).toBe(1);
  });

  it("rejects pre-aborted work without transport and cancels on refresh", async () => {
    const { provider, request, transport } = await setup();
    const controller = new AbortController();
    controller.abort();
    await expect(provider.page(scope, request, controller.signal)).rejects.toThrow(/Cancelled/);
    expect(transport.getSchema).not.toHaveBeenCalled();
    transport.getSchema.mockReturnValueOnce(new Promise(() => {}));
    const pending = provider.page(scope, request);
    const refreshed = provider.refresh(scope, request.identity);
    await expect(pending).rejects.toThrow(/Cancelled/);
    expect(refreshed.identity.dataRevision).toBe(2);
  });
});
