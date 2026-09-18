import type { Session } from "./protocol";
type SearchRow = {
  id: string;
  kind: string;
  text: string;
  time: number;
  file?: string;
  author: string;
  sessionId: string;
  sessionTitle: string;
};
export class SessionSearchIndex {
  private rows: SearchRow[];
  private words = new Map<string, Set<number>>();
  constructor(session: Session) {
    this.rows = [
      ...session.memories
        .filter((n) => !n.resolved)
        .map((n) => ({ ...n, kind: "memory" })),
      ...session.comments.map((n) => ({ ...n, kind: "comment" })),
      ...session.entries.map((n) => ({ ...n, author: n.actor })),
    ].map((n) => ({
      id: n.id,
      kind: n.kind,
      text: n.text,
      time: n.time,
      file: "file" in n ? n.file : undefined,
      author: n.author,
      sessionId: session.id,
      sessionTitle: session.title,
    }));
    this.rows.forEach((row, index) => {
      for (const word of new Set(
        (row.text + " " + (row.file || ""))
          .toLocaleLowerCase()
          .match(/[\p{L}\p{N}_./-]+/gu) || [],
      )) {
        let list = this.words.get(word);
        if (!list) this.words.set(word, (list = new Set()));
        list.add(index);
      }
    });
  }
  search(query: string, kind = "all") {
    const terms = query.toLocaleLowerCase().match(/[\p{L}\p{N}_./-]+/gu) || [];
    let matches: Set<number> | undefined;
    for (const term of terms) {
      const found = new Set<number>();
      for (const [word, rows] of this.words)
        if (word.includes(term)) for (const row of rows) found.add(row);
      matches = matches
        ? new Set([...matches].filter((row) => found.has(row)))
        : found;
    }
    return (matches ? [...matches].map((index) => this.rows[index]) : this.rows)
      .filter(
        (row) =>
          kind === "all" ||
          (kind === "memory"
            ? row.kind === "memory"
            : !["memory", "comment"].includes(row.kind)),
      )
      .sort((a, b) => b.time - a.time)
      .slice(0, 50);
  }
}
export function searchSession(session: Session, query: string, kind = "all") {
  const terms = [
    ...new Set(query.toLocaleLowerCase().split(/\s+/).filter(Boolean)),
  ];
  const candidates = [
    ...(kind !== "history"
      ? session.memories.map((n) => ({
          id: n.id,
          kind: "memory",
          text: n.text,
          time: n.time,
          file: n.file,
          author: n.author,
        }))
      : []),
    ...(kind !== "memory"
      ? session.entries.map((n) => ({
          id: n.id,
          kind: n.kind,
          text: n.text,
          time: n.time,
          file: undefined,
          author: n.actor,
        }))
      : []),
    ...(kind === "all"
      ? session.comments.map((n) => ({
          id: n.id,
          kind: "comment",
          text: n.text,
          time: n.time,
          file: n.file,
          author: n.author,
        }))
      : []),
  ];
  return candidates
    .map((n) => ({
      ...n,
      score: terms.reduce(
        (score, term) =>
          score + (n.text.toLocaleLowerCase().includes(term) ? 1 : 0),
        0,
      ),
    }))
    .filter((n) => !terms.length || n.score === terms.length)
    .sort((a, b) => b.score - a.score || b.time - a.time)
    .slice(0, 50);
}
export function budgetExceeded(session: Session) {
  const usage = session.people.reduce(
    (sum, p) => ({
      tokens: sum.tokens + p.usage.input + p.usage.output,
      cost: sum.cost + (p.usage.cost || 0),
    }),
    { tokens: 0, cost: 0 },
  );
  return !!(
    (session.budget?.tokens && usage.tokens >= session.budget.tokens) ||
    (session.budget?.cost && usage.cost >= session.budget.cost)
  );
}
