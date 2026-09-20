import { getDb, logActivity } from "./db";
import { remember } from "./memory";

interface DistillResult {
  ran_at: string;
  activity_scanned: number;
  chats_scanned: number;
  added: number;
  deduped: number;
  notes: string[];
}

/**
 * The nightly distiller (DESIGN.md §10.2). Condenses the day's raw operational log into
 * durable memories. Heuristic engine: deterministic rules now; an optional LLM pass can
 * replace summarizeToMemories later without changing the callers.
 */
export async function runDistiller(): Promise<DistillResult> {
  const db = getDb();
  const since = getLastRun();
  const notes: string[] = [];
  let added = 0;
  let deduped = 0;

  const acts = db
    .prepare("SELECT action, detail, created_at FROM activity WHERE created_at > ? ORDER BY id DESC LIMIT 400")
    .all(since) as { action: string; detail: string | null; created_at: string }[];

  const chats = db
    .prepare("SELECT action, detail FROM activity WHERE action='CHAT' AND created_at > ? ORDER BY id DESC LIMIT 40")
    .all(since) as { detail: string | null }[];

  /* Rule 1 — revenue events become facts */
  const receipts = acts.filter((a) => a.action === "RECEIPT_ISSUED");
  for (const r of receipts.slice(0, 5)) {
    const res = remember({ kind: "event", content: `Payment received: ${r.detail ?? ""} (on ${r.created_at.slice(0, 10)}).`, importance: 3, source: "distiller" });
    res.deduped ? deduped++ : added++;
  }

  /* Rule 2 — pipeline movement becomes facts */
  const moved = acts.filter((a) => a.action === "LEAD_UPDATED" && a.detail);
  const toWon = moved.filter((a) => a.detail?.includes("-> won"));
  for (const w of toWon.slice(0, 5)) {
    const res = remember({ kind: "event", content: `Deal won: ${w.detail?.replace("LEAD_UPDATED", "").trim()}.`, importance: 4, source: "distiller" });
    res.deduped ? deduped++ : added++;
  }
  if (moved.length > 0) notes.push(`${moved.length} pipeline movement(s) scanned`);

  /* Rule 3 — documents issued become facts */
  const docs = acts.filter((a) => a.action === "DOC_CREATED");
  for (const d of docs.slice(0, 5)) {
    const res = remember({ kind: "event", content: `Document issued: ${d.detail ?? ""}.`, importance: 2, source: "distiller" });
    res.deduped ? deduped++ : added++;
  }

  /* Rule 4 — chat topics become low-importance event memories (cap 3) */
  for (const c of chats.slice(0, 3)) {
    if (!c.detail || c.detail.length < 8) continue;
    const res = remember({ kind: "event", content: `Principal directive on ${new Date().toISOString().slice(0, 10)}: ${c.detail.slice(0, 120)}.`, importance: 1, source: "distiller" });
    res.deduped ? deduped++ : added++;
  }

  /* Rule 5 — daily rollup note */
  const moneyIn = (db.prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE direction='in' AND created_at > ?").get(since) as { s: number }).s;
  const moneyOut = (db.prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE direction='out' AND created_at > ?").get(since) as { s: number }).s;
  const rollup = `Daily rollup ${new Date().toISOString().slice(0, 10)}: ${acts.length} actions, KES ${moneyIn.toLocaleString()} in, KES ${moneyOut.toLocaleString()} out.`;
  const rollupRes = remember({ kind: "event", content: rollup, importance: 2, source: "distiller" });
  rollupRes.deduped ? deduped++ : added++;
  notes.push(rollup);

  setLastRun();
  logActivity("DISTILLER_RUN", `${added} added, ${deduped} deduped`);
  return { ran_at: new Date().toISOString(), activity_scanned: acts.length, chats_scanned: chats.length, added, deduped, notes };
}

function getLastRun(): string {
  const row = getDb().prepare("SELECT value FROM app_state WHERE key='distiller_last_run'").get() as { value: string } | undefined;
  if (!row) return new Date(Date.now() - 26 * 3600e3).toISOString().replace("T", " ").slice(0, 19);
  // app_state stores 'YYYY-MM-DD HH:MM:SS' (UTC)
  return `${row.value.replace(" ", "T")}Z`;
}

function setLastRun(): void {
  getDb()
    .prepare("INSERT INTO app_state (key, value) VALUES ('distiller_last_run', datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run();
}
