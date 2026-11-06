import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KernelInput } from "./KernelInput";

describe("notebook kernel input form", () => {
  it("masks password input, submits the exact value, and prevents duplicate replies", async () => {
    let finish = () => {};
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const reply = vi.fn(() => pending);
    const { container } = render(
      <KernelInput input={{ prompt: "Secret>", password: true }} disabled={false} onReply={reply} />,
    );
    const input = screen.getByLabelText("Kernel input");
    expect(input.getAttribute("type")).toBe("password");
    fireEvent.change(input, { target: { value: "secret" } });
    const form = container.querySelector("form");
    if (!form) throw new Error("missing input form");
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(reply).toHaveBeenCalledExactlyOnceWith("secret");
    expect(input.hasAttribute("disabled")).toBe(true);
    await act(async () => finish());
  });

  it("cancels with null and disables both actions during lifecycle transitions", async () => {
    const reply = vi.fn(async () => {});
    const { rerender } = render(<KernelInput input={{ prompt: ">", password: false }} disabled onReply={reply} />);
    const cancel = screen.getByRole("button", { name: "Cancel kernel input" });
    fireEvent.click(cancel);
    expect(reply).not.toHaveBeenCalled();
    rerender(<KernelInput input={{ prompt: ">", password: false }} disabled={false} onReply={reply} />);
    await act(async () => fireEvent.click(cancel));
    expect(reply).toHaveBeenCalledExactlyOnceWith(null);
  });
});
