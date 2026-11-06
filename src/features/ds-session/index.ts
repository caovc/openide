import { onIdeEvent } from "@/platform/ipc";
import { useProject } from "@/platform/project";
import { registerToolWindow } from "@/workbench/contributions";
import { VariablesPanel, PlotsPanel } from "./Panels";
import { panels } from "./runtime";

export function activate(): () => void {
  const disposers = [
    registerToolWindow({
      id: "ds-variables",
      title: "Variables",
      icon: "toolwindow-debug",
      anchor: "right",
      order: 8,
      component: VariablesPanel,
    }),
    registerToolWindow({
      id: "ds-plots",
      title: "Plots",
      icon: "db-chart",
      anchor: "right",
      order: 9,
      component: PlotsPanel,
    }),
    onIdeEvent("notebookKernel", (event) => panels.kernel(event)),
    useProject.subscribe((state, previous) => {
      if (state.project !== previous.project) panels.reset();
    }),
  ];
  const timer = window.setInterval(() => {
    for (const source of panels.store.getState().sources) void panels.refresh(source.id);
  }, 1200);
  return () => {
    window.clearInterval(timer);
    disposers.reverse().forEach((dispose) => dispose());
    panels.reset();
  };
}
