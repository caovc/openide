import type { Page } from "@playwright/test";
import { expect, stubDesktop, test } from "./fixtures";

// Actual React workbench and IPC wiring, with deliberately mocked Python and R kernels.
// These tests do not claim real debugger/runtime or source-mapping acceptance.
async function openMockNotebook(page: Page, debuggerAvailable = true, runtime: "python" | "r" = "python") {
  await expect(page).toHaveTitle("acme-api");
  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await stubDesktop(page);
  await page.evaluate(
    async ({ debuggerAvailable, runtime }) => {
      const ark = runtime === "r";
      const selection = ark ? "ark|/tools/ark|/tools/R" : "/python";
      const threadId = ark ? -1 : 1;
      const frameId = ark ? 0 : 11;
      const definitionPath = ark ? "/tmp/definition.R" : "/tmp/definition.py";
      const snapshot = {
        id: "debug-document",
        path: "/dev/acme-api/debug.ipynb",
        version: 1,
        dirty: false,
        nbformat: 4,
        nbformatMinor: 5,
        metadata: ark ? { language_info: { name: "R" } } : {},
        canUndo: false,
        canRedo: false,
        cells: [
          {
            id: "definition-cell",
            cellType: "code",
            source: ark
              ? "add_one <- function() {\n  x <- 41\n  x <- x + 1\n  x\n}"
              : "def add_one():\n    x = 41\n    x = x + 1\n    return x",
            metadata: {},
            attachments: {},
            executionCount: null,
            outputs: [],
          },
          {
            id: "call-cell",
            cellType: "code",
            source: "add_one()",
            metadata: {},
            attachments: {},
            executionCount: null,
            outputs: [],
          },
        ],
      };
      const ipc = window.__ipc;
      let generation = 1;
      let sequence = 0;
      let value = 41;
      let channel: unknown;
      let oldChannel: unknown;
      let oldToken = "";
      let execution: (() => void) | undefined;
      const token = () => `debug-generation-${generation}`;
      const emit = (event: string, body: Record<string, unknown> = {}) => {
        ipc.send(channel, { token: token(), sequence: ++sequence, event, body });
      };
      Object.assign(ipc.handlers, {
        notebook_open: () => snapshot,
        notebook_get: () => snapshot,
        sdk_detect: () =>
          ark
            ? []
            : [
                {
                  path: "/python",
                  name: "Python mock environment",
                  source: "venv",
                  version: "3.12",
                  home: "/",
                  extra: null,
                },
              ],
        sdk_python_effective: () => (ark ? null : "/python"),
        notebook_detect_runtimes: () =>
          ark
            ? [{ id: selection, kind: "ark", name: "Ark R mock environment", path: "/tools/ark", home: "/tools/R" }]
            : [],
        notebook_start_kernel: () => {
          ipc.emit({ type: "notebookKernel", id: snapshot.id, path: snapshot.path, state: "idle", message: null });
          return { id: snapshot.id, token: token(), selection, language: runtime };
        },
        notebook_debug_capabilities: () => ({
          token: token(),
          debugger: debuggerAvailable,
          kernelInfo: { debugger: debuggerAvailable },
        }),
        notebook_debug_events: (args: Record<string, unknown>) => {
          channel = args.onEvent;
          sequence = 0;
          ipc.handlers.test_debug_ready = () =>
            ipc.send(channel, { token: token(), sequence: 0, event: "ready", body: {} });
          return new Promise(() => {});
        },
        notebook_debug_request: (args: Record<string, unknown>) => {
          const query = args.query as { token: string; command: string; arguments: Record<string, unknown> };
          if (query.token !== token()) throw { kind: "unavailable", message: "stale kernel token" };
          let body: unknown = {};
          switch (query.command) {
            case "initialize":
              if (ark) emit("initialized");
              body = { supportsConfigurationDoneRequest: true, supportsEvaluateForHovers: true };
              break;
            case "attach":
              if (!ark) emit("initialized");
              break;
            case "debugInfo":
              body = { isStarted: ark, stoppedThreads: [], breakpoints: [] };
              break;
            case "dumpCell":
              body = {
                sourcePath: String(query.arguments.code).includes("\n")
                  ? definitionPath
                  : ark
                    ? "/tmp/call.R"
                    : "/tmp/call.py",
              };
              break;
            case "setBreakpoints":
              body = {
                breakpoints: ((query.arguments.breakpoints ?? []) as { line: number }[]).map((bp) => ({
                  verified: true,
                  line: bp.line,
                })),
              };
              break;
            case "threads":
              body = { threads: [{ id: threadId, name: "Notebook thread" }] };
              break;
            case "stackTrace":
              body = {
                stackFrames: [
                  {
                    id: frameId,
                    name: "add_one",
                    source: {
                      name: ark ? "definition.R" : "definition.py",
                      path: ark ? `file://${definitionPath}` : definitionPath,
                    },
                    line: value === 41 ? 3 : 4,
                    column: 1,
                  },
                ],
                totalFrames: 1,
              };
              break;
            case "scopes":
              body = { scopes: [{ name: "Locals", variablesReference: 21, expensive: false }] };
              break;
            case "variables":
              body = { variables: [{ name: "x", value: String(value), type: "int", variablesReference: 0 }] };
              break;
            case "evaluate":
              body = { result: String(value + 1), type: "int", variablesReference: 0 };
              break;
            case "next":
              value = 42;
              emit("continued", { threadId, allThreadsContinued: true });
              setTimeout(() => emit("stopped", { reason: "step", threadId, allThreadsStopped: true }), 0);
              break;
            case "continue":
              emit("continued", { threadId, allThreadsContinued: true });
              execution?.();
              body = { allThreadsContinued: true };
              break;
            case "disconnect":
              emit("terminated");
              execution?.();
              break;
          }
          return {
            token: token(),
            response: { type: "response", request_seq: 1, seq: 2, command: query.command, success: true, body },
          };
        },
        notebook_execute: () =>
          new Promise((resolve) => {
            execution = () => {
              ipc.emit({ type: "notebookKernel", id: snapshot.id, path: snapshot.path, state: "idle", message: null });
              resolve(snapshot);
            };
            ipc.emit({ type: "notebookKernel", id: snapshot.id, path: snapshot.path, state: "busy", message: null });
            emit("stopped", { reason: "breakpoint", threadId, allThreadsStopped: true });
          }),
        notebook_restart: () => {
          oldChannel = channel;
          oldToken = token();
          generation += 1;
          sequence = 0;
          execution?.();
          ipc.emit({ type: "notebookKernel", id: snapshot.id, path: snapshot.path, state: "dead", message: null });
          return snapshot;
        },
        notebook_interrupt: () => null,
        notebook_stop_kernel: () => null,
        notebook_close: () => null,
        cancel_request: () => null,
        test_debug_stopped: () => emit("stopped", { reason: "breakpoint", threadId, allThreadsStopped: true }),
        test_debug_late_event: () =>
          ipc.send(oldChannel, {
            token: oldToken,
            sequence: 999,
            event: "stopped",
            body: { reason: "exception", threadId: 999, text: "OBSOLETE KERNEL EVENT" },
          }),
      });
      const modulePath = "/src/workbench/contributions.ts";
      const { editorService } = await import(/* @vite-ignore */ modulePath);
      await editorService().openFile(snapshot.path);
    },
    { debuggerAvailable, runtime },
  );
}

async function connectDebugger(page: Page) {
  const before = await page.evaluate(() => ({
    streams: window.__ipc.calls.filter(({ cmd }) => cmd === "notebook_debug_events").length,
    initialized: window.__ipc.calls.filter(
      ({ cmd, args }) =>
        cmd === "notebook_debug_request" && (args.query as { command: string }).command === "initialize",
    ).length,
  }));
  await page.getByRole("button", { name: "Connect Debugger", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__ipc.calls.filter(({ cmd }) => cmd === "notebook_debug_events").length))
    .toBe(before.streams + 1);
  expect(
    await page.evaluate(
      () =>
        window.__ipc.calls.filter(
          ({ cmd, args }) =>
            cmd === "notebook_debug_request" && (args.query as { command: string }).command === "initialize",
        ).length,
    ),
  ).toBe(before.initialized);
  await page.evaluate(() => window.__ipc.handlers.test_debug_ready({}));
  await expect(page.getByRole("button", { name: "Disconnect Notebook Debugger", exact: true })).toBeVisible();
}

for (const viewport of [
  { width: 1400, height: 900 },
  { width: 960, height: 720 },
]) {
  test.describe(`Notebook debugger mock IPC ${viewport.width}px`, () => {
    test.use({ viewport });

    test("connects without execution and inspects a paused cell before detaching", async ({
      workbench: page,
    }, testInfo) => {
      await openMockNotebook(page);
      await page
        .getByRole("region", { name: "Cell 1: code", exact: true })
        .getByRole("spinbutton", { name: "Breakpoint line", exact: true })
        .fill("3");
      await connectDebugger(page);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              window.__ipc.calls.filter(({ cmd, args }) => {
                if (cmd !== "notebook_debug_request") return false;
                const query = args.query as {
                  command: string;
                  arguments: { source?: { path?: string }; breakpoints?: { line: number }[] };
                };
                return (
                  query.command === "setBreakpoints" &&
                  query.arguments.source?.path === "/tmp/definition.py" &&
                  query.arguments.breakpoints?.some(({ line }) => line === 3)
                );
              }).length,
          ),
        )
        .toBeGreaterThan(0);
      expect(await page.evaluate(() => window.__ipc.calls.filter(({ cmd }) => cmd === "notebook_execute"))).toEqual([]);
      await page
        .locator(".cm-content")
        .filter({ hasText: /^add_one\(\)$/ })
        .click();
      await page.getByRole("button", { name: "Debug Cell", exact: true }).click();
      const frames = page.getByRole("listbox", { name: "Frames", exact: true });
      await expect(frames.getByRole("option", { name: /add_one/ })).toBeVisible();
      const variables = page.getByRole("tree", { name: "Variables", exact: true });
      await expect(variables).toContainText("41");
      await page.getByRole("textbox", { name: "Watch expression", exact: true }).fill("x + 1");
      await page.getByRole("button", { name: "Add Watch", exact: true }).click();
      await expect(variables).toContainText("42");
      await page.getByRole("button", { name: "Step Over", exact: true }).click();
      await expect(variables).toContainText("43");
      await page.screenshot({ path: testInfo.outputPath("mock-notebook-debug-paused.png") });
      await page.getByRole("button", { name: "Resume Program", exact: true }).click();
      await page.getByRole("button", { name: "Disconnect Notebook Debugger", exact: true }).click();
      const requests = await page.evaluate(() =>
        window.__ipc.calls
          .filter(({ cmd }) => cmd === "notebook_debug_request")
          .map(({ args }) => args.query as { command: string; token: string; arguments: Record<string, unknown> }),
      );
      expect(
        requests.some(
          (query) =>
            query.command === "evaluate" && query.arguments.frameId === 11 && query.arguments.expression === "x + 1",
        ),
      ).toBe(true);
      expect(requests.some((query) => query.command === "next")).toBe(true);
      expect(requests.some((query) => query.command === "continue")).toBe(true);
      expect(requests.some((query) => query.command === "disconnect")).toBe(true);
      expect(requests.every((query) => query.token === "debug-generation-1")).toBe(true);
      expect(
        await page.evaluate(() =>
          window.__ipc.calls.filter(({ cmd }) =>
            ["notebook_stop_kernel", "notebook_restart", "notebook_interrupt", "debug_stop", "run_stop"].includes(cmd),
          ),
        ),
      ).toEqual([]);
      await expect(page.getByRole("button", { name: "Start Kernel", exact: true })).toBeEnabled();
    });

    test("Ark signed thread and zero frame remain usable in the rendered debugger", async ({
      workbench: page,
    }, testInfo) => {
      await openMockNotebook(page, true, "r");
      await page.getByRole("button", { name: "Notebook kernel", exact: true }).click();
      await page.getByRole("option", { name: /Ark R mock environment/ }).click();
      await page
        .getByRole("region", { name: "Cell 1: code", exact: true })
        .getByRole("spinbutton", { name: "Breakpoint line", exact: true })
        .fill("3");
      await connectDebugger(page);
      await page
        .locator(".cm-content")
        .filter({ hasText: /^add_one\(\)$/ })
        .click();
      await page.getByRole("button", { name: "Debug Cell", exact: true }).click();
      await expect(
        page.getByRole("listbox", { name: "Frames", exact: true }).getByRole("option", { name: /add_one/ }),
      ).toBeVisible();
      const variables = page.getByRole("tree", { name: "Variables", exact: true });
      await expect(variables).toContainText("41");
      await page.getByRole("textbox", { name: "Watch expression", exact: true }).fill("x + 1");
      await page.getByRole("button", { name: "Add Watch", exact: true }).click();
      await expect(variables).toContainText("42");
      await page.getByRole("button", { name: "Step Over", exact: true }).click();
      await expect(variables).toContainText("43");
      const requests = await page.evaluate(() =>
        window.__ipc.calls
          .filter(({ cmd }) => cmd === "notebook_debug_request")
          .map(({ args }) => args.query as { command: string; arguments: Record<string, unknown> }),
      );
      expect(requests.some(({ command, arguments: args }) => command === "stackTrace" && args.threadId === -1)).toBe(
        true,
      );
      expect(requests.some(({ command, arguments: args }) => command === "scopes" && args.frameId === 0)).toBe(true);
      expect(requests.some(({ command, arguments: args }) => command === "evaluate" && args.frameId === 0)).toBe(true);
      expect(requests.some(({ command, arguments: args }) => command === "next" && args.threadId === -1)).toBe(true);
      expect(
        await page.evaluate(() => window.__ipc.calls.find(({ cmd }) => cmd === "notebook_start_kernel")?.args),
      ).toMatchObject({ selection: "ark|/tools/ark|/tools/R" });
      await page.screenshot({ path: testInfo.outputPath("mock-ark-debug-negative-thread.png") });
    });

    test("capability rejection never initializes or executes the kernel", async ({ workbench: page }) => {
      await openMockNotebook(page, false);
      await page.getByRole("button", { name: "Connect Debugger", exact: true }).click();
      await expect
        .poll(() =>
          page.evaluate(() => window.__ipc.calls.filter(({ cmd }) => cmd === "notebook_debug_capabilities").length),
        )
        .toBe(1);
      await expect(page.getByRole("button", { name: "Debug Cell", exact: true })).toBeDisabled();
      expect(
        await page.evaluate(() =>
          window.__ipc.calls.filter(({ cmd }) => cmd === "notebook_execute" || cmd === "notebook_debug_request"),
        ),
      ).toEqual([]);
    });

    test("restart rejects late events from the retired token", async ({ workbench: page }, testInfo) => {
      await openMockNotebook(page);
      await connectDebugger(page);
      await page.evaluate(() => window.__ipc.handlers.test_debug_stopped({}));
      await expect(page.getByRole("listbox", { name: "Frames", exact: true })).toContainText("add_one");
      await page.getByRole("button", { name: "Restart Kernel", exact: true }).click();
      await connectDebugger(page);
      await page.evaluate(() => window.__ipc.handlers.test_debug_late_event({}));
      await expect(page.getByText("OBSOLETE KERNEL EVENT", { exact: false })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Step Over", exact: true })).toBeDisabled();
      await page.evaluate(() => window.__ipc.handlers.test_debug_stopped({}));
      await expect(page.getByRole("button", { name: "Step Over", exact: true })).toBeEnabled();
      const recent = await page.evaluate(() => {
        const calls = window.__ipc.calls;
        const lastStart = calls.map(({ cmd }) => cmd).lastIndexOf("notebook_start_kernel");
        return calls
          .slice(lastStart)
          .filter(({ cmd }) => cmd === "notebook_debug_request")
          .map(({ args }) => args.query as { token: string; arguments: Record<string, unknown> });
      });
      expect(recent.length).toBeGreaterThan(0);
      expect(recent.every((query) => query.token === "debug-generation-2")).toBe(true);
      expect(recent.some((query) => query.arguments.threadId === 999)).toBe(false);
      await page.screenshot({ path: testInfo.outputPath("mock-notebook-debug-new-generation.png") });
    });
  });
}
