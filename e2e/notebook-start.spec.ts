import { expect, stubDesktop, test } from "./fixtures";

// Exercise real toolbar/action/session wiring with mocked native IPC and kernel events.
// This browser test does not launch a real Python/R kernel or execute user code.
test("Start Kernel starts the selected runtime and leaves cells untouched", async ({ workbench: page }, testInfo) => {
  await stubDesktop(page);
  await page.evaluate(async () => {
    const snapshot = {
      id: "start-document",
      path: "/dev/acme-api/start.ipynb",
      version: 1,
      dirty: false,
      nbformat: 4,
      nbformatMinor: 5,
      metadata: {},
      canUndo: false,
      canRedo: false,
      cells: [
        {
          id: "first-cell",
          cellType: "code",
          source: 'print("must not execute")',
          metadata: {},
          attachments: {},
          executionCount: null,
          outputs: [],
        },
      ],
    };
    const ipc = window.__ipc;
    ipc.handlers.notebook_open = () => snapshot;
    ipc.handlers.notebook_get = () => snapshot;
    ipc.handlers.sdk_detect = () => [
      { path: "/python", name: "Python test environment", source: "venv", version: "3.12", home: "/", extra: null },
    ];
    ipc.handlers.sdk_python_effective = () => "/python";
    ipc.handlers.notebook_detect_runtimes = () => [];
    let ready = false;
    ipc.handlers.notebook_start_kernel = () =>
      new Promise((resolve) => {
        if (!ready)
          ipc.emit({ type: "notebookKernel", id: snapshot.id, path: snapshot.path, state: "starting", message: null });
        ipc.handlers.test_release_start = () => {
          if (!ready) {
            ready = true;
            ipc.emit({ type: "notebookKernel", id: snapshot.id, path: snapshot.path, state: "idle", message: null });
          }
          resolve({ id: snapshot.id, token: "kernel-session", selection: "/python", language: "python" });
        };
      });
    ipc.handlers.notebook_interrupt = () => null;
    ipc.handlers.cancel_request = () => null;
    const modulePath = "/src/workbench/contributions.ts";
    const { editorService } = await import(/* @vite-ignore */ modulePath);
    await editorService().openFile(snapshot.path);
  });
  const start = page.getByRole("button", { name: "Start Kernel", exact: true });
  await expect(start).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("notebook-before-start.png") });
  await start.click();
  await expect(start).toBeDisabled();
  await expect(page.getByRole("button", { name: "Run All", exact: true })).toBeDisabled();
  await expect(page.getByText("starting", { exact: true })).toBeVisible();
  await page.waitForFunction(() => !!window.__ipc.handlers.test_release_start);
  await page.evaluate(() => window.__ipc.handlers.test_release_start!({}));
  await expect(start).toBeEnabled();
  await expect(page.getByText("idle", { exact: true })).toBeVisible();
  await expect(page.locator(".cm-content").filter({ hasText: 'print("must not execute")' })).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.__ipc.calls.filter(({ cmd }) => cmd === "notebook_execute" || cmd === "notebook_edit"),
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(() => window.__ipc.calls.find(({ cmd }) => cmd === "notebook_start_kernel")?.args),
  ).toMatchObject({ id: "start-document", selection: "/python" });
  await page.screenshot({ path: testInfo.outputPath("notebook-start-ready.png") });

  // A second delayed acquisition can be cancelled without accepting a late handle.
  await start.click();
  await page.waitForFunction(
    () => window.__ipc.calls.filter(({ cmd }) => cmd === "notebook_start_kernel").length === 2,
  );
  await page.getByRole("button", { name: "Interrupt Kernel", exact: true }).click();
  await page.evaluate(() => window.__ipc.handlers.test_release_start!({}));
  await expect(start).toBeEnabled();
  expect(await page.evaluate(() => window.__ipc.calls.some(({ cmd }) => cmd === "cancel_request"))).toBe(true);
  expect(await page.evaluate(() => window.__ipc.calls.some(({ cmd }) => cmd === "notebook_interrupt"))).toBe(false);
  expect(await page.evaluate(() => window.__ipc.calls.some(({ cmd }) => cmd === "notebook_execute"))).toBe(false);
});
