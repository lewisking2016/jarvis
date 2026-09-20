import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const tasks = getDb().prepare("SELECT * FROM tasks WHERE status = 'open' ORDER BY due IS NULL, due").all();
  const notes = getDb().prepare("SELECT id, title, created_at FROM notes ORDER BY id DESC LIMIT 20").all();
  return Response.json({ tasks, notes });
}
