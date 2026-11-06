/** Read-only documents supplied by a language server for non-file URIs. */
import { call, commands, type VirtualDocument } from "./ipc";

/** Server document URIs, drive letters remain paths. */
export function isVirtualUri(s: string | null | undefined): boolean {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]+):/.exec(s ?? "");
  return !!m && m[1]!.toLowerCase() !== "file";
}

/** Last path segment of a URI (without query / fragment), e.g. `iter.rs`. */
export function virtualName(uri: string): string {
  const rest = uri.replace(/^[^:]+:(\/\/)?/, "").split(/[?#]/)[0]!;
  const seg = rest.split("/").filter(Boolean).pop() ?? uri;
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/** The URI's path without its last segment, e.g. `rust-analyzer://library/core`. */
export function virtualParent(uri: string): string {
  const base = uri.split(/[?#]/)[0]!;
  const i = base.lastIndexOf("/");
  return i > base.indexOf("://") + 2 ? base.slice(0, i) : base;
}

/** Short human location of a server-provided source document. */
export function virtualContainer(uri: string): string {
  const rest = uri.replace(/^[^:]+:(\/\/)?/, "").split(/[?#]/)[0]!;
  const segs = rest
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
  segs.pop();
  return segs.join(" › ");
}

const cache = new Map<string, Promise<VirtualDocument>>();

/** Contents of a virtual document (cached; failures are retried on the next call). */
export function virtualDocument(uri: string): Promise<VirtualDocument> {
  let p = cache.get(uri);
  if (!p) {
    p = call(commands.lspVirtualDocument(uri));
    p.catch(() => cache.delete(uri));
    cache.set(uri, p);
  }
  return p;
}
