import { NextRequest } from "next/server";
import { getDb, logActivity } from "@/lib/db";

export const runtime = "nodejs";

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB per file
const ALLOWED = /^(image\/(png|jpe?g|gif|webp)|application\/pdf|text\/(plain|csv|markdown)|application\/(json|vnd\.openxmlformats-officedocument\.(wordprocessingml|spreadsheetml)\.document))$/;

/** POST /api/attachments — store one attachment, return its id + metadata. */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "file field required" }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return Response.json({ error: "file too large (max 10 MB)" }, { status: 413 });
    }
    const mime = file.type || "application/octet-stream";
    if (!ALLOWED.test(mime)) {
      return Response.json({ error: `unsupported type: ${mime}` }, { status: 415 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const chatId = typeof form.get("chat_id") === "string" ? String(form.get("chat_id")) : null;
    const db = getDb();
    const r = db
      .prepare("INSERT INTO attachments (chat_id, name, mime, size, data) VALUES (?, ?, ?, ?, ?)")
      .run(chatId, file.name || "attachment", mime, buf.length, buf);
    logActivity("ATTACHMENT_UPLOADED", `${file.name} (${buf.length} bytes)`);
    return Response.json(
      { id: Number(r.lastInsertRowid), name: file.name, mime, size: buf.length },
      { status: 201 },
    );
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "upload failed" },
      { status: 500 },
    );
  }
}

/** GET /api/attachments?id=N — fetch raw bytes (for vision injection / preview). */
export async function GET(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return Response.json({ error: "id required" }, { status: 400 });
  }
  const row = getDb().prepare("SELECT name, mime, data FROM attachments WHERE id = ?").get(id) as
    | { name: string; mime: string; data: Buffer }
    | undefined;
  if (!row) return Response.json({ error: "not found" }, { status: 404 });
  return new Response(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.mime,
      "Content-Disposition": `inline; filename="${row.name.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
