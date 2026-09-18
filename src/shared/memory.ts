import type { Session } from "./protocol";
export function staleNotes(session: Session, file: string, hash?: string) {
  for (const note of [...session.memories, ...session.comments])
    if (note.file === file && (!hash || note.anchorHash !== hash))
      note.stale = true;
}
export function repositoryKey(repo: string) {
  return repo
    .replace(/^git@github\.com:/i, "https://github.com/")
    .replace(/\.git\/?$/, "")
    .replace(/\/$/, "")
    .toLowerCase();
}
