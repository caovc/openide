import { boundedInt, requireThat, utf8Bytes } from "./validation";

interface Entry {
  owner: object;
  view: string;
  wire: string;
  bytes: number;
}

/** One instance must be shared by all fixture providers in a simulated broker. */
export class FixtureCacheBudget {
  private entries = new Map<string, Entry>();
  readonly maxBytes: number;

  constructor(maxBytes = 64 * 1024 * 1024) {
    this.maxBytes = boundedInt(maxBytes, 1, 64 * 1024 * 1024);
  }

  stats(owner?: object, view?: string): { entries: number; bytes: number } {
    let entries = 0;
    let bytes = 0;
    for (const entry of this.entries.values()) {
      if ((owner === undefined || entry.owner === owner) && (view === undefined || entry.view === view)) {
        entries++;
        bytes += entry.bytes;
      }
    }
    return { entries, bytes };
  }

  get(key: string, owner: object): string | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.owner !== owner) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.wire;
  }

  put(key: string, owner: object, view: string, wire: string, viewMax: number, providerMax: number): void {
    requireThat(viewMax <= providerMax && providerMax <= this.maxBytes);
    // Retained UTF-16 text + UTF-8 transport size + key + fixed bookkeeping reserve.
    // This is conservative payload accounting, not an engine-specific heap measurement.
    const bytes = wire.length * 2 + utf8Bytes(wire) + key.length * 2 + 256;
    this.entries.delete(key);
    if (bytes > viewMax) return;
    this.entries.set(key, { owner, view, wire, bytes });
    this.evict(
      () => this.stats(owner, view).bytes > viewMax,
      (e) => e.owner === owner && e.view === view,
    );
    this.evict(
      () => this.stats(owner).bytes > providerMax,
      (e) => e.owner === owner,
    );
    this.evict(
      () => this.stats().bytes > this.maxBytes,
      () => true,
    );
  }

  private evict(over: () => boolean, eligible: (entry: Entry) => boolean): void {
    for (const [key, entry] of this.entries) {
      if (!over()) break;
      if (eligible(entry)) this.entries.delete(key);
    }
  }

  clear(owner: object, view?: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.owner === owner && (view === undefined || entry.view === view)) this.entries.delete(key);
    }
  }
}
