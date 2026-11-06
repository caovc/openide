import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { registerAction } from "@/platform/actions";
import { runtimeEnvironmentBackend } from "@/platform/runtimeEnvironment";
import { RuntimeEnvironmentDetails } from "./RuntimeEnvironmentDetails";

const info = (path: string) => ({
  executable: path,
  version: "3.12.1",
  prefix: "/venv",
  basePrefix: "/base",
  isVirtualenv: true,
  ipykernel: true,
  debugpy: false,
  pip: true,
});
function expand(label = "Environment details") {
  const details = screen.getByText(label).closest("details")!;
  act(() => {
    details.open = true;
    fireEvent(details, new Event("toggle"));
  });
}
afterEach(() => vi.restoreAllMocks());
it("loads only on expansion and diagnoses the selected interpreter without installing packages", async () => {
  const probe = vi.spyOn(runtimeEnvironmentBackend, "python").mockResolvedValue(info("/venv/python"));
  render(<RuntimeEnvironmentDetails selection="/venv/python" />);
  expect(probe).not.toHaveBeenCalled();
  expand();
  await screen.findByText("3.12.1");
  expect(probe).toHaveBeenCalledExactlyOnceWith("/venv/python");
  expect(screen.getByText("Install debugpy in this interpreter to debug Python scripts.")).toBeVisible();
  expect(screen.getByText("Module not found")).toBeVisible();
});
it("ignores a late result from the previous selection", async () => {
  let resolve!: (v: ReturnType<typeof info>) => void;
  vi.spyOn(runtimeEnvironmentBackend, "python").mockImplementation((path) =>
    path === "/old"
      ? new Promise((r) => {
          resolve = r;
        })
      : Promise.resolve(info("/new")),
  );
  const { rerender } = render(<RuntimeEnvironmentDetails selection="/old" />);
  expand();
  await waitFor(() => expect(resolve).toBeDefined());
  rerender(<RuntimeEnvironmentDetails selection="/new" />);
  await screen.findByText("3.12.1");
  await act(async () => resolve({ ...info("/old"), version: "stale" }));
  expect(screen.queryByText("stale")).toBeNull();
  expect(screen.getByText("/new", { selector: "dd" })).toBeVisible();
});
it("keeps R inspection read-only and never calls the Python probe", async () => {
  const python = vi.spyOn(runtimeEnvironmentBackend, "python");
  const project = vi.spyOn(runtimeEnvironmentBackend, "rProject").mockResolvedValue({
    projectRoot: "/project",
    renvStatus: "detected-inactive",
    hasLockfile: true,
    hasActivateScript: true,
    hasProjectProfile: true,
    lockedRVersion: "4.5.0",
    lockedPackageCount: 2,
    diagnostics: [],
  });
  render(<RuntimeEnvironmentDetails selection="ark|/bin/ark|/lib/R" near="/project/notebooks/a.ipynb" />);
  expand();
  await screen.findByText("renv detected; activation not verified");
  expect(project).toHaveBeenCalledExactlyOnceWith("/project/notebooks/a.ipynb");
  expect(python).not.toHaveBeenCalled();
  expect(screen.getByText("/lib/R")).toBeVisible();
  expect(screen.queryByText("Manage Python environments")).toBeNull();
});
it("opens the existing interpreter settings action", async () => {
  const run = vi.fn();
  const dispose = registerAction({ id: "python.interpreterSettings", title: "Interpreter Settings…", run });
  try {
    render(<RuntimeEnvironmentDetails selection={null} />);
    expand();
    fireEvent.click(screen.getByRole("button", { name: "Manage Python environments" }));
    await waitFor(() => expect(run).toHaveBeenCalledOnce());
  } finally {
    dispose();
  }
});
it("reports probe errors and retries without replacing the selected path", async () => {
  const probe = vi
    .spyOn(runtimeEnvironmentBackend, "python")
    .mockRejectedValueOnce(new Error("Interpreter removed"))
    .mockResolvedValue(info("/missing"));
  render(<RuntimeEnvironmentDetails selection="/missing" />);
  expand();
  expect(await screen.findByRole("alert")).toHaveTextContent("Interpreter removed");
  fireEvent.click(screen.getByRole("button", { name: "Refresh environment details" }));
  await screen.findByText("3.12.1");
  expect(probe).toHaveBeenCalledTimes(2);
  expect(probe).toHaveBeenLastCalledWith("/missing");
});

it("rejects incomplete or relative R selections before probing", async () => {
  const project = vi.spyOn(runtimeEnvironmentBackend, "rProject");
  render(<RuntimeEnvironmentDetails selection="ark|relative/ark|relative/R" />);
  expand();
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid R environment selection");
  expect(project).not.toHaveBeenCalled();
});
