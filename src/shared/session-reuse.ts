import { repositoryKey } from "./memory";
import type { Credentials, SessionCard } from "./protocol";

export interface SavedMembership {
  id: string;
  time: number;
  credentials: Credentials;
}
export interface ResumableSession extends SessionCard {
  lastUsed: number;
  verified: boolean;
}

export async function findUnfinishedSessions(
  repo: string,
  cached: SessionCard[],
  memberships: SavedMembership[],
  observe: (credentials: Credentials) => Promise<SessionCard | undefined>,
): Promise<ResumableSession[]> {
  const key = repositoryKey(repo);
  const cards = new Map(cached.map((card) => [card.id, card]));
  const unique = new Map(
    memberships.map((membership) => [membership.id, membership]),
  );
  const results = await Promise.all(
    [...unique.values()].map(async (membership) => {
      const previous = cards.get(membership.id);
      if (previous && repositoryKey(previous.repo) !== key) return;
      let card = previous;
      let verified = false;
      try {
        card = await observe(membership.credentials);
        verified = true;
      } catch {
        // Keep known unfinished work visible when its relay is unavailable.
      }
      if (
        !card ||
        card.id !== membership.id ||
        repositoryKey(card.repo) !== key ||
        !card.lifecycle ||
        card.archived ||
        ["merged", "closed"].includes(card.lifecycle.status)
      )
        return;
      return { ...card, lastUsed: membership.time, verified };
    }),
  );
  return results
    .filter((card): card is ResumableSession => !!card)
    .sort((a, b) => b.lastUsed - a.lastUsed || b.created - a.created);
}
