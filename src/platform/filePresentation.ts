/** File icon presentation follows the installed icon theme without language-server work. */
import { useMemo } from "react";
import { fileIconName, useFileIconRevision } from "@/ui/icons";
import { basename } from "./project";

export function useFilePresentation(path: string, _mtime?: number | null) {
  useFileIconRevision();
  return { icon: fileIconName(basename(path), path), runnable: false };
}

export function useFilePresentationIcons(paths: readonly string[]) {
  const key = JSON.stringify(paths);
  const iconRevision = useFileIconRevision();
  return useMemo(
    () => new Map((JSON.parse(key) as string[]).map((path) => [path, fileIconName(basename(path), path)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when the icon theme changes
    [key, iconRevision],
  );
}
