import type { Cell } from "../contract";
import { fitCanvasText, formatCell } from "./cell";
import type { CellText } from "./cell";
import { rowAddress } from "./scroll";
import type { CanvasTheme } from "./theme";

const MAX_BACKING_PIXELS = 16_777_216;
const MAX_BACKING_DIMENSION = 16_384;

export function backingStore(width: number, height: number, dpr: number) {
  if (
    ![width, height, dpr].every(Number.isFinite) ||
    width < 0 ||
    height < 0 ||
    dpr <= 0 ||
    width > MAX_BACKING_DIMENSION ||
    height > MAX_BACKING_DIMENSION
  ) {
    throw new RangeError("Invalid canvas dimensions");
  }
  if (width === 0 || height === 0) return { width: 0, height: 0, scaleX: 1, scaleY: 1 };
  const scale = Math.min(
    dpr,
    MAX_BACKING_DIMENSION / width,
    MAX_BACKING_DIMENSION / height,
    Math.sqrt(MAX_BACKING_PIXELS / (width * height)),
  );
  const pixelWidth = Math.max(1, Math.floor(width * scale));
  const pixelHeight = Math.max(1, Math.floor(height * scale));
  return { width: pixelWidth, height: pixelHeight, scaleX: pixelWidth / width, scaleY: pixelHeight / height };
}

/** Resizing clears context state. Paint uses CSS pixels after this transform is set. */
export function prepareCanvas(canvas: HTMLCanvasElement, width: number, height: number, dpr: number) {
  const metrics = backingStore(width, height, dpr);
  if (canvas.width !== metrics.width) canvas.width = metrics.width;
  if (canvas.height !== metrics.height) canvas.height = metrics.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.setTransform(metrics.scaleX, 0, 0, metrics.scaleY, 0, 0);
  return context;
}

export interface GridPaintOptions {
  width: number;
  height: number;
  rowHeight: number;
  rowCount: string;
  firstRow: string;
  rowOffset: number;
  scrollLeft: number;
  columns: readonly { id: string; width: number }[];
  theme: CanvasTheme;
  /** Reads a bounded, identity-checked cache; undefined means not loaded, never missing. */
  cellAt: (row: string, columnId: string) => Cell | undefined;
  format?: (cell: Cell) => CellText;
}

/** Pure paint only: host owns paging, cancellation, schema, focus and accessible DOM. */
export function drawCanvasDataGrid(context: CanvasRenderingContext2D, options: GridPaintOptions): void {
  const { width, height, rowHeight, rowOffset, scrollLeft, theme } = options;
  backingStore(width, height, 1);
  if (
    !Number.isFinite(rowHeight) ||
    rowHeight < 1 ||
    !Number.isFinite(rowOffset) ||
    rowOffset < 0 ||
    rowOffset >= rowHeight ||
    !Number.isFinite(scrollLeft) ||
    scrollLeft < 0
  ) {
    throw new RangeError("Invalid grid viewport");
  }
  const firstRow = rowAddress(options.firstRow);
  const rowCount = rowAddress(options.rowCount);
  const visible: { id: string; x: number; width: number }[] = [];
  let x = -scrollLeft;
  for (const column of options.columns) {
    if (!Number.isFinite(column.width) || column.width < 1) throw new RangeError("Invalid column width");
    if (x < width && x + column.width > 0) visible.push({ ...column, x });
    x += column.width;
  }
  context.save();
  try {
    context.beginPath();
    context.rect(0, 0, width, height);
    context.clip();
    context.fillStyle = theme.background;
    context.fillRect(0, 0, width, height);
    context.font = theme.font;
    context.textBaseline = "middle";
    if (width === 0 || height === 0) return;
    const format = options.format ?? formatCell;
    for (let index = 0; index < Math.ceil((height + rowOffset) / rowHeight); index++) {
      const row = firstRow + BigInt(index);
      if (row >= rowCount) break;
      const y = index * rowHeight - rowOffset;
      for (const column of visible) {
        context.fillStyle = theme.border;
        context.fillRect(column.x + column.width - 1, y, 1, rowHeight);
        context.fillRect(column.x, y + rowHeight - 1, column.width, 1);
        const cell = options.cellAt(String(row), column.id);
        if (!cell) continue;
        const value = format(cell);
        const text = fitCanvasText((s) => context.measureText(s).width, value.text, column.width - 12);
        context.save();
        try {
          context.beginPath();
          context.rect(column.x + 1, y, column.width - 2, rowHeight - 1);
          context.clip();
          context.fillStyle =
            value.tone === "error" ? theme.error : value.tone === "muted" ? theme.muted : theme.foreground;
          context.textAlign = value.align;
          context.fillText(
            text,
            value.align === "right" ? column.x + column.width - 6 : column.x + 6,
            y + rowHeight / 2,
          );
        } finally {
          context.restore();
        }
      }
    }
  } finally {
    context.restore();
  }
}
