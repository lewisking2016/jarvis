import { getDb, logActivity } from "./db";
import { remember } from "./memory";
import { rankedChain, candidateKey, breakerOpen } from "./llm";

/**
 * WRITING VOICE — JARVIS learns to write like the principal (starts TODAY).
 *
 * Pipeline (nightly 03:30, and on demand):
 *   1. COLLECT — the principal's own writing: bodies of sent emails (stored in
 *      activity logs), notes he wrote, document cover lines he dictated. His own
 *      chat messages count too — how he actually talks is the ground truth.
 *   2. DISTIL — one brain call condenses the corpus into a compact STYLE PROFILE:
 *      greeting habits, sign-offs, sentence length, Sheng/swahili mixing, tone,
 *      phrases to use and avoid. Stored in app_state as writing_voice.
 *   3. INJECT — the style profile rides inside buildSystemPrompt() so every email,
 *      quote cover note, DM and brief JARVIS writes sounds like the principal.
 *
 * Human-written samples always override the learned voice (doctrine), and every
 * distillation keeps the previous version so the voice can be reverted.
 */

export interface WritingVoice {
  learned_at: string;
  samples_used: number;
  profile: string; // the compact style profile text
}

const STATE_KEY = "writing_voice";
const MIN_SAMPLES = 3;

/** Gather the principal's writing corpus from everything stored in the DB. */
export function collectPrincipalWriting(maxChars = 9000): { samples: string[]; sources: string[] } {
  const db = getDb();
  const samples: string[] = [];
  const sources: string[] = [];

  // 1. sent emails (email sends log the subject + body excerpt)
  try {
    const acts = db
      .prepare("SELECT detail FROM activity WHERE action IN ('EMAIL_SENT','OUTREACH_SENT') ORDER BY id DESC LIMIT 80")
      .all() as { detail: string }[];
    for (const a of acts) {
      const body = a.detail;
      if (body && body.length > 40) {
        samples.push(body.slice(0, 1200));
        sources.push("email");
      }
    }
  } catch { /* table shape may vary */ }

  // 2. notes the principal wrote
  try {
    const notes = db.prepare("SELECT body FROM notes WHERE author LIKE '%lewis%' OR author LIKE '%principal%' ORDER BY id DESC LIMIT 40").all() as { body: string }[];
    for (const n of notes) if (n.body && n.body.length > 40) { samples.push(n.body.slice(0, 800)); sources.push("note"); }
  } catch { /* try alternate column */ }

  // 3. the principal's chat directives (how he actually talks)
  try {
    const acts = db
      .prepare("SELECT detail FROM activity WHERE action = 'CHAT_DIRECTIVE' ORDER BY id DESC LIMIT 60")
      .all() as { detail: string }[];
    for (const a of acts) if (a.detail && a.detail.length > 15) { samples.push(a.detail.slice(0, 300)); sources.push("chat"); }
  } catch { /* optional */ }

  // cap total size
  let total = 0;
  const kept: string[] = [];
  for (const s of samples) {
    if (total + s.length > maxChars) break;
    kept.push(s);
    total += s.length;
  }
  return { samples: kept, sources: [...new Set(sources)] };
}

/**
 * Distil the corpus into a compact style profile with one brain call.
 * Returns null when there isn't enough material yet.
 */
export async function learnVoice(force = false): Promise<WritingVoice | null> {
  const db = getDb();
  const { samples, sources } = collectPrincipalWriting();
  if (samples.length < MIN_SAMPLES && !force) {
    logActivity("VOICE_SKIPPED", `only ${samples.length} samples — need ${MIN_SAMPLES}`);
    return null;
  }

  const stylePrompt = `You are a writing-style analyst. Below are writing samples from ONE person (a Kenyan tech-business owner). Produce a compact STYLE PROFILE (max 180 words) so a copywriter can imitate this person exactly. Cover: greetings/openers, sign-offs, sentence length and rhythm, formality level, Swahili/Sheng mixing (with examples), punctuation habits, words/phrases they use often, words they never use, tone with clients vs tone with staff. Output ONLY the profile text, no preamble.

SAMPLES:
${samples.map((s, i) => `[${i + 1}] ${s}`).join("\n\n")}`;

  // one brain call through the same pool the agent uses
  const { chain } = await rankedChain();
  let text = "";
  for (const c of chain) {
    if (breakerOpen(candidateKey(c))) continue;
    const baseUrl = c.provider?.baseUrlEnv ? (process.env[c.provider.baseUrlEnv] ?? c.provider.baseUrl) : (c.provider?.baseUrl ?? "https://openrouter.ai/api/v1");
    const apiKey = c.provider ? (process.env[c.provider.keyEnv] ?? "") : (process.env.OPENROUTER_API_KEY ?? "");
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: c.id,
          messages: [{ role: "user", content: stylePrompt }],
          temperature: 0.2,
          max_tokens: 400,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) continue;
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const out = j.choices?.[0]?.message?.content?.trim() ?? "";
      if (out.length > 80) { text = out; break; }
    } catch { /* next brain */ }
  }
  if (!text) return null;

  const voice: WritingVoice = {
    learned_at: new Date().toISOString(),
    samples_used: samples.length,
    profile: text.slice(0, 1500),
  };
  // keep the previous voice for revert
  const prev = db.prepare("SELECT value FROM app_state WHERE key = ?").get(STATE_KEY) as { value: string } | undefined;
  if (prev) db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('writing_voice_prev', ?)").run(prev.value);

  db.prepare("INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(STATE_KEY, JSON.stringify(voice));
  logActivity("VOICE_LEARNED", `${samples.length} samples (${sources.join(",")}) — profile updated`);
  void remember({ kind: "event", content: `Learned the principal's writing voice from ${samples.length} samples (${sources.join(",")}).`, importance: 2, source: "voice" });
  return voice;
}

export function getVoice(): WritingVoice | null {
  try {
    const row = getDb().prepare("SELECT value FROM app_state WHERE key = ?").get(STATE_KEY) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as WritingVoice) : null;
  } catch {
    return null;
  }
}

/** The block injected into the system prompt — empty until the voice is learned. */
export function voiceHeader(): string {
  const v = getVoice();
  if (!v) return "";
  return `\nWRITING VOICE (learned from the principal's own emails/notes — when you draft ANY text meant to be sent or read aloud, imitate this style; his own words in a directive always override it):\n${v.profile}\n`;
}
