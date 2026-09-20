import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { runSelfCheck } from "@/lib/selfcheck";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Last stored self-check report. */
export async function GET(): Promise<Response> {
  const row = getDb().prepare("SELECT value FROM app_state WHERE key = 'selfcheck_last'").get() as
    | { value: string }
    | undefined;
  if (!row) return Response.json({ last: null, message: "No self-check has run yet." });
  return Response.json({ last: JSON.parse(row.value) });
}

/** Run the self-check now (used by the Settings button and tests). */
export async function POST(_req: NextRequest): Promise<Response> {
  try {
    const report = await runSelfCheck();
    return Response.json({ report });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "self-check failed" }, { status: 500 });
  }
}
