import { runDistiller } from "@/lib/distiller";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const row = getDb().prepare("SELECT value FROM app_state WHERE key='distiller_last_run'").get() as { value: string } | undefined;
  const memories = (getDb().prepare("SELECT COUNT(*) c FROM memories WHERE source='distiller'").get() as { c: number }).c;
  return Response.json({ last_run: row?.value ?? null, distiller_memories: memories });
}

export async function POST(): Promise<Response> {
  const result = await runDistiller();
  return Response.json({ ok: true, ...result });
}
