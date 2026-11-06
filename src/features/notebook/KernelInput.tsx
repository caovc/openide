import { useState } from "react";
import { tx } from "@/platform/i18n";
import { Button, Input } from "@/ui";
import styles from "./Notebook.module.css";

export function KernelInput({
  input,
  disabled,
  onReply,
}: {
  input: { prompt: string; password: boolean };
  disabled: boolean;
  onReply: (answer: string | null) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const reply = (answer: string | null) => {
    if (sending || disabled) return;
    setSending(true);
    void onReply(answer).finally(() => setSending(false));
  };
  return (
    <form
      data-kernel-input
      className={styles.kernelInput}
      onSubmit={(event) => {
        event.preventDefault();
        reply(value);
      }}
    >
      <label>
        <span>{input.prompt}</span>
        <Input
          autoFocus
          type={input.password ? "password" : "text"}
          aria-label={tx("Kernel input")}
          value={value}
          disabled={disabled || sending}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <Button size="small" type="submit" disabled={disabled || sending}>
        {tx("Reply to kernel")}
      </Button>
      <Button size="small" type="button" disabled={disabled || sending} onClick={() => reply(null)}>
        {tx("Cancel kernel input")}
      </Button>
    </form>
  );
}
