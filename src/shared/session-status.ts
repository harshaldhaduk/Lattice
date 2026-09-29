import type { SessionCard } from "./protocol";

// Completed means implementation is ready for review, not that Git was merged.
export function isCompletedSession(
  session: Pick<SessionCard, "archived" | "lifecycle">,
) {
  return session.archived || session.lifecycle?.status === "review";
}
