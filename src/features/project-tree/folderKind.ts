/** Folder roles come from the effective project roots, independent of a build toolchain. */
import { rootFor, rootRole, type FolderRole, type RootFolder } from "@/platform/languageSettings";
import { basename, relativePath } from "@/platform/project";
import type { FolderKind } from "@/ui";
import type { ProjectNode } from "./model";
import { packageKindAt } from "./packages";

const ROLE_KIND: Record<FolderRole, FolderKind> = {
  source: "source",
  test: "test",
  resources: "resources",
  testResources: "testResources",
  excluded: "excluded",
};

export function folderKind(
  node: Pick<ProjectNode, "path" | "excluded">,
  roots: readonly RootFolder[],
  root: string | null,
  detected: readonly RootFolder[] = [],
): FolderKind {
  const rel = root ? (node.path === root ? "" : relativePath(root, node.path)) : null;
  const role = rel === null ? null : rootRole(roots, rel);
  if (role) return ROLE_KIND[role];
  const containing = rel === null ? null : rootFor(roots, rel);
  if (node.excluded || containing?.kind === "excluded") return "excluded";
  if (rel !== null && packageKindAt(rel, roots, detected) === "python") return "package";
  return basename(node.path) === ".github" ? "github" : "plain";
}
