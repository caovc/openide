/** Remove an existing special breakpoint, otherwise toggle a line breakpoint. */
import { removeSpecial, specialAt } from "./special";
import { toggleBreakpoint } from "./store";

export function toggleBreakpointSmart(path: string, line: number, _language: string, _text: string) {
  const special = specialAt(path).find((b) => b.line === line);
  if (special) removeSpecial(special.id);
  else toggleBreakpoint(path, line);
}
