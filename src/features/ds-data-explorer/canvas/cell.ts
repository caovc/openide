import type { Cell } from "../contract";

export interface CellText {
  text: string;
  tone: "normal" | "muted" | "error";
  align: "left" | "right";
}

/** Data notation only; the host supplies localized headers, tooltips and accessible labels. */
export function formatCell(cell: Cell): CellText {
  switch (cell.kind) {
    case "integer":
    case "decimal":
      return { text: cell.value, tone: "normal", align: "right" };
    case "boolean":
      return { text: String(cell.value), tone: "normal", align: "left" };
    case "float": {
      const value = cell.value;
      const text =
        value.kind === "finite"
          ? Object.is(value.value, -0)
            ? "-0"
            : String(value.value)
          : ({ nan: "NaN", "+inf": "+Inf", "-inf": "-Inf", "-zero": "-0" } as const)[value.kind];
      return { text, tone: "normal", align: "right" };
    }
    case "missing":
      return { text: `${cell.value.system}:${cell.value.value}`, tone: "muted", align: "left" };
    case "category":
      // The contract has no dictionary lookup. Never invent a label for an unresolved code.
      return { text: `${cell.dictionaryId}@${cell.dictionaryRevision}:${cell.code}`, tone: "muted", align: "left" };
    case "temporal":
      // Keep sub-millisecond ticks exact until the host provides a calendar-aware formatter.
      return {
        text: `${cell.ticks} ${cell.resolution}${cell.timezone ? ` [${cell.timezone}]` : ""}`,
        tone: "normal",
        align: "left",
      };
    case "text":
    case "binary":
    case "unsupported":
    case "error":
    case "nested":
      return {
        text: cell.preview.text + (cell.preview.truncated ? "…" : ""),
        tone: cell.kind === "error" ? "error" : cell.kind === "unsupported" ? "muted" : "normal",
        align: "left",
      };
  }
}

export function fitCanvasText(measure: (text: string) => number, text: string, width: number): string {
  if (!Number.isFinite(width) || width <= 0) return "";
  const singleLine = text.replaceAll("\n", "↵").replaceAll("\r", "␍").replaceAll("\t", "⇥");
  if (measure(singleLine) <= width) return singleLine;
  const ellipsis = "…";
  if (measure(ellipsis) > width) return "";
  const points = Array.from(singleLine);
  let low = 0;
  let high = points.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(points.slice(0, mid).join("") + ellipsis) <= width) low = mid;
    else high = mid - 1;
  }
  return points.slice(0, low).join("") + ellipsis;
}
