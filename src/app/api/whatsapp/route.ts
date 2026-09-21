import { NextRequest } from "next/server";
import { parseWebhook, transcribeVoiceNote, principalWhatsApp, sendWhatsApp, whatsappConfigured } from "@/lib/comms";
import { runAgent } from "@/lib/agent";
import { logActivity } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * WHATSAPP WEBHOOK — inbound messages (text AND voice notes) reach JARVIS here.
 * Meta calls GET (subscription verify) and POST (every message). Voice notes are
 * transcribed and answered like typed text — the principal talks, JARVIS answers
 * in chat (and can answer with a voice note).
 *
 * Meta setup (one-time): webhook URL https://jarvis.imeantech.com/api/whatsapp,
 * verify token = WHATSAPP_VERIFY_TOKEN in .env, subscribe to the messages field.
 */

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge") ?? "";
  const expected = (process.env.WHATSAPP_VERIFY_TOKEN ?? "").trim();
  if (mode === "subscribe" && expected && token === expected) {
    logActivity("WHATSAPP_WEBHOOK", "verified by Meta");
    return new Response(challenge, { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: NextRequest): Promise<Response> {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ ok: true }); // Meta retries on non-2xx; swallow junk
  }

  const msg = parseWebhook(payload);
  if (!msg) return Response.json({ ok: true });

  const principal = principalWhatsApp();
  const isPrincipal = principal ? msg.from.replace(/\D/g, "").endsWith(principal.slice(-9)) : false;

  try {
    let text = msg.text;

    if (msg.kind === "voice" && msg.mediaId) {
      const transcribed = await transcribeVoiceNote(msg.mediaId);
      if (!transcribed) {
        await sendWhatsApp(msg.from, "I received your voice note but couldn't transcribe it (no speech key configured yet, sir). Type it and I'm on it.");
        return Response.json({ ok: true });
      }
      text = transcribed;
      logActivity("WHATSAPP_VOICE_IN", `${msg.from}: ${transcribed.slice(0, 80)}`);
    }

    if (!text?.trim()) return Response.json({ ok: true });

    logActivity(isPrincipal ? "WHATSAPP_PRINCIPAL" : "WHATSAPP_INBOUND", `${msg.from}: ${text.slice(0, 100)}`);

    // JARVIS thinks with the full agent (tools, memory, profile) and replies in chat.
    // The principal gets full execution; customer senders get replies too (gates inside
    // the tools still protect anything outbound).
    const result = await runAgent({
      history: [{ role: "user", text: `[WhatsApp message from ${isPrincipal ? "the principal" : msg.from}] ${text}` }],
      onEvent: () => {},
    });

    await sendWhatsApp(msg.from, result.text || "On it, sir.");
    return Response.json({ ok: true });
  } catch (err) {
    logActivity("WHATSAPP_WEBHOOK_ERR", err instanceof Error ? err.message.slice(0, 120) : "unknown");
    return Response.json({ ok: true }); // never 500 — Meta would retry-storm
  }
}
