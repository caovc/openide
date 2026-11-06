import { describe, expect, it } from "vitest";
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
    expect(page.columns[0].values[1]).toEqual({ kind: "missing", value: { system: "r", value: "integer" } });
    expect(page.columns[1].values[1]).toEqual({ kind: "float", value: { kind: "nan" } });
    expect(page.columns[1].values[2]).toEqual({ kind: "float", value: { kind: "+inf" } });
  });

  it("prepare + provider revoke/close and stale identity", async () => {
    const transport = {
      getState: async () => ({
        method: "GetStateReply",
<<<<<<< Updated upstream
        result: {
          display_name: "df",
          table_shape: { num_rows: 3, num_columns: 2 },
          table_unfiltered_shape: { num_rows: 3, num_columns: 2 },
        },
=======
        result: { display_name: "df", table_shape: { num_rows: 3, num_columns: 2 }, table_unfiltered_shape: { num_rows: 3, num_columns: 2 } },
>>>>>>> Stashed changes
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
