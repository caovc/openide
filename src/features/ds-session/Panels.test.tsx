import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionChildren, SessionSnapshot } from "@/bindings";

const backend = vi.hoisted(() => ({ snapshot: vi.fn(), inspect: vi.fn() }));
vi.mock("./runtime", async () => {
  const { SessionPanels } = await import("./store");
  return { panels: new SessionPanels(backend) };
});
import { panels } from "./runtime";
import { PlotsPanel, VariablesPanel } from "./Panels";

const snapshot: SessionSnapshot = {
  generation: "r1",
  path: "/test.ipynb",
  language: "R",
  revision: 1,
  variables: [{ key: "list", name: "object", typeName: "list", summary: "2 elements", hasChildren: true }],
  total: 1,
  plots: [
    { id: "1", mime: "image/png", data: "first", executionId: "e1" },
    { id: "2", mime: "image/png", data: "second", executionId: "e2" },
  ],
  ready: true,
  error: null,
};

afterEach(() => {
  cleanup();
  panels.reset();
  vi.clearAllMocks();
});

async function ready() {
  backend.snapshot.mockResolvedValue(snapshot);
  await act(async () => {
    panels.kernel({ id: "r", path: "/test.ipynb", state: "idle" });
  });
}

describe("Variables and Plots tool windows", () => {
  it("uses accessible headers and lazy buttons, and resets children with the variable revision", async () => {
    await ready();
    render(<VariablesPanel />);
    expect(screen.getAllByRole("columnheader").map((element) => element.textContent)).toEqual([
      "Name",
      "Type",
      "Summary",
    ]);
    expect(backend.inspect).not.toHaveBeenCalled();
    const children: SessionChildren = {
      generation: "r1",
      revision: 1,
      variables: [{ key: "answer", name: "answer", typeName: "double", summary: "42", hasChildren: false }],
      total: 1,
    };
    backend.inspect.mockResolvedValue(children);
    fireEvent.click(screen.getByRole("button", { name: "Expand object" }));
    await screen.findByText("42");
    expect(screen.getByRole("button", { name: "Collapse object" }).getAttribute("aria-expanded")).toBe("true");
    backend.snapshot.mockResolvedValue({ ...snapshot, revision: 2 });
    await act(async () => {
      await panels.refresh("r");
    });
    expect(screen.queryByText("42")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand object" })).toBeTruthy();
  });

  it("shows plot history, allows navigation and clears both panels on restart", async () => {
    await ready();
    render(
      <>
        <VariablesPanel />
        <PlotsPanel />
      </>,
    );
    await waitFor(() => expect(screen.getByRole("img").getAttribute("src")).toContain("second"));
    fireEvent.click(screen.getByRole("button", { name: "Previous plot" }));
    expect(screen.getByRole("img").getAttribute("src")).toContain("first");
    fireEvent.click(screen.getByRole("button", { name: "Next plot" }));
    expect(screen.getByRole("img").getAttribute("src")).toContain("second");
    act(() => {
      panels.kernel({ id: "r", path: "/test.ipynb", state: "starting" });
    });
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText("object")).toBeNull();
  });

  it("shows shared selection and a useful empty state", async () => {
    render(<VariablesPanel />);
    expect(screen.getByRole("status").textContent).toContain("Execute Python or R");
    await ready();
    backend.snapshot.mockResolvedValue({ ...snapshot, generation: "python", language: "python", variables: [] });
    await act(async () => {
      panels.kernel({ id: "python", path: "/python.ipynb", state: "idle" });
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Session" }), { target: { value: "python" } });
    expect(panels.store.getState().selected).toBe("python");
    expect(screen.queryByText("object")).toBeNull();
  });
});
