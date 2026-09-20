import { getDb, logActivity } from "./db";

export function createApproval(kind: string, summary: string, payload?: unknown): number {
  const r = getDb()
    .prepare("INSERT INTO approvals (kind, summary, payload_json) VALUES (?, ?, ?)")
    .run(kind, summary, payload ? JSON.stringify(payload) : null);
  logActivity("APPROVAL_REQUESTED", summary);
  return Number(r.lastInsertRowid);
}

export function resolveApproval(id: number, approve: boolean, via = "dashboard"): boolean {
  const db = getDb();
  const row = db.prepare("SELECT * FROM approvals WHERE id = ? AND status='pending'").get(id) as { id: number; kind: string; payload_json: string | null } | undefined;
  if (!row) return false;

  db.prepare("UPDATE approvals SET status=?, resolved_at=datetime('now'), resolved_via=? WHERE id=?").run(
    approve ? "approved" : "denied", via, id
  );

  if (approve && row.kind === "outreach_send" && row.payload_json) {
    try {
      const payload = JSON.parse(row.payload_json) as { id?: number };
      if (payload.id) {
        db.prepare("UPDATE outreach_queue SET status='queued', scheduled_for=datetime('now') WHERE id=?").run(payload.id);
      }
    } catch { /* malformed payload left as-is */ }
  }
  logActivity(approve ? "APPROVAL_GRANTED" : "APPROVAL_DENIED", `#${id} ${row.kind} via ${via}`);
  return true;
}

export function pendingApprovals(): { id: number; kind: string; summary: string; created_at: string }[] {
  return getDb()
    .prepare("SELECT id, kind, summary, created_at FROM approvals WHERE status='pending' ORDER BY id ASC LIMIT 50")
    .all() as { id: number; kind: string; summary: string; created_at: string }[];
}
