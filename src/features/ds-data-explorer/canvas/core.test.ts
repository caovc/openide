import { describe, expect, it, vi } from "vitest";
import type { HostScope } from "../contract";
import { FixtureCacheBudget } from "../cache";
import { FixtureTableProvider, representativeCells } from "../fixture";
import { fitCanvasText, formatCell } from "./cell";
import { backingStore, drawCanvasDataGrid, prepareCanvas } from "./renderer";
import { createScrollMapper, MAX_SCROLL_HEIGHT } from "./scroll";
import { resolveCanvasTheme } from "./theme";

const theme = {
  background: "white",
  foreground: "black",
  muted: "gray",
  error: "red",
  border: "silver",
  font: "12px monospace",
};
function paintContext() {
  const calls = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    setTransform: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: Array.from(text).length * 6 })),
  };
  return { calls, context: calls as unknown as CanvasRenderingContext2D };
}

describe("canvas scroll coordinates", () => {
  it("preserves subpixel positions on ordinary tables and clamps overscroll", () => {
    const mapper = createScrollMapper("100", 24, 240);
    expect(mapper.scrollHeight).toBe(2400);
    expect(mapper.fromScrollTop(25.5)).toEqual({ firstRow: "1", offset: 1.5 });
    expect(mapper.toScrollTop({ firstRow: "1", offset: 1.5 })).toBe(25.5);
    expect(mapper.fromScrollTop(-12)).toEqual({ firstRow: "0", offset: 0 });
    expect(mapper.fromScrollTop(5000)).toEqual({ firstRow: "90", offset: 0 });
  });

  it("reaches the exact last row of a table far beyond Number precision", () => {
    const count = "999999999999999999999999999999";
    const mapper = createScrollMapper(count, 24, 240);
    expect(mapper.scrollHeight).toBe(MAX_SCROLL_HEIGHT);
    expect(mapper.fromScrollTop(mapper.maxScrollTop)).toEqual({ firstRow: String(BigInt(count) - 10n), offset: 0 });
    expect(mapper.toScrollTop({ firstRow: String(BigInt(count) - 10n), offset: 0 })).toBe(mapper.maxScrollTop);
    const halfway = mapper.fromScrollTop(mapper.maxScrollTop / 2);
    expect(BigInt(halfway.firstRow)).toBeGreaterThan(10n ** 25n);
    expect(mapper.toScrollTop(halfway)).toBeCloseTo(mapper.maxScrollTop / 2, 2);
  });

  it("positions the bottom of a non-whole-row viewport exactly", () => {
    const mapper = createScrollMapper("100000000000000000001", 24, 250.5);
    const position = mapper.fromScrollTop(mapper.maxScrollTop);
    expect(position).toEqual({ firstRow: "99999999999999999990", offset: 13.5 });
    expect(mapper.toScrollTop(position)).toBe(mapper.maxScrollTop);
    // A physical scrollbar cannot roundtrip adjacent enormous row addresses.
    expect(mapper.toScrollTop({ firstRow: "1", offset: 0 })).toBe(mapper.toScrollTop({ firstRow: "2", offset: 0 }));
  });

  it("handles empty and shorter-than-viewport tables", () => {
    for (const count of ["0", "2"]) {
      const mapper = createScrollMapper(count, 24, 240);
      expect(mapper.maxScrollTop).toBe(0);
      expect(mapper.fromScrollTop(100)).toEqual({ firstRow: "0", offset: 0 });
    }
  });

  it("rejects ambiguous addresses and non-finite geometry", () => {
    for (const count of ["01", "-1", "1e6", "1.5", "9".repeat(129)]) {
      expect(() => createScrollMapper(count, 24, 240)).toThrow(RangeError);
    }
    expect(() => createScrollMapper("1", 0, 240)).toThrow(RangeError);
    expect(() => createScrollMapper("1", 24, NaN)).toThrow(RangeError);
    expect(() => createScrollMapper("1", 24, 240).fromScrollTop(Infinity)).toThrow(RangeError);
  });
});

describe("cell presentation", () => {
  it("keeps integer, decimal and temporal precision without numeric coercion", () => {
    expect(formatCell({ kind: "integer", value: "92233720368547758081234567890" }).text).toBe(
      "92233720368547758081234567890",
    );
    expect(formatCell({ kind: "decimal", value: "1.00000000000000000000100" }).text).toBe("1.00000000000000000000100");
    expect(
      formatCell({
        kind: "temporal",
        type: "timestamp",
        ticks: "1700000000000000001",
        resolution: "nanosecond",
        timezone: "Asia/Shanghai",
      }).text,
    ).toBe("1700000000000000001 nanosecond [Asia/Shanghai]");
  });

  it("distinguishes missing systems, empty text, special floats and truncated previews", () => {
    expect(formatCell({ kind: "missing", value: { system: "sas", value: ".A" } })).toEqual({
      text: "sas:.A",
      tone: "muted",
      align: "left",
    });
    expect(formatCell({ kind: "missing", value: { system: "r", value: "integer" } }).text).toBe("r:integer");
    expect(formatCell({ kind: "text", preview: { text: "", truncated: false } }).text).toBe("");
    expect(formatCell({ kind: "text", preview: { text: "abc", truncated: true } }).text).toBe("abc…");
    expect(
      ["nan", "+inf", "-inf", "-zero"].map(
        (kind) => formatCell({ kind: "float", value: { kind: kind as "nan" } }).text,
      ),
    ).toEqual(["NaN", "+Inf", "-Inf", "-0"]);
    for (const cell of representativeCells()) expect(typeof formatCell(cell).text).toBe("string");
  });

  it("clips text without splitting surrogate pairs and exposes line breaks", () => {
    const measure = (s: string) => Array.from(s).length;
    expect(fitCanvasText(measure, "🙂🙂🙂", 2)).toBe("🙂…");
    expect(fitCanvasText(measure, "a\nb\tc", 6)).toBe("a↵b⇥c");
    expect(fitCanvasText(measure, "abc", 0.5)).toBe("");
  });
});

describe("canvas paint", () => {
  it("bounds backing allocation and preserves effective scale after rounding", () => {
    expect(backingStore(100.5, 50.5, 1.5)).toEqual({ width: 150, height: 75, scaleX: 150 / 100.5, scaleY: 75 / 50.5 });
    const huge = backingStore(16000, 16000, 8);
    expect(huge.width * huge.height).toBeLessThanOrEqual(16_777_216);
    expect(backingStore(0, 10, 2).width).toBe(0);
    expect(() => backingStore(100, 100, NaN)).toThrow(RangeError);
    const { calls, context } = paintContext();
    const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
    expect(prepareCanvas(canvas, 100, 50, 2)).toBe(context);
    expect(canvas.width).toBe(200);
    expect(calls.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
  });

  it("reads theme tokens and fails explicitly when the host has no theme", () => {
    const tokens: Record<string, string> = {
      "--bg-app": "white",
      "--fg": "black",
      "--fg-muted": "gray",
      "--danger": "red",
      "--border": "silver",
      "--font-mono": "monospace",
    };
    expect(resolveCanvasTheme({ getPropertyValue: (key) => tokens[key] ?? "" })).toEqual(theme);
    expect(() => resolveCanvasTheme({ getPropertyValue: () => "" })).toThrow("Missing canvas theme token");
  });

  it("paints only visible row/column intersections and keeps huge row IDs exact", () => {
    const { calls, context } = paintContext();
    const cellAt = vi.fn(() => ({ kind: "integer" as const, value: "42" }));
    drawCanvasDataGrid(context, {
      width: 100,
      height: 24,
      rowHeight: 24,
      rowCount: "100000000000000000000",
      firstRow: "99999999999999999998",
      rowOffset: 12,
      scrollLeft: 100,
      columns: [
        { id: "off-left", width: 100 },
        { id: "visible", width: 100 },
        { id: "off-right", width: 100 },
      ],
      theme,
      cellAt,
    });
    expect(cellAt.mock.calls).toEqual([
      ["99999999999999999998", "visible"],
      ["99999999999999999999", "visible"],
    ]);
    expect(calls.fillText).toHaveBeenCalledTimes(2);
    expect(calls.save).toHaveBeenCalledTimes(calls.restore.mock.calls.length);
  });

  it("clips wide horizontally scrolled columns to the viewport", () => {
    const { calls, context } = paintContext();
    const cellAt = vi.fn(() => ({ kind: "text" as const, preview: { text: "wide", truncated: false } }));
    drawCanvasDataGrid(context, {
      width: 100,
      height: 24,
      rowHeight: 24,
      rowCount: "1",
      firstRow: "0",
      rowOffset: 0,
      scrollLeft: 150,
      columns: [
        { id: "wide", width: 1000 },
        { id: "offscreen", width: 100 },
      ],
      theme,
      cellAt,
    });
    expect(cellAt.mock.calls).toEqual([["0", "wide"]]);
    expect(calls.rect.mock.calls[0]).toEqual([0, 0, 100, 24]);
    expect(calls.fillText).toHaveBeenCalledWith("wide", -144, 12);
  });

  it("never reads data for empty tables or zero-sized viewports", () => {
    const { context } = paintContext();
    const cellAt = vi.fn(() => undefined);
    for (const dimensions of [
      { width: 100, height: 24, rowCount: "0" },
      { width: 0, height: 24, rowCount: "10" },
      { width: 100, height: 0, rowCount: "10" },
    ]) {
      drawCanvasDataGrid(context, {
        ...dimensions,
        rowHeight: 24,
        firstRow: "0",
        rowOffset: 12,
        scrollLeft: 0,
        columns: [{ id: "c", width: 100 }],
        theme,
        cellAt,
      });
    }
    expect(cellAt).not.toHaveBeenCalled();
  });

  it("paints a bounded U9 fixture page and leaves unloaded cells blank", async () => {
    const scope: HostScope = {
      project: "p",
      window: "w",
      document: "d",
      generation: "g",
      objectId: "o",
      objectRevision: "1",
      viewer: "v",
    };
    const provider = new FixtureTableProvider(new FixtureCacheBudget(), () => true);
    const state = provider.open(scope);
    const page = await provider.page(scope, {
      identity: state.identity,
      requestId: "paint",
      offset: "0",
      limit: 2,
      columns: ["column:1"],
    });
    const { calls, context } = paintContext();
    drawCanvasDataGrid(context, {
      width: 200,
      height: 72,
      rowHeight: 24,
      rowCount: "1000000",
      firstRow: "0",
      rowOffset: 0,
      scrollLeft: 0,
      columns: [{ id: "column:1", width: 200 }],
      theme,
      cellAt: (row) => page.columns[0]?.values[Number(row)],
    });
    expect(calls.fillText).toHaveBeenCalledTimes(2);
    expect(calls.fillText.mock.calls[0]?.[0]).toBe(formatCell(page.columns[0]!.values[0]!).text);
    provider.close(scope, state.identity.handle);
  });

  it("restores caller context even if a cache accessor fails", () => {
    const { calls, context } = paintContext();
    expect(() =>
      drawCanvasDataGrid(context, {
        width: 100,
        height: 24,
        rowHeight: 24,
        rowCount: "1",
        firstRow: "0",
        rowOffset: 0,
        scrollLeft: 0,
        columns: [{ id: "c", width: 100 }],
        theme,
        cellAt: () => {
          throw new Error("revoked");
        },
      }),
    ).toThrow("revoked");
    expect(calls.restore).toHaveBeenCalledTimes(1);
  });
});
