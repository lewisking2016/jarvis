import { getDb, logActivity } from "./db";

export interface MemoryLike {
  id: number;
  kind: string;
  content: string;
  importance: number;
  confidence: number;
  source: string;
  use_count: number;
  created_at: string;
}

/** Add a memory with simple FTS-backed dedupe. */
export function remember(input: {
  kind: "fact" | "decision" | "preference" | "event" | "lesson" | "relationship";
  content: string;
  entities?: string[];
  importance?: number;
  source?: string;
}): { id: number; deduped: boolean } {
  const db = getDb();
  const trimmed = input.content.trim();
  if (!trimmed) throw new Error("content required");

  // dedupe: exact-ish match on recent rows
  const dup = db
    .prepare("SELECT id FROM memories WHERE content = ? AND superseded_by IS NULL")
    .get(trimmed);
  if (dup) return { id: Number((dup as { id: number }).id), deduped: true };

  const r = db
    .prepare(
      `INSERT INTO memories (kind, content, entities, importance, source)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(input.kind, trimmed, input.entities ? JSON.stringify(input.entities) : null, input.importance ?? 2, input.source ?? "agent");
  logActivity("MEMORY_ADD", trimmed.slice(0, 100));
  return { id: Number(r.lastInsertRowid), deduped: false };
}

function scoreTokens(query: string): string[] {
  return query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
}

/** Score-based recall: FTS match + recency + importance + usage. */
export function recall(query: string, limit = 8): MemoryLike[] {
  const db = getDb();
  const tokens = scoreTokens(query);
  const rows = db
    .prepare("SELECT * FROM memories WHERE superseded_by IS NULL ORDER BY id DESC LIMIT 800")
    .all() as unknown as (MemoryLike & { entities: string | null })[];

  const now = Date.now();
  const scored = rows.map((m) => {
    const text = m.content.toLowerCase();
    let match = 0;
    for (const t of tokens) if (text.includes(t)) match++;
    const matchScore = tokens.length ? (match / tokens.length) * 2 : 0;
    const ageDays = (now - new Date(m.created_at + "Z").getTime()) / 864e5;
    const recency = 1.5 * Math.exp(-ageDays / 90);
    const importance = m.importance;
    const usage = 0.5 * Math.log1p(m.use_count);
    return { m, score: matchScore + recency + importance + usage };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => {
      db.prepare("UPDATE memories SET use_count = use_count + 1, last_used_at = datetime('now') WHERE id = ?").run(s.m.id);
      return s.m;
    });
}

/** The 500-token memory header injected into every conversation. */
export function memoryHeader(incomingMessage?: string): string {
  const db = getDb();
  const identity = db
    .prepare("SELECT content FROM memories WHERE kind='identity' AND superseded_by IS NULL ORDER BY id LIMIT 6")
    .all() as { content: string }[];

  const prefs = db
    .prepare("SELECT content FROM memories WHERE kind IN ('preference','lesson') AND superseded_by IS NULL ORDER BY importance DESC, use_count DESC LIMIT 3")
    .all() as { content: string }[];

  const activeEntities = db
    .prepare("SELECT entities, MAX(created_at) recent, COUNT(*) n FROM memories WHERE entities IS NOT NULL AND superseded_by IS NULL GROUP BY entities ORDER BY recent DESC LIMIT 3")
    .all() as { entities: string; n: number }[];

  const recallRows = incomingMessage ? recall(incomingMessage, 5) : [];

  const lines: string[] = ["[MEMORY — ground truth about IMT and the principal]"];
  for (const i of identity) lines.push(`- ${i.content}`);
  if (prefs.length) lines.push("PREFERENCES & LESSONS:", ...prefs.map((p) => `- ${p.content}`));
  if (activeEntities.length) {
    lines.push("ACTIVE THREADS:");
    for (const e of activeEntities) {
      try {
        const ent = JSON.parse(e.entities) as string[];
        lines.push(`- ${ent.join(", ")} (${e.n} memories)`);
      } catch { /* skip malformed */ }
    }
  }
  if (recallRows.length) {
    lines.push("RELEVANT RECALL:");
    for (const r of recallRows) lines.push(`- (${r.kind}) ${r.content}`);
  }
  return lines.join("\n");
}
