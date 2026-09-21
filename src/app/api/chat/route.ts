import { NextRequest } from "next/server";
import { runAgent, type ChatTurn } from "@/lib/agent";
import { loadAttachments } from "@/lib/attachments";
import { logActivity } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest): Promise<Response> {
  let body: { message?: string; history?: ChatTurn[]; attachment_ids?: number[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  if (!message && !(body.attachment_ids ?? []).length) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }
  const attachments = loadAttachments((body.attachment_ids ?? []).filter((n) => Number.isFinite(n)));
  const effectiveMessage = message || "Analyse the attached file(s) and tell me what you see, sir.";

  const history = (body.history ?? [])
    .filter((h) => h && (h.role === "user" || h.role === "model") && typeof h.text === "string")
    .slice(-30);
  // The current message MUST be the final user turn — the agent only sees this history.
  if (history.at(-1)?.role !== "user" || history.at(-1)?.text !== effectiveMessage) {
    history.push({ role: "user", text: effectiveMessage });
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown): void => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        logActivity("CHAT", effectiveMessage.slice(0, 160));
        const { text, provider } = await runAgent({
          history,
          attachmentParts: attachments.parts,
          signal: abort.signal,
          onEvent: (e) => send(e),
        });
        send({ type: "done", text, provider });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
