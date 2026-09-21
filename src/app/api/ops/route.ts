import { NextRequest } from "next/server";
import { sendMorningBrief, composeBrief } from "@/lib/brief";
import { learnVoice, getVoice, collectPrincipalWriting } from "@/lib/voice";
import { saveProfile, getProfile } from "@/lib/profile";
import { logActivity } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * OPS ENDPOINT — principal-facing operations that don't need the agent loop:
 *   POST { op: "morning_brief" }         → compose + deliver the 08:00 brief now
 *   POST { op: "learn_voice" }           → distil the writing voice from his corpus
 *   POST { op: "save_profile", patch }   → merge fields into the company profile
 *   GET                                  → current voice + profile + corpus stats
 */
export async function GET(): Promise<Response> {
  const v = getVoice();
  const { samples, sources } = collectPrincipalWriting();
  return Response.json({
    profile: getProfile(),
    voice: v ? { learned_at: v.learned_at, samples_used: v.samples_used, profile: v.profile } : null,
    corpus: { samples: samples.length, sources },
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: { op?: string; patch?: Record<string, unknown>; force?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    switch (body.op) {
      case "morning_brief": {
        const dry = Boolean((body as { dry?: boolean }).dry);
        if (dry) {
          const brief = await composeBrief();
          return Response.json({ ok: true, dry: true, brief: brief.text });
        }
        const { delivered, brief } = await sendMorningBrief();
        return Response.json({ ok: true, delivered, brief: brief.text });
      }
      case "learn_voice": {
        const before = getVoice();
        const v = await learnVoice(Boolean(body.force));
        if (!v) {
          const { samples } = collectPrincipalWriting();
          return Response.json({ ok: false, reason: `not enough samples yet (${samples.length} found, need 3+). They accrue as he sends mail and you chat.` });
        }
        return Response.json({ ok: true, voice: v, previous: before?.learned_at ?? null });
      }
      case "save_profile": {
        if (!body.patch || typeof body.patch !== "object") return Response.json({ error: "patch required" }, { status: 400 });
        const next = saveProfile(body.patch, "principal-ops");
        logActivity("PROFILE_SAVED", Object.keys(body.patch).join(",").slice(0, 120));
        return Response.json({ ok: true, profile: next });
      }
      default:
        return Response.json({ error: "unknown op" }, { status: 400 });
    }
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "op failed" }, { status: 500 });
  }
}
