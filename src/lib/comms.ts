import { getDb, logActivity } from "./db";

/**
 * COMMUNICATIONS — WhatsApp (voice notes + texts), LinkedIn, follow-ups.
 *
 * WhatsApp has two transports, chosen automatically per send:
 *   · callmebot — zero-setup principal notifications (text only)
 *   · cloud     — WhatsApp Business Cloud API (Meta): text + VOICE NOTES both ways,
 *                 inbound webhook conversations with the principal (and later customers)
 * Voice notes render through the same neural TTS as the console (/api/voice engine).
 *
 * LinkedIn: no free official API, and automation violates ToS — DMs are DRAFTED and
 * approval-gated; actual sending happens through the browser tools when a logged-in
 * session exists on the host.
 */

export interface SendResult {
  ok: boolean;
  via: string;
  detail: string;
}

function cloudCreds(): { token: string; phoneId: string } | null {
  const token = (process.env.WHATSAPP_CLOUD_TOKEN ?? "").trim();
  const phoneId = (process.env.WHATSAPP_CLOUD_PHONE_ID ?? "").trim();
  return token && phoneId ? { token, phoneId } : null;
}

export function whatsappConfigured(): "cloud" | "callmebot" | null {
  if (cloudCreds()) return "cloud";
  if ((process.env.WHATSAPP_API_KEY ?? "").trim() && (process.env.WHATSAPP_PHONE ?? "").trim()) return "callmebot";
  return null;
}

/* ── Cloud API: text ─────────────────────────────────────────────────────── */

async function cloudSendText(to: string, text: string): Promise<SendResult> {
  const { token, phoneId } = cloudCreds()!;
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text.slice(0, 4000) },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const ok = res.ok;
    const body = ok ? "" : (await res.text()).slice(0, 160);
    logActivity(ok ? "WHATSAPP_SENT" : "WHATSAPP_FAILED", `cloud → ${to} — ${text.slice(0, 60)}`);
    return { ok, via: "cloud", detail: ok ? "sent" : body };
  } catch (err) {
    return { ok: false, via: "cloud", detail: err instanceof Error ? err.message : "network error" };
  }
}

/* ── Cloud API: voice note (OGG/Opus via the neural TTS engine) ──────────── */

/**
 * Send a WhatsApp VOICE NOTE: synthesize MP3 with the Edge neural voice, ship it to
 * the Cloud API media endpoint, then message it as an audio note. WhatsApp plays it
 * exactly like a normal voice note — JARVIS "speaking" on WhatsApp.
 */
export async function sendWhatsAppVoiceNote(to: string, text: string): Promise<SendResult> {
  const creds = cloudCreds();
  if (!creds) return { ok: false, via: "cloud", detail: "cloud API not configured" };
  const { token, phoneId } = creds;
  try {
    // 1. synthesize speech (same engine as /api/voice)
    const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");
    const tts = new MsEdgeTTS();
    await tts.setMetadata("en-GB-RyanNeural", OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(
      text.replace(/[&<>]/g, " ").slice(0, 2200),
      { rate: "-8%", pitch: "-4Hz" },
    );
    const chunks: Buffer[] = [];
    for await (const c of audioStream) chunks.push(c as Buffer);
    const mp3 = Buffer.concat(chunks);
    if (!mp3.length) return { ok: false, via: "cloud", detail: "empty TTS output" };

    // 2. upload media
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(mp3)], { type: "audio/mpeg" }), "jarvis.mp3");
    fd.append("messaging_product", "whatsapp");
    type UpRes = { id?: string; error?: { message?: string } };
    const up = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
      signal: AbortSignal.timeout(60_000),
    });
    const upJson = (await up.json()) as UpRes;
    if (!up.ok || !upJson.id) return { ok: false, via: "cloud", detail: `media upload: ${upJson.error?.message ?? up.status}` };

    // 3. send as audio message
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "audio",
        audio: { id: upJson.id },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const ok = res.ok;
    const body = ok ? "" : (await res.text()).slice(0, 160);
    logActivity(ok ? "WHATSAPP_VOICE_SENT" : "WHATSAPP_VOICE_FAILED", `cloud → ${to} — ${text.slice(0, 50)}`);
    return { ok, via: "cloud", detail: ok ? "voice note sent" : body };
  } catch (err) {
    return { ok: false, via: "cloud", detail: err instanceof Error ? err.message : "voice error" };
  }
}

/* ── Unified send: cloud preferred, callmebot fallback (text) ─────────────── */

export async function sendWhatsApp(to: string, text: string, opts: { voice?: boolean } = {}): Promise<SendResult> {
  const phone = to.replace(/\D/g, "");
  if (whatsappConfigured() === "cloud") {
    if (opts.voice) {
      const v = await sendWhatsAppVoiceNote(phone, text);
      if (v.ok) return v;
      // voice failed → fall through to text so the brief still lands
    }
    return cloudSendText(phone, text);
  }
  const key = (process.env.WHATSAPP_API_KEY ?? "").trim();
  const bound = (process.env.WHATSAPP_PHONE ?? "").replace(/\D/g, "");
  if (!key || !bound) {
    return {
      ok: false,
      via: "callmebot",
      detail:
        "WhatsApp not configured. Free setup (2 min): WhatsApp 'I allow callmebot to send me messages' to +34 644 51 95 23, then set WHATSAPP_PHONE and WHATSAPP_APIKEY in .env. For voice notes + two-way chat: set WHATSAPP_CLOUD_TOKEN and WHATSAPP_CLOUD_PHONE_ID.",
    };
  }
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text.slice(0, 900))}&apikey=${encodeURIComponent(key)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const ok = res.ok;
    logActivity(ok ? "WHATSAPP_SENT" : "WHATSAPP_FAILED", `${phone} — ${text.slice(0, 60)}`);
    return { ok, via: "callmebot", detail: ok ? "sent" : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, via: "callmebot", detail: err instanceof Error ? err.message : "network error" };
  }
}

/** The principal's number for proactive pings (briefs, alerts). */
export function principalWhatsApp(): string | null {
  return (process.env.WHATSAPP_PHONE ?? "").replace(/\D/g, "") || null;
}

/* ── Inbound webhook processing (Cloud API) ──────────────────────────────── */

export interface InboundWam {
  from: string;
  text: string;
  kind: "text" | "voice" | "other";
  mediaId?: string;
}

/** Extract the first usable message from a Cloud API webhook payload. */
export function parseWebhook(payload: unknown): InboundWam | null {
  interface WamMsg { from: string; type: string; text?: { body: string }; audio?: { id: string } }
  interface WamPayload { entry?: { changes?: { value?: { messages?: WamMsg[] } }[] }[] }
  const p = payload as WamPayload;
  const msgs: WamMsg[] | undefined = p.entry?.[0]?.changes?.[0]?.value?.messages;
  const m = msgs?.[0];
  if (!m) return null;
  if (m.type === "text" && m.text?.body) return { from: m.from, text: m.text.body, kind: "text" };
  if (m.type === "audio" && m.audio?.id) return { from: m.from, text: "", kind: "voice", mediaId: m.audio.id };
  return { from: m.from, text: "", kind: "other" };
}

/** Fetch + transcribe an inbound voice note (mp4/m4a → text via OpenAI-compatible STT if configured). */
export async function transcribeVoiceNote(mediaId: string): Promise<string | null> {
  const creds = cloudCreds();
  if (!creds) return null;
  try {
    // 1. get the download URL
    const meta = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${creds.token}` },
      signal: AbortSignal.timeout(15_000),
    });
    type MediaMeta = { url?: string };
    const { url } = (await meta.json()) as MediaMeta;
    if (!url) return null;
    // 2. download the audio
    const audio = Buffer.from(await (await fetch(url, { headers: { Authorization: `Bearer ${creds.token}` }, signal: AbortSignal.timeout(30_000) })).arrayBuffer());
    // 3. transcribe via Groq Whisper (free tier) when a key exists
    const sttKey = (process.env.GROQ_API_KEY ?? "").trim();
    if (!sttKey) return null;
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array(audio)], { type: "audio/mp4" }), "note.m4a");
    fd.append("model", "whisper-large-v3");
    const tr = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${sttKey}` },
      body: fd,
      signal: AbortSignal.timeout(45_000),
    });
    if (!tr.ok) return null;
    const j = (await tr.json()) as { text?: string };
    return j.text ?? null;
  } catch {
    return null;
  }
}

/* ── LinkedIn (unchanged: drafted + gated) ───────────────────────────────── */

/** LinkedIn DMs are drafted + gated; nothing is ever sent autonomously. */
export function createLinkedinDraft(company: string, contact: string | null, message: string): { approvalId: number } {
  const db = getDb();
  const r = db
    .prepare("INSERT INTO approvals (kind, summary, payload_json) VALUES ('linkedin_dm', ?, ?)")
    .run(
      `LinkedIn DM → ${company}${contact ? ` (${contact})` : ""}: ${message.slice(0, 140)}`,
      JSON.stringify({ company, contact, message })
    );
  logActivity("LINKEDIN_DRAFTED", `${company} — awaiting approval`);
  return { approvalId: Number(r.lastInsertRowid) };
}

/** A dated follow-up lands on the Command Deck task list and pings the scheduler. */
export function scheduleFollowup(about: string, due: string, channel = "email"): { taskId: number } {
  const db = getDb();
  const r = db
    .prepare("INSERT INTO tasks (title, due, priority, status) VALUES (?, ?, 'normal', 'open')")
    .run(`Follow up (${channel}): ${about.slice(0, 150)}`, due.slice(0, 10));
  logActivity("FOLLOWUP_SCHEDULED", `${channel} ${due.slice(0, 10)} — ${about.slice(0, 60)}`);
  return { taskId: Number(r.lastInsertRowid) };
}
