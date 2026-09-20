import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const rows = getDb().prepare("SELECT * FROM activity ORDER BY id DESC LIMIT 50").all();
  return Response.json({ activity: rows });
}
