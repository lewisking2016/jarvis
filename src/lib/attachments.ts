import { getDb } from "./db";

/**
 * CHAT ATTACHMENTS — the principal attaches images or documents and directs
 * JARVIS to act on them ("read this invoice and log it", "what's wrong in
 * this screenshot"). Images become OpenAI vision content parts (models that
 * lack vision simply see the filename note); text-like documents are decoded
 * and inlined; PDFs contribute their name and size (deep extraction lands
 * with the parse tier). Every attachment leaves an audit trail in activity.
 */

export interface AttachmentPart {
  id: number;
  name: string;
  mime: string;
  size: number;
}

const TEXTUAL = /^(text\/|application\/json)/;

export function loadAttachments(ids: number[]): {
  parts: Record<string, unknown>[];
  note: string;
} {
  if (!ids.length) return { parts: [], note: "" };
  const db = getDb();
  const parts: Record<string, unknown>[] = [];
  const lines: string[] = [];
  for (const id of ids.slice(0, 6)) {
    const row = db.prepare("SELECT id, name, mime, size, data FROM attachments WHERE id = ?").get(id) as
      | { id: number; name: string; mime: string; size: number; data: Buffer }
      | undefined;
    if (!row) continue;
    if (row.mime.startsWith("image/")) {
      parts.push({
        type: "image_url",
        image_url: { url: `data:${row.mime};base64,${Buffer.from(row.data).toString("base64")}` },
      });
      lines.push(`[Image #${row.id}: ${row.name}] attached — read it and use what you see.`);
    } else if (TEXTUAL.test(row.mime)) {
      const text = Buffer.from(row.data).toString("utf8").slice(0, 6000);
      parts.push({ type: "text", text: `--- FILE: ${row.name} ---\n${text}\n--- END FILE ---` });
      lines.push(`[Document: ${row.name}] contents included above.`);
    } else {
      // PDF / docx — metadata tier until the deep-parse tier lands
      parts.push({
        type: "text",
        text: `--- FILE: ${row.name} (${row.mime}, ${Math.round(row.size / 1024)} KB) attached. Binary document: reason from the filename and the principal's instructions about it; say you cannot open its inner text if asked for specifics you cannot verify.`,
      });
      lines.push(`[Document: ${row.name}] attached (binary).`);
    }
  }
  const note = lines.length ? `\n\nATTACHMENTS: ${lines.join(" ")}` : "";
  return { parts, note };
}
