import { describe, expect, it } from "vitest";
import type { Cell, HostScope, Identity, Page, PageRequest, SchemaRequest } from "./contract";
import { FixtureCacheBudget } from "./cache";
import { DEFAULT_CONFIG, DEFAULT_LIMITS, FixtureTableProvider, representativeCells } from "./fixture";
import {
  checkedIndex,
  ContractError,
  jsonBytes,
  parseCell,
  parsePage,
  parsePageRequest,
  parseProfileRequest,
  parseQueryRequest,
  parseSchemaPage,
  parseSchemaRequest,
  parseTableState,
  parseUnsupported,
  requireThat,
  sameScope,
  unsigned,
  utf8Bytes,
} from "./validation";

const scope: HostScope = {
  project: "project-incarnation:1",
  window: "window:1",
  document: "document:1",
  generation: "kernel:1",
  objectRevision: "object:1",
  viewer: "viewer:1",
};

function json(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

function request(identity: Identity, patch: Partial<PageRequest> = {}): PageRequest {
  return { identity, requestId: "request:1", offset: "0", limit: 3, columns: ["column:0"], ...patch };
}

function schemaRequest(identity: Identity, patch: Partial<SchemaRequest> = {}): SchemaRequest {
  return { identity, requestId: "schema:1", offset: "0", limit: 3, ...patch };
}

function gate() {
  let release: () => void = () => {
    throw new Error("Gate not initialized");
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function setup(beforeWork?: (signal: AbortSignal) => Promise<void>) {
  const granted = [{ ...scope }];
  let allowed = true;
  const budget = new FixtureCacheBudget();
  const provider = new FixtureTableProvider(
    budget,
    (s) => allowed && granted.some((g) => sameScope(g, s)),
    DEFAULT_CONFIG,
    beforeWork,
  );
  return {
    provider,
    budget,
    granted,
    deny: () => {
      allowed = false;
    },
    state: provider.open(scope),
  };
}

function first(page: Page): Cell {
  const cell = page.columns[0]?.values[0];
  requireThat(cell);
  return cell;
}

const missingCells = representativeCells().filter((cell) => cell.kind === "missing");

describe("lossless JSON value contract", () => {
  it.each(representativeCells().map((cell, index) => ({ cell, index })))(
    "roundtrips representative $index",
    ({ cell }) => {
      expect(parseCell(json(cell), DEFAULT_LIMITS)).toEqual(cell);
    },
  );

  it("covers ALL missing codes, independently of fixture implementation", () => {
    const actual = missingCells.map((cell) => JSON.stringify(cell));
    const expected = [
      ...["none", "pandas-na", "nat"].map((value) => ({ system: "python", value })),
      ...["logical", "integer", "double", "complex", "character", "date", "timestamp"].map((value) => ({
        system: "r",
        value,
      })),
      { system: "sql", value: "null" },
      ...[".", "._", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => `.${letter}`)].map((value) => ({
        system: "sas",
        value,
      })),
    ].map((value) => JSON.stringify({ kind: "missing", value }));
    expect(actual).toEqual(expected);
    expect(new Set(actual).size).toBe(39);
  });

  it("preserves zero, empty text, decimal scale, category revision and nested summary", () => {
    const cells = representativeCells();
    expect(cells).toContainEqual({ kind: "integer", value: "0" });
    expect(cells).toContainEqual({ kind: "text", preview: { text: "", truncated: false } });
    expect(cells).toContainEqual({ kind: "decimal", value: "-12345678901234567890.00000000100" });
    const category: Cell = {
      kind: "category",
      dictionaryId: "levels",
      dictionaryRevision: "revision:2",
      code: "9007199254740993",
    };
    expect(parseCell(json(category), DEFAULT_LIMITS)).toEqual(category);
    expect(() =>
      parseCell(
        { kind: "nested", type: "list", size: "1", preview: { text: "x", truncated: true }, children: [] },
        DEFAULT_LIMITS,
      ),
    ).toThrow(ContractError);
  });

  it.each([NaN, Infinity, -Infinity, -0])("rejects non-JSON-safe finite float %s before serialization", (value) => {
    expect(() => parseCell({ kind: "float", value: { kind: "finite", value } }, DEFAULT_LIMITS)).toThrow(ContractError);
  });

  it.each([
    null,
    [],
    {},
    { kind: "loading" },
    { kind: "integer", value: 2 },
    { kind: "integer", value: "01" },
    { kind: "decimal", value: "1e99" },
    { kind: "float", value: { kind: "finite", value: null } },
    { kind: "float", value: { kind: "nan", value: null } },
    { kind: "missing", value: { system: "sas", value: ".a" } },
    { kind: "missing", value: { system: "sas", value: ".AA" } },
    { kind: "missing", value: { system: "sas", value: ".A;run;" } },
    { kind: "missing", value: { system: "python", value: "unknown" } },
    { kind: "temporal", type: "timestamp", ticks: "1", resolution: "minute", timezone: null },
    { kind: "text", preview: { text: "🙂".repeat(1025), truncated: false } },
    { kind: "category", dictionaryId: "x", dictionaryRevision: "", code: "0" },
  ])("rejects malformed cell %#", (value) => {
    expect(() => parseCell(value, DEFAULT_LIMITS)).toThrow(ContractError);
  });

  it("retains huge offsets/counts as strings and checks every local conversion", () => {
    const huge = "9".repeat(128);
    expect(unsigned(json(huge))).toBe(huge);
    expect(() => checkedIndex(huge, Number.MAX_SAFE_INTEGER)).toThrow(ContractError);
    expect(checkedIndex("9007199254740991", Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    for (const value of ["-1", "01", "1.0", "1e6", "9".repeat(129), 100, "", "+1"]) {
      expect(() => unsigned(value)).toThrow(ContractError);
    }
    const { state } = setup();
    for (const kind of ["exact", "estimated"] as const) {
      const value = { ...state, rows: { kind, value: huge }, columnCount: huge };
      expect(parseTableState(json(value), state.identity.handle)).toEqual(value);
    }
    expect(parseTableState({ ...state, rows: { kind: "unknown" } }, state.identity.handle).rows).toEqual({
      kind: "unknown",
    });
  });
});

describe("lazy table, bounded schema and projection", () => {
  it("opens 1M x 1k without cells and accepts extensible backend keys", () => {
    const p = new FixtureTableProvider(
      new FixtureCacheBudget(),
      () => true,
      DEFAULT_CONFIG,
      undefined,
      "future/vendor/sas",
    );
    const state = p.open(scope);
    expect(state.backend).toBe("future/vendor/sas");
    expect(state.rows).toEqual({ kind: "exact", value: "1000000" });
    expect(state.columnCount).toBe("1000");
    expect(p.stats().generatedCells).toBe(0);
    expect(p.stats().cacheBytes).toBe(0);
  });

  it("bounds schema pages and preserves duplicate/empty names by id and ordinal", async () => {
    const { provider: p, state } = setup();
    const page = await p.schema(scope, schemaRequest(state.identity));
    expect(page.columns.map((c) => [c.id, c.ordinal, c.name])).toEqual([
      ["column:0", 0, "duplicate"],
      ["column:1", 1, "duplicate"],
      ["column:2", 2, ""],
    ]);
    expect(page.hasMore).toBe(true);
    expect(parseSchemaPage(json(page), schemaRequest(state.identity), p.limits)).toEqual(page);
    for (const [offset, count] of [
      ["500", 3],
      ["999", 1],
      ["1000", 0],
      ["9".repeat(128), 0],
    ] as const) {
      const q = schemaRequest(state.identity, { offset });
      const s = await p.schema(scope, q);
      expect(s.columns).toHaveLength(count);
      expect(s.hasMore).toBe(offset === "500");
    }
    const dictionary = await p.schema(scope, schemaRequest(state.identity, { offset: "9", limit: 1 }));
    expect(dictionary.columns[0]?.type).toEqual({
      kind: "category",
      dictionaryId: "factor:0",
      dictionaryRevision: "levels:1",
      size: "2",
      ordered: true,
    });
    await expect(p.schema(scope, schemaRequest(state.identity, { limit: 33 }))).rejects.toThrow();
  });

  it.each(["0", "500000", "999999", "1000000", "9".repeat(128)])(
    "pages offset %s without eager rows",
    async (offset) => {
      const { provider: p, state } = setup();
      const q = request(state.identity, { offset, columns: ["column:2", "column:0"] });
      const page = await p.page(scope, json(q));
      const count = BigInt(offset) >= 1000000n ? 0 : offset === "999999" ? 1 : 3;
      expect(page.offset).toBe(offset);
      expect(page.rowCount).toBe(count);
      expect(page.columns.map((c) => c.id)).toEqual(q.columns);
      expect(page.hasMore).toBe(offset === "0" || offset === "500000");
      expect(p.stats().generatedCells).toBe(count * 2);
      expect(parsePage(json(page), q, p.limits)).toEqual(page);
      if (count)
        expect(first(page)).toEqual(representativeCells()[(Number(offset) + 2) % representativeCells().length]);
    },
  );

  it("serves all representative data and bounded Unicode previews", async () => {
    const { provider: p, state } = setup();
    const cells = representativeCells();
    const page = await p.page(scope, request(state.identity, { limit: cells.length }));
    expect(page.columns[0]?.values).toEqual(cells);
    const long = first(await p.page(scope, request(state.identity, { columns: ["column:999"], limit: 1 })));
    requireThat(long.kind === "text");
    expect(long.preview.truncated).toBe(true);
    expect(utf8Bytes(long.preview.text)).toBeLessThanOrEqual(p.limits.maxPreviewBytes);
    expect(long.preview.text).not.toContain("\ufffd");
    const cat = first(await p.page(scope, request(state.identity, { columns: ["column:9"], limit: 1 })));
    expect(cat).toEqual({ kind: "category", dictionaryId: "factor:0", dictionaryRevision: "levels:1", code: "0" });
  });

  it("projection mutations isolate viewers and invalidate cached pages/old epochs", async () => {
    const { provider: p, state, granted } = setup();
    const otherScope = { ...scope, viewer: "viewer:2" };
    granted.push(otherScope);
    const other = p.open(otherScope);
    await p.page(scope, request(state.identity));
    const result = p.query(scope, {
      identity: state.identity,
      query: { projection: ["column:2", "column:0"], sort: [], filter: null },
    });
    requireThat(result.kind === "applied");
    expect(result.state.identity.queryEpoch).toBe(2);
    expect(p.stats().cacheBytes).toBe(0);
    await expect(p.page(scope, request(state.identity))).rejects.toThrow(/Stale/);
    expect(() =>
      p.query(scope, { identity: state.identity, query: { projection: ["column:0"], sort: [], filter: null } }),
    ).toThrow(/Stale/);
    await expect(p.page(scope, request(result.state.identity, { columns: ["column:1"] }))).rejects.toThrow(
      /projection/,
    );
    await expect(
      p.page(scope, request(result.state.identity, { columns: ["column:2", "column:0"] })),
    ).resolves.toMatchObject({ rowCount: 3 });
    expect(p.state(otherScope, other.identity.handle).identity.queryEpoch).toBe(1);
    await expect(p.page(otherScope, request(other.identity, { columns: ["column:1"] }))).resolves.toMatchObject({
      rowCount: 3,
    });
  });
});

describe("fixture scope, lifecycle and async stale guards", () => {
  it.each(["project", "window", "document", "generation", "objectRevision", "viewer"] as const)(
    "rejects cross-%s handles and forged scope copies",
    async (axis) => {
      const { provider: p, state, granted } = setup();
      const other = { ...scope, [axis]: `${axis}:other` };
      granted.push(other);
      const otherState = p.open(other);
      await expect(p.page(other, request(state.identity))).rejects.toThrow();
      const forged = { ...state.identity, handle: { ...state.identity.handle, scope: other } };
      await expect(p.page(other, request(forged))).rejects.toThrow();
      expect(() => p.close(other, state.identity.handle)).toThrow();
      expect(() => p.state(other, state.identity.handle)).toThrow();
      await expect(p.schema(other, schemaRequest(state.identity))).rejects.toThrow();
      expect(() => p.refresh(other, state.identity)).toThrow();
      expect(() => p.export(other, state.identity)).toThrow();
      await expect(p.page(other, request(otherState.identity))).resolves.toMatchObject({ rowCount: 3 });
    },
  );

  it("rejects unknown/foreign tokens and host denial even for otherwise matching scope", async () => {
    const { provider: p, state, deny } = setup();
    const foreign = setup().state.identity;
    await expect(p.page(scope, request(foreign))).rejects.toThrow();
    await expect(
      p.page(scope, request({ ...state.identity, handle: { ...state.identity.handle, id: "forged" } })),
    ).rejects.toThrow();
    deny();
    await expect(p.page(scope, request(state.identity))).rejects.toThrow(/denied/);
    expect(() => p.open(scope)).toThrow(/denied/);
    expect(() => p.state(scope, state.identity.handle)).toThrow(/denied/);
    p.revoke(scope);
    expect(p.stats().views).toBe(0);
  });

  it("revalidates host authorization AFTER awaited work", async () => {
    const g = gate();
    const { provider: p, state, deny } = setup(() => g.promise);
    const pending = p.page(scope, request(state.identity));
    deny();
    g.release();
    await expect(pending).rejects.toThrow(/denied/);
    expect(p.stats()).toMatchObject({ generatedCells: 0, inFlight: 0, cacheBytes: 0 });
  });

  it.each(["revoke", "close", "refresh", "query"] as const)(
    "%s during awaited work discards late replies and releases requests",
    async (operation) => {
      const g = gate();
      const { provider: p, state } = setup(() => g.promise);
      const page = p.page(scope, request(state.identity));
      const schema = p.schema(scope, schemaRequest(state.identity));
      const pageRejected = expect(page).rejects.toThrow();
      const schemaRejected = expect(schema).rejects.toThrow();
      if (operation === "revoke") p.revoke(scope);
      if (operation === "close") p.close(scope, state.identity.handle);
      if (operation === "refresh") p.refresh(scope, state.identity);
      if (operation === "query")
        p.query(scope, { identity: state.identity, query: { projection: ["column:0"], sort: [], filter: null } });
      // Assert cancellation settles even while the simulated transport ignores its AbortSignal.
      await Promise.all([pageRejected, schemaRejected]);
      expect(p.stats()).toMatchObject({ inFlight: 0, generatedCells: 0, cacheBytes: 0 });
      g.release();
      await Promise.resolve();
      expect(p.stats().generatedCells).toBe(0);
      await expect(p.page(scope, request(state.identity))).rejects.toThrow();
      if (operation === "close") {
        p.close(scope, state.identity.handle);
        expect(p.stats().views).toBe(0);
      }
    },
  );

  it("refresh invalidates all owning-object viewers, leaving other objects untouched", async () => {
    const { provider: p, state, granted } = setup();
    const s2 = { ...scope, viewer: "viewer:2" };
    const s3 = { ...scope, objectRevision: "object:2" };
    granted.push(s2, s3);
    const v2 = p.open(s2);
    const v3 = p.open(s3);
    await p.page(s2, request(v2.identity));
    const refreshed = p.refresh(scope, state.identity);
    expect(refreshed.identity.dataRevision).toBe(2);
    expect(refreshed.identity.schemaRevision).toBe(2);
    await expect(p.page(s2, request(v2.identity))).rejects.toThrow(/Stale/);
    expect(p.state(s2, v2.identity.handle).identity.dataRevision).toBe(2);
    await expect(p.page(s3, request(v3.identity))).resolves.toMatchObject({ rowCount: 3 });
    expect(p.stats().cacheEntries).toBe(1);
  });

  it("snapshots caller input and returned state/cache objects", async () => {
    const g = gate();
    const { provider: p, state } = setup(() => g.promise);
    const q = request(state.identity);
    const pending = p.page(scope, q);
    q.offset = "999999";
    q.columns[0] = "column:999";
    q.identity.queryEpoch = 999;
    g.release();
    const page = await pending;
    expect(page.offset).toBe("0");
    expect(page.identity.queryEpoch).toBe(1);
    page.columns.length = 0;
    const clean = p.state(scope, state.identity.handle);
    const cached = await p.page(scope, request(clean.identity));
    expect(cached.columns).toHaveLength(1);
    expect(p.stats().cacheHits).toBe(1);
  });

  it("bounds requests per view and provider, rejects duplicates, supports AbortSignal", async () => {
    const g = gate();
    const p = new FixtureTableProvider(
      new FixtureCacheBudget(),
      () => true,
      { ...DEFAULT_CONFIG, maxInFlightProvider: 2 },
      () => g.promise,
    );
    const state = p.open(scope);
    const other = p.open({ ...scope, viewer: "other" });
    const c1 = new AbortController();
    const c2 = new AbortController();
    const first = p.page(scope, request(state.identity), c1.signal);
    const second = p.page(scope, request(state.identity, { requestId: "second" }), c2.signal);
    await expect(p.page(scope, request(state.identity))).rejects.toThrow(/Duplicate/);
    await expect(p.page(scope, request(state.identity, { requestId: "third" }))).rejects.toThrow(/limit/);
    await expect(p.page(other.identity.handle.scope, request(other.identity))).rejects.toThrow(/limit/);
    const rejected = [expect(first).rejects.toThrow(/Cancelled/), expect(second).rejects.toThrow(/Cancelled/)];
    c1.abort();
    c2.abort();
    await Promise.all(rejected);
    expect(p.stats().inFlight).toBe(0);
    await expect(p.page(scope, request(state.identity), c1.signal)).rejects.toThrow(/Cancelled/);
    g.release();
    await expect(p.page(scope, request(state.identity))).resolves.toMatchObject({ rowCount: 3 });
  });
});

describe("bounded LRU accounting and cleanup", () => {
  it("evicts least recently used view pages and releases cache on close", async () => {
    const config = { ...DEFAULT_CONFIG, viewCacheBytes: 4500, providerCacheBytes: 4500 };
    const budget = new FixtureCacheBudget(4500);
    const p = new FixtureTableProvider(budget, () => true, config);
    const state = p.open(scope);
    const read = (offset: string) => p.page(scope, request(state.identity, { offset, limit: 1 }));
    await read("0");
    await read("1");
    expect(p.stats().cacheEntries).toBe(2);
    await read("0");
    const before = p.stats();
    await read("2");
    expect(p.stats().cacheBytes).toBeLessThanOrEqual(4500);
    const generated = p.stats().generatedCells;
    await read("0");
    expect(p.stats().generatedCells).toBe(generated);
    await read("1");
    expect(p.stats().generatedCells).toBe(generated + 1);
    expect(p.stats().cacheHits).toBe(before.cacheHits + 1);
    p.close(scope, state.identity.handle);
    expect(p.stats()).toMatchObject({ views: 0, inFlight: 0, cacheBytes: 0, cacheEntries: 0 });
    expect(budget.stats().bytes).toBe(0);
  });

  it("enforces shared global and per-provider budgets across isolated viewers", async () => {
    const budget = new FixtureCacheBudget(8500);
    const config = { ...DEFAULT_CONFIG, providerCacheBytes: 6000, viewCacheBytes: 4000 };
    const a = new FixtureTableProvider(budget, () => true, config);
    const b = new FixtureTableProvider(budget, () => true, config);
    const a1 = a.open(scope);
    const a2 = a.open({ ...scope, viewer: "2" });
    const b1 = b.open(scope);
    for (let offset = 0; offset < 8; offset++) {
      for (const [p, state] of [
        [a, a1],
        [a, a2],
        [b, b1],
      ] as const) {
        await p.page(state.identity.handle.scope, request(state.identity, { offset: String(offset), limit: 1 }));
        expect(p.stats().cacheBytes).toBeLessThanOrEqual(config.providerCacheBytes);
        expect(budget.stats(p, state.identity.handle.id).bytes).toBeLessThanOrEqual(config.viewCacheBytes);
        expect(budget.stats().bytes).toBeLessThanOrEqual(budget.maxBytes);
      }
    }
    a.revoke(scope);
    a.revoke(a2.identity.handle.scope);
    b.close(scope, b1.identity.handle);
    expect(budget.stats()).toEqual({ entries: 0, bytes: 0 });
  });

  it("returns valid pages without caching when a page exceeds cache budget", async () => {
    const p = new FixtureTableProvider(new FixtureCacheBudget(1), () => true, {
      ...DEFAULT_CONFIG,
      viewCacheBytes: 1,
      providerCacheBytes: 1,
    });
    const state = p.open(scope);
    await expect(p.page(scope, request(state.identity))).resolves.toMatchObject({ rowCount: 3 });
    expect(p.stats().cacheBytes).toBe(0);
  });

  it("recorrelates cached replies with new request ids and keeps small previews explicit", async () => {
    const p = new FixtureTableProvider(new FixtureCacheBudget(), () => true, {
      ...DEFAULT_CONFIG,
      limits: { ...DEFAULT_LIMITS, maxPreviewBytes: 1 },
    });
    const state = p.open(scope);
    const q = request(state.identity, { offset: "8", limit: 1 });
    const page = await p.page(scope, q);
    const cached = await p.page(scope, { ...q, requestId: "different-request" });
    expect(cached.requestId).toBe("different-request");
    expect(cached.columns).toEqual(page.columns);
    expect(p.stats().generatedCells).toBe(1);
    expect(p.stats().cacheHits).toBe(1);
    const cell = first(await p.page(scope, request(state.identity, { offset: "14", limit: 1 })));
    requireThat("preview" in cell);
    expect(utf8Bytes(cell.preview.text)).toBeLessThanOrEqual(1);
    expect(cell.preview.truncated).toBe(true);
  });

  it("releases requests after transport failure and passes cancellation to the work seam", async () => {
    const g = gate();
    const signals: AbortSignal[] = [];
    const { provider: p, state } = setup((signal) => {
      signals.push(signal);
      return g.promise;
    });
    const pending = p.page(scope, request(state.identity));
    const rejected = expect(pending).rejects.toThrow(/Cancelled/);
    p.close(scope, state.identity.handle);
    await rejected;
    expect(signals[0]?.aborted).toBe(true);
    expect(p.stats()).toMatchObject({ inFlight: 0, cacheBytes: 0, views: 0 });
    g.release();
    const failed = setup(() => Promise.reject(new Error("transport failure")));
    await expect(failed.provider.page(scope, request(failed.state.identity))).rejects.toThrow(/transport failure/);
    expect(failed.provider.stats()).toMatchObject({ inFlight: 0, cacheBytes: 0 });
  });

  it("bounds response/preview bytes and fails without retaining oversized pages", async () => {
    const p = new FixtureTableProvider(new FixtureCacheBudget(), () => true, {
      ...DEFAULT_CONFIG,
      limits: { ...DEFAULT_LIMITS, maxResponseBytes: 1500, maxPreviewBytes: 40 },
    });
    const state = p.open(scope);
    const q = request(state.identity, { limit: 1, columns: ["column:999"] });
    const page = await p.page(scope, q);
    expect(jsonBytes(page)).toBeLessThanOrEqual(1500);
    const cell = first(page);
    requireThat(cell.kind === "text");
    expect(utf8Bytes(cell.preview.text)).toBeLessThanOrEqual(40);
    p.refresh(scope, state.identity);
    const current = p.state(scope, state.identity.handle);
    await expect(p.page(scope, request(current.identity, { limit: 256, columns: ["column:999"] }))).rejects.toThrow(
      /budget/,
    );
    expect(p.stats()).toMatchObject({ cacheBytes: 0, inFlight: 0 });
    const tiny = new FixtureTableProvider(new FixtureCacheBudget(), () => true, {
      ...DEFAULT_CONFIG,
      limits: { ...DEFAULT_LIMITS, maxResponseBytes: 1 },
    });
    const t = tiny.open(scope);
    await expect(tiny.schema(scope, schemaRequest(t.identity))).rejects.toThrow(/budget/);
  });

  it.each([
    { maxViews: 0 },
    { maxInFlightPerView: 3 },
    { maxInFlightProvider: NaN },
    { viewCacheBytes: -1 },
    { providerCacheBytes: 0 },
    { viewCacheBytes: 100, providerCacheBytes: 99 },
    { limits: { ...DEFAULT_LIMITS, maxRows: Infinity } },
    { limits: { ...DEFAULT_LIMITS, maxColumns: 1000 } },
    { limits: { ...DEFAULT_LIMITS, maxPreviewBytes: 0 } },
    { limits: { ...DEFAULT_LIMITS, maxResponseBytes: 1.5 } },
  ])("rejects invalid configuration %#", (patch) => {
    expect(
      () => new FixtureTableProvider(new FixtureCacheBudget(), () => true, { ...DEFAULT_CONFIG, ...patch }),
    ).toThrow(ContractError);
  });

  it("bounds open views and validates global budgets", () => {
    const p = new FixtureTableProvider(new FixtureCacheBudget(), () => true, { ...DEFAULT_CONFIG, maxViews: 1 });
    const state = p.open(scope);
    expect(() => p.open(scope)).toThrow(/limit/);
    p.close(scope, state.identity.handle);
    expect(p.open(scope)).toBeDefined();
    for (const value of [0, -1, NaN, Infinity, 1.5, 64 * 1024 * 1024 + 1])
      expect(() => new FixtureCacheBudget(value)).toThrow(ContractError);
  });
});

describe("envelope correlation and explicit unsupported operations", () => {
  it("sort/filter/profile/export are explicit and do not mutate epochs", () => {
    const { provider: p, state } = setup();
    const base = { projection: ["column:0"], sort: [], filter: null };
    const sorted = p.query(scope, {
      identity: state.identity,
      query: { ...base, sort: [{ column: "column:0", direction: "asc", missing: "last" }] },
    });
    const filtered = p.query(scope, {
      identity: state.identity,
      query: { ...base, filter: { column: "column:0", operator: "equals", value: { kind: "integer", value: "1" } } },
    });
    const profiled = p.profile(scope, {
      identity: state.identity,
      columns: ["column:0"],
      scope: "dataset",
      kinds: ["missing"],
    });
    const exported = p.export(scope, state.identity);
    for (const [result, operation] of [
      [sorted, "sort"],
      [filtered, "filter"],
      [profiled, "profile"],
      [exported, "export"],
    ] as const) {
      expect(result).toMatchObject({ kind: "unsupported", operation });
      expect(parseUnsupported(json(result))).toEqual(result);
    }
    expect(p.state(scope, state.identity.handle).identity).toEqual(state.identity);
  });

  it("rejects malformed requests before generation", async () => {
    const { provider: p, state } = setup();
    for (const patch of [
      { offset: 1 },
      { offset: "-1" },
      { limit: 0 },
      { limit: 257 },
      { limit: NaN },
      { columns: [] },
      { columns: ["column:0", "column:0"] },
      { columns: ["not-a-column"] },
      { columns: ["column:1000"] },
      { columns: Array.from({ length: 33 }, (_, i) => `column:${i}`) },
      { requestId: "" },
      { eval: "run()" },
      { identity: { ...state.identity, queryEpoch: Infinity } },
    ])
      await expect(p.page(scope, { ...request(state.identity), ...patch })).rejects.toThrow();
    expect(p.stats()).toMatchObject({ generatedCells: 0, cacheBytes: 0, inFlight: 0 });
    expect(() => parsePageRequest(null, p.limits)).toThrow();
    expect(() => parseSchemaRequest({ ...schemaRequest(state.identity), limit: 33 }, p.limits)).toThrow();
    expect(() =>
      parseQueryRequest(
        {
          identity: state.identity,
          query: { projection: ["column:0"], sort: [], filter: { operator: "eval", value: "x" } },
        },
        p.limits,
      ),
    ).toThrow();
    expect(() =>
      parseProfileRequest(
        { identity: state.identity, columns: ["column:0"], scope: "page", kinds: ["mean"] },
        p.limits,
      ),
    ).toThrow();
  });

  it("rejects malformed, nonfinite, oversized or uncorrelated responses", async () => {
    const { provider: p, state } = setup();
    const q = request(state.identity);
    const page = await p.page(scope, q);
    for (const patch of [
      { requestId: "other" },
      { offset: "1" },
      { rowCount: 4 },
      { rowCount: NaN },
      { identity: { ...state.identity, queryEpoch: 2 } },
      { identity: { ...state.identity, dataRevision: 2 } },
      { identity: { ...state.identity, schemaRevision: 2 } },
      { identity: { ...state.identity, handle: { ...state.identity.handle, scope: { ...scope, window: "other" } } } },
      { columns: [] },
      { columns: [{ id: "column:1", values: [] }] },
      { columns: [{ id: "column:0", values: [{ kind: "float", value: { kind: "finite", value: Infinity } }] }] },
      { columns: [{ id: "column:0", values: [] }] },
      { rowCount: 0, hasMore: true },
      { extra: true },
    ])
      expect(() => parsePage({ ...page, ...patch }, q, p.limits)).toThrow(ContractError);
    expect(() => parsePage(page, q, { ...p.limits, maxResponseBytes: 1 })).toThrow(/budget/);
    const sq = schemaRequest(state.identity);
    const s = await p.schema(scope, sq);
    expect(() => parseSchemaPage({ ...s, requestId: "other" }, sq, p.limits)).toThrow();
    expect(() => parseSchemaPage({ ...s, columns: s.columns.slice().reverse() }, sq, p.limits)).toThrow();
    expect(() => parseSchemaPage({ ...s, columns: [...s.columns, ...s.columns] }, sq, p.limits)).toThrow();
    expect(() => parseTableState({ ...state, backend: "" }, state.identity.handle)).toThrow();
  });

  it("rejects sparse arrays in every boundary instead of skipping missing elements", async () => {
    const { provider: p, state } = setup();
    const sparse: unknown[] = Array.from({ length: 1 });
    delete sparse[0];
    await expect(p.page(scope, { ...request(state.identity), columns: sparse })).rejects.toThrow(ContractError);
    expect(() =>
      parseQueryRequest(
        { identity: state.identity, query: { projection: ["column:0"], sort: sparse, filter: null } },
        p.limits,
      ),
    ).toThrow(ContractError);
    expect(() =>
      parseProfileRequest(
        { identity: state.identity, columns: ["column:0"], scope: "dataset", kinds: sparse },
        p.limits,
      ),
    ).toThrow(ContractError);
    const q = request(state.identity, { limit: 1 });
    const page = await p.page(scope, q);
    expect(() => parsePage({ ...page, columns: sparse }, q, p.limits)).toThrow(ContractError);
    expect(() => parsePage({ ...page, columns: [{ id: "column:0", values: sparse }] }, q, p.limits)).toThrow(
      ContractError,
    );
    const sq = schemaRequest(state.identity, { limit: 1 });
    const schema = await p.schema(scope, sq);
    expect(() => parseSchemaPage({ ...schema, columns: sparse }, sq, p.limits)).toThrow(ContractError);
  });

  it("rejects old responses against refreshed/query identities", async () => {
    const { provider: p, state } = setup();
    const q = request(state.identity);
    const page = await p.page(scope, q);
    const s = await p.schema(scope, schemaRequest(state.identity));
    const refreshed = p.refresh(scope, state.identity);
    expect(() => parsePage(page, request(refreshed.identity), p.limits)).toThrow(/Uncorrelated/);
    expect(() => parseSchemaPage(s, schemaRequest(refreshed.identity), p.limits)).toThrow(/Uncorrelated/);
    const result = p.query(scope, {
      identity: refreshed.identity,
      query: { projection: ["column:0"], sort: [], filter: null },
    });
    requireThat(result.kind === "applied");
    expect(() => parsePage(page, request(result.state.identity), p.limits)).toThrow(/Uncorrelated/);
  });
});
