import { revenueStatus } from "@/lib/revenue";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const status = revenueStatus();
  const db = getDb();
  const snapshots = db.prepare("SELECT metric, value, taken_at FROM metric_snapshots ORDER BY id DESC LIMIT 30").all();
  const goal = db.prepare("SELECT * FROM goals WHERE status='active' ORDER BY id DESC LIMIT 1").get();
  return Response.json({ status, goal, snapshots });
}
