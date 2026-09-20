import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { renderDocumentPdf, type DocRow } from "@/lib/pdf";
import { logActivity } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const docId = Number(id);
  if (!Number.isFinite(docId)) return Response.json({ error: "bad id" }, { status: 400 });

  const row = getDb().prepare("SELECT * FROM documents WHERE id = ?").get(docId) as unknown as DocRow | undefined;
  if (!row) return Response.json({ error: "document not found" }, { status: 404 });

  try {
    const buffer = await renderDocumentPdf(row);
    logActivity("PDF_ISSUED", row.number);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${row.number}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "render failed" }, { status: 500 });
  }
}
