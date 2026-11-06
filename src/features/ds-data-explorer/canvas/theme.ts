export interface CanvasTheme {
  background: string;
  foreground: string;
  muted: string;
  error: string;
  border: string;
  font: string;
}

/** Call with getComputedStyle(host) after theme changes; no hard-coded palette. */
export function resolveCanvasTheme(style: Pick<CSSStyleDeclaration, "getPropertyValue">, fontSize = 12): CanvasTheme {
  if (!Number.isFinite(fontSize) || fontSize <= 0) throw new RangeError("Invalid font size");
  const read = (token: string) => {
    const value = style.getPropertyValue(token).trim();
    if (!value) throw new Error(`Missing canvas theme token: ${token}`);
    return value;
  };
  return {
    background: read("--bg-app"),
    foreground: read("--fg"),
    muted: read("--fg-muted"),
    error: read("--danger"),
    border: read("--border"),
    font: `${fontSize}px ${read("--font-mono")}`,
  };
}
