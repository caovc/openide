import { beforeEach, expect, it, vi } from "vitest";
import { consoleBackend } from "./backend";
const ipc = vi.hoisted(() => ({
  sdkDetect: vi.fn(async () => [{ path: "/system/python", name: "System" }]),
  notebookDetectRuntimes: vi.fn(async () => [{ id: "ark|/ark|/R", name: "R" }]),
  sdkPythonEffective: vi.fn(async (): Promise<string | null> => "/project/python"),
}));
vi.mock("@/platform/ipc", () => ({ commands: ipc, call: <T>(promise: Promise<T>) => promise, nextRequestId: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  ipc.sdkPythonEffective.mockResolvedValue("/project/python");
});
it("includes an explicit project interpreter even when discovery has not found it", async () => {
  const runtimes = await consoleBackend.runtimes();
  expect(ipc.sdkPythonEffective).toHaveBeenCalledExactlyOnceWith(null);
  expect(runtimes[0]).toEqual({
    selection: "/project/python",
    name: "/project/python",
    language: "python",
    isProjectDefault: true,
  });
  expect(runtimes).toContainEqual({ selection: "ark|/ark|/R", name: "R", language: "r" });
});
it("marks a discovered project interpreter without duplicating it", async () => {
  ipc.sdkPythonEffective.mockResolvedValue("/system/python");
  const runtimes = await consoleBackend.runtimes();
  expect(runtimes.filter((r) => r.selection === "/system/python")).toEqual([
    { selection: "/system/python", name: "System", language: "python", isProjectDefault: true },
  ]);
});
it("keeps R choices available when Python default resolution fails", async () => {
  ipc.sdkPythonEffective.mockRejectedValue(new Error("Python unavailable"));
  expect(await consoleBackend.runtimes()).toContainEqual({ selection: "ark|/ark|/R", name: "R", language: "r" });
});
