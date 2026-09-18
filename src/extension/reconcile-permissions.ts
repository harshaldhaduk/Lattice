import { realpath } from "node:fs/promises";
import { dirname, relative, resolve, isAbsolute } from "node:path";
// Automatic repair may inspect the candidate and edit only its conflicted files.
// Commands or expanded provider permissions are not silently approved here.
export async function allowReconcileTool(
  root: string,
  conflicts: string[],
  title: string,
  detail: string,
) {
  if (!["Read", "Edit", "Write", "MultiEdit"].includes(title)) return false;
  try {
    const input = JSON.parse(detail);
    if (typeof input.file_path !== "string") return false;
    const path = resolve(root, input.file_path);
    const rel = relative(root, path);
    if (
      !rel ||
      rel.startsWith("..") ||
      isAbsolute(rel) ||
      rel.split(/[\\/]/).includes(".git")
    )
      return false;
    const canonical = await realpath(path).catch(async () =>
      resolve(await realpath(dirname(path)), path.split(/[\\/]/).at(-1)!),
    );
    const outside = relative(await realpath(root), canonical);
    if (outside.startsWith("..") || isAbsolute(outside)) return false;
    return title === "Read" || conflicts.includes(rel);
  } catch {
    return false;
  }
}
