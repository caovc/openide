import { call, commands } from "./ipc";

export const runtimeEnvironmentBackend = {
  python: (python: string) => call(commands.sdkPythonEnvironment(python)),
  rProject: (near: string | null) => call(commands.notebookProjectEnvironment(near)),
};
