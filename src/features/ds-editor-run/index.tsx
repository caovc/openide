import { activeEditor } from "@/editor/api";
import { registerActions } from "@/platform/actions";
import { tx } from "@/platform/i18n";
import { useProject } from "@/platform/project";
import { notifications, registerMenuGroup, registerOverlay, toolWindowService } from "@/workbench/contributions";
import { consoleAction, consoleTargets, discoverRuntimes } from "./bridge";
import { EditorRunController } from "./controller";
import { captureSource, type ConsoleTarget } from "./model";
import { EditorRunPicker } from "./Picker";

export function activate() {
  const controller = new EditorRunController({
    capture: captureSource,
    targets: consoleTargets,
    discover: discoverRuntimes,
    action: consoleAction,
    show: () => toolWindowService().show("ds-console", true),
  });
  const report = async (operation: () => Promise<void>) => {
    try {
      await operation();
    } catch (error) {
      notifications().notify({ level: "error", title: tx("Run in Console"), body: String(error), group: "run" });
    }
  };
  const disposers = [
    registerOverlay({ id: "ds.editorRun.picker", component: () => <EditorRunPicker controller={controller} /> }),
    registerActions([
      {
        id: "ds.editorRun.selection",
        title: "Run Selection in Console",
        category: "Run",
        when: "projectOpen && textEditorActive",
        run: ({ arg }) => report(() => controller.run("selection", false, arg as ConsoleTarget | undefined)),
      },
      {
        id: "ds.editorRun.file",
        title: "Run Current Buffer in Console",
        category: "Run",
        when: "projectOpen && textEditorActive",
        run: ({ arg }) => report(() => controller.run("file", false, arg as ConsoleTarget | undefined)),
      },
      {
        id: "ds.editorRun.chooseSelection",
        title: "Run Selection in Console…",
        category: "Run",
        when: "projectOpen && textEditorActive",
        run: () => report(() => controller.run("selection", true)),
      },
      {
        id: "ds.editorRun.chooseFile",
        title: "Run Current Buffer in Console…",
        category: "Run",
        when: "projectOpen && textEditorActive",
        run: () => report(() => controller.run("file", true)),
      },
      {
        id: "ds.editorRun.cancel",
        title: "Stop Editor Run in Console",
        category: "Run",
        when: "projectOpen",
        run: () => report(() => controller.cancel()),
      },
    ]),
    registerMenuGroup({
      id: "ds.editorRun",
      menus: ["editor"],
      order: 15,
      items: (_menu, context) => {
        const editor = activeEditor();
        if (
          !editor ||
          editor.ctx.virtual ||
          !["r", "python"].includes(editor.ctx.language) ||
          context.paths[0] !== editor.ctx.path
        )
          return [];
        return [
          {
            kind: "action",
            action: "ds.editorRun.selection",
            label: "Run Selection in Console",
            disabled: editor.view.state.selection.main.empty,
          },
          { kind: "action", action: "ds.editorRun.file", label: "Run Current Buffer in Console" },
          {
            kind: "action",
            action: "ds.editorRun.chooseSelection",
            label: "Run Selection in Console…",
            disabled: editor.view.state.selection.main.empty,
          },
          { kind: "action", action: "ds.editorRun.chooseFile", label: "Run Current Buffer in Console…" },
          { kind: "action", action: "ds.editorRun.cancel", label: "Stop Editor Run in Console" },
        ];
      },
    }),
    useProject.subscribe((state, previous) => {
      if (state.project !== previous.project) controller.reset();
    }),
  ];
  return () => {
    controller.reset();
    disposers.reverse().forEach((dispose) => dispose());
  };
}
