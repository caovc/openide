/**
 * Language levels read from build files, for templates that depend on them:
 * Java `var` (10+) from Maven / Gradle, C `auto` (C23) from CMake / compiler
 * flags. Unknown means "not known to be supported".
 */
import { call, commands } from "@/platform/ipc";

/** C23 (`auto` type inference) requested by CMake or compiler flags. */
export function cStandardIs23(file: string, text: string): boolean {
  if (/CMakeLists\.txt$/.test(file)) return /C_STANDARD\s+(23|2x)\b/i.test(text) || /-std=(c|gnu)(23|2x)\b/.test(text);
  return /-std=(c|gnu)(23|2x)\b/.test(text);
}

type ReadText = (path: string) => Promise<string>;

const readText: ReadText = (path) => call(commands.fsReadText(path));

function parentDir(path: string): string | null {
  const i = path.replace(/\/+$/, "").lastIndexOf("/");
  return i > 0 ? path.slice(0, i) : null;
}

/** Directories from `file`'s up to `root` (inclusive), nearest first. */
export function ancestorDirs(file: string, root: string | null): string[] {
  const out: string[] = [];
  let dir = parentDir(file);
  const stop = root?.replace(/\/+$/, "");
  while (dir) {
    out.push(dir);
    if (!stop || dir === stop || !dir.startsWith(stop)) break;
    dir = parentDir(dir);
  }
  return out;
}

const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as Promise<T>;
  const value = compute();
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function clearLevelCache() {
  cache.clear();
}

/** Whether the C file is built as C23 (per the nearest build configuration found). */
export function cIsC23(file: string, root: string | null, read: ReadText = readText): Promise<boolean> {
  return cached(`c:${file}`, async () => {
    for (const dir of ancestorDirs(file, root)) {
      for (const name of ["CMakeLists.txt", "compile_flags.txt", "compile_commands.json", ".clangd", "Makefile"]) {
        const text = await read(`${dir}/${name}`).catch(() => null);
        if (text !== null && cStandardIs23(name, text)) return true;
      }
    }
    return false;
  });
}
