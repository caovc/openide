import { expect, stubDesktop, test } from "./fixtures";

// Real Console UI over a mocked native IPC boundary; this does not verify kernel execution.
test("Console environment inspection preserves selection and ignores obsolete diagnostics", async ({
  workbench: page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await expect(page).toHaveTitle("acme-api");
  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await stubDesktop(page);
  await page.evaluate(async () => {
    const info = (executable: string, version = "3.12.1") => ({
      executable,
      version,
      prefix: "/env",
      basePrefix: "/base",
      isVirtualenv: true,
      ipykernel: true,
      debugpy: false,
      pip: true,
    });
    let release = () => {};
    Object.assign(window.__ipc.handlers, {
      sdk_detect: () => [
        {
          path: "/env/default/python",
          name: "Project venv",
          kind: "python",
          source: "venv",
          version: "3.12.1",
          home: "/env/default",
          valid: true,
        },
        {
          path: "/env/other/python",
          name: "Other venv",
          kind: "python",
          source: "venv",
          version: "3.12.1",
          home: "/env/other",
          valid: true,
        },
      ],
      sdk_python_effective: () => "/env/default/python",
      notebook_detect_runtimes: () => [],
      sdk_python_environment: ({ python }: { python: string }) =>
        python === "/env/default/python"
          ? new Promise((resolve) => {
              release = () => resolve(info(python, "3.0-stale"));
            })
          : info(python),
      release_old_environment: () => release(),
    });
    const actionsPath = "/src/platform/actions.ts";
    const { executeAction, registerAction } = await import(/* @vite-ignore */ actionsPath);
    registerAction({
      id: "python.interpreterSettings",
      title: "Interpreter Settings…",
      run: () => {
        window.__ipc.calls.push({ cmd: "environment_settings_requested", args: {} });
      },
    });
    await executeAction("ds.console.new");
  });
  const consoleView = page.locator('section[aria-label="Console"]');
  const picker = consoleView.getByRole("combobox", { name: "Notebook kernel" });
  await expect(picker).toHaveValue("/env/default/python");
  await consoleView.getByText("New Console environment", { exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__ipc.calls.filter((c) => c.cmd === "sdk_python_environment").length))
    .toBe(1);
  await picker.selectOption("/env/other/python");
  await expect(consoleView.getByText("Install debugpy in this interpreter to debug Python scripts.")).toBeVisible();
  await page.evaluate(() => window.__ipc.handlers.release_old_environment({}));
  await expect(consoleView.getByText("3.0-stale")).toHaveCount(0);
  await consoleView.getByRole("button", { name: "Refresh environment details" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__ipc.calls.filter((c) => c.cmd === "sdk_python_environment" && c.args.python === "/env/other/python")
            .length,
      ),
    )
    .toBe(2);
  await consoleView.getByRole("button", { name: "Refresh notebook kernels" }).click();
  await expect(picker).toHaveValue("/env/other/python");
  await consoleView.getByRole("button", { name: "Manage Python environments" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__ipc.calls.filter((c) => c.cmd === "environment_settings_requested").length),
    )
    .toBe(1);
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("console-environment.png"), fullPage: true });
});

test("R environment details report project metadata without claiming activation", async ({
  workbench: page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await stubDesktop(page);
  await page.evaluate(async () => {
    Object.assign(window.__ipc.handlers, {
      sdk_detect: () => [],
      sdk_python_effective: () => null,
      notebook_detect_runtimes: () => [
        { id: "ark|/tools/ark|/tools/R", kind: "ark", name: "Ark R", path: "/tools/ark", home: "/tools/R" },
      ],
      notebook_project_environment: () => ({
        projectRoot: "/dev/acme-api",
        renvStatus: "detected-inactive",
        hasLockfile: true,
        hasActivateScript: true,
        hasProjectProfile: true,
        lockedRVersion: "4.5.0",
        lockedPackageCount: 12,
        diagnostics: [],
      }),
    });
    const actionsPath = "/src/platform/actions.ts";
    const { executeAction } = await import(/* @vite-ignore */ actionsPath);
    await executeAction("ds.console.new");
  });
  const consoleView = page.locator('section[aria-label="Console"]');
  await consoleView.getByText("New Console environment", { exact: true }).click();
  await expect(consoleView.getByText("renv detected; activation not verified", { exact: true })).toBeVisible();
  await expect(consoleView.getByText("Locked R version", { exact: true })).toBeVisible();
  await expect(consoleView.getByText("4.5.0", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__ipc.calls.filter((call) => call.cmd === "sdk_python_environment"))).toEqual(
    [],
  );
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("r-environment.png"), fullPage: true });
});
