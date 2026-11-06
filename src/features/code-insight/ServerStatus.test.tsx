import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { registerAction } from "@/platform/actions";
import { ServerStatus } from "./ServerStatus";
import { useServers, type ServerEntry } from "./servers";

const server = (status: ServerEntry["status"], message: string | null): ServerEntry =>
  ({ id: 1, name: "pyright", status, message, languages: ["Python"], root: null }) as unknown as ServerEntry;

afterEach(() => useServers.setState({ servers: new Map() }));

describe("Language server status popup", () => {
  it("offers installation for a missing Python language server", () => {
    const run = vi.fn();
    const off = registerAction({ id: "tools.install", title: "Install tool", run: ({ arg }) => run(arg) });
    useServers.setState({
      servers: new Map([[1 as never, server("missing", "Install pyright to enable Python code insight")]]),
    });
    render(<ServerStatus />);
    fireEvent.click(screen.getByRole("button", { name: /Language servers/ }));
    fireEvent.click(screen.getByRole("button", { name: "Install pyright" }));
    expect(run).toHaveBeenCalledWith("pyright");
    off();
  });

  it("keeps Restart for other failures", () => {
    useServers.setState({ servers: new Map([[1 as never, server("crashed", "exit code 1")]]) });
    render(<ServerStatus />);
    fireEvent.click(screen.getByRole("button", { name: /Language servers/ }));
    expect(screen.queryByRole("button", { name: /Download JDK/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Restart pyright" })).toBeInTheDocument();
  });
});
