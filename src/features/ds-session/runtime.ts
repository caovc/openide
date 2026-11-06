import { call, commands } from "@/platform/ipc";
import { SessionPanels } from "./store";

export const panels = new SessionPanels({
  snapshot: (id) => call(commands.dsSessionSnapshot(id)),
  inspect: (id, generation, revision, path) => call(commands.dsSessionInspect(id, generation, revision, path)),
});
