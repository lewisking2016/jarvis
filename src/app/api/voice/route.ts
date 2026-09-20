import { NextRequest } from "next/server";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * JARVIS VOICE — free neural TTS via the Microsoft Edge Read Aloud service (no key, no quota).
 * Voice: en-GB-RyanNeural (deep British male) with butler prosody: slightly slower, slightly deeper.
 * The browser client POSTs { text } and streams back audio/mpeg.
 */

const VOICE = "en-GB-RyanNeural";
const PROSODY = { rate: "-8%", pitch: "-4Hz" } as const;

let tts: MsEdgeTTS | null = null;

async function engine(): Promise<MsEdgeTTS> {
  if (!tts) {
    tts = new MsEdgeTTS();
    await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  }
  return tts;
}

/** Strip markdown / symbols the voice shouldn't read aloud. */
function speakableText(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " Code block omitted. ")
    .replace(/[*_#`>~|]/g, " ")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1200); // keep spoken replies brisk
}

/** Only safe XML text may enter the SSML template. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const text = speakableText((body.text ?? "").trim());
  if (!text) return Response.json({ error: "text is required" }, { status: 400 });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const engine_ = await engine();
      const { audioStream } = engine_.toStream(escapeXml(text), PROSODY);
      const chunks: Buffer[] = [];
      for await (const c of audioStream) chunks.push(c as Buffer);
      if (!chunks.length) throw new Error("empty audio stream");
      const mp3 = Buffer.concat(chunks);
      return new Response(new Uint8Array(mp3), {
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Length": String(mp3.length),
          "Cache-Control": "no-store",
        },
      });
    } catch {
      // connection went stale — rebuild it once and retry
      try {
        tts?.close();
      } catch {
        /* ignore */
      }
      tts = null;
      if (attempt === 1) break;
    }
  }
  return Response.json({ error: "voice engine unavailable" }, { status: 503 });
}
