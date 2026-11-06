/** Browser scroll extents are bounded; dataset row addresses never pass through Number. */
export const MAX_SCROLL_HEIGHT = 16_000_000;
const SUBPIXELS = 1024;
const SCALE = BigInt(SUBPIXELS);

function pixels(value: number): bigint {
  if (!Number.isFinite(value) || value < 0 || value > MAX_SCROLL_HEIGHT) {
    throw new RangeError("Invalid viewport dimension");
  }
  return BigInt(Math.round(value * SUBPIXELS));
}

export function rowAddress(value: string): bigint {
  if (!/^(0|[1-9][0-9]{0,127})$/.test(value)) throw new RangeError("Invalid row address");
  return BigInt(value);
}

export interface RowPosition {
  firstRow: string;
  offset: number;
}

/** Compressed scrollbars cannot address every row. Keep keyboard/go-to-row navigation in
 * RowPosition coordinates; converting through scrollTop necessarily loses row resolution. */
export function createScrollMapper(rowCount: string, rowHeight: number, viewportHeight: number) {
  const rows = rowAddress(rowCount);
  const row = pixels(rowHeight);
  if (row < SCALE) throw new RangeError("Row height must be at least one pixel");
  const viewport = pixels(viewportHeight);
  const logicalHeight = rows * row;
  const extent = logicalHeight > viewport ? logicalHeight - viewport : 0n;
  const height = logicalHeight > BigInt(MAX_SCROLL_HEIGHT) * SCALE ? BigInt(MAX_SCROLL_HEIGHT) * SCALE : logicalHeight;
  const physicalExtent = height > viewport ? height - viewport : 0n;

  return {
    scrollHeight: Number(height) / SUBPIXELS,
    maxScrollTop: Number(physicalExtent) / SUBPIXELS,
    fromScrollTop(scrollTop: number): RowPosition {
      if (!Number.isFinite(scrollTop)) throw new RangeError("Invalid scroll offset");
      const physical = pixels(Math.max(0, Math.min(scrollTop, Number(physicalExtent) / SUBPIXELS)));
      const logical = physicalExtent === 0n ? 0n : (physical * extent) / physicalExtent;
      return { firstRow: String(logical / row), offset: Number(logical % row) / SUBPIXELS };
    },
    toScrollTop(position: RowPosition): number {
      const offset = pixels(position.offset);
      if (offset >= row) throw new RangeError("Offset exceeds row height");
      const requested = rowAddress(position.firstRow) * row + offset;
      const logical = requested > extent ? extent : requested;
      return extent === 0n ? 0 : Number((logical * physicalExtent) / extent) / SUBPIXELS;
    },
  };
}
