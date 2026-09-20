import { NextRequest } from "next/server";
import { pendingApprovals, resolveApproval } from "@/lib/approvals";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return Response.json({ pending: pendingApprovals() });
}

export async function POST(req: NextRequest): Promise<Response> {
  const b = (await req.json().catch(() => ({}))) as { id?: number; approve?: boolean; via?: string };
  if (typeof b.id !== "number") return Response.json({ error: "id required" }, { status: 400 });
  const ok = resolveApproval(b.id, Boolean(b.approve), b.via ?? "dashboard");
  return Response.json({ ok, remaining: pendingApprovals().length });
}
