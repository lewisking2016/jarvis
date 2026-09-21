import { GoogleGenAI } from "@google/genai";
import { BUILT_IN_TOOLS } from "./tools";
import { SKILL_TOOLS } from "./skills";
import { discoverMcpTools, type McpTool } from "./mcp";
import { buildSystemPrompt } from "./system";
import { memoryHeader, remember } from "./memory";
import { processDue } from "./outreach";
import { runDistiller } from "./distiller";
import { logActivity } from "./db";
import {
  rankedChain,
  tripBreaker,
  breakerCooldownFor,
  candidateKey,
  configuredProviders,
  isOpenRouterConfigured,
  shouldFailover,
  shouldFailoverOnStreamError,
  OPENROUTER_BASE,
  type PoolCandidate,
} from "./llm";
import type { AgentEvent, ToolDef } from "./types";

export interface ChatTurn {
  role: "user" | "model";
  text: string;
}

/**
 * TOKEN BUDGET — history is the silent cost driver: every turn re-sends the whole
 * conversation to the brain. Cap it by characters (~4 chars/token): keep the most
 * recent turns within budget, give the newest message extra room, and drop older
 * turns entirely once the budget is spent. JARVIS is a manager, not an archivist —
 * verbatim old turns add nothing the memory core doesn't already persist.
 */
const HISTORY_CHAR_BUDGET = Number(process.env.JARVIS_HISTORY_BUDGET ?? 6000);

export function budgetHistory(history: ChatTurn[]): ChatTurn[] {
  if (history.length <= 1) return history;
  const out: ChatTurn[] = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const turn = history[i];
    const cap = i === history.length - 1 ? 4000 : 1200; // the live directive gets the most room
    const text = turn.text.length > cap ? turn.text.slice(0, cap) : turn.text;
    if (out.length > 0 && used + text.length > HISTORY_CHAR_BUDGET) break;
    used += text.length;
    out.unshift({ ...turn, text });
  }
  return out;
}

interface RunOpts {
  history: ChatTurn[];
  onEvent: (e: AgentEvent) => void;
  signal?: AbortSignal;
  /** Vision/file content parts for the current user turn (images, documents). */
  attachmentParts?: Record<string, unknown>[];
}

let cachedMcpTools: McpTool[] | null = null;

export async function allTools(): Promise<{ builtin: ToolDef[]; mcp: McpTool[] }> {
  const builtin = [...BUILT_IN_TOOLS, ...SKILL_TOOLS];
  if (!cachedMcpTools) {
    const { tools } = await discoverMcpTools();
    cachedMcpTools = tools;
  }
  return { builtin, mcp: cachedMcpTools };
}

export function resetMcpCache(): void {
  cachedMcpTools = null;
}

function geminiSchema(params: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(params)) as Record<string, unknown>;
  const walk = (node: unknown): void => {
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      for (const k of Object.keys(obj)) {
        if (k === "description" && typeof obj[k] !== "string") delete obj[k];
        if (k === "enum" && Array.isArray(obj[k])) obj[k] = obj[k].map(String);
        if (k !== "enum" && !["type", "description", "properties", "items", "required", "enum"].includes(k)) delete obj[k];
      }
      if (obj.properties) for (const v of Object.values(obj.properties as object)) walk(v);
      if (obj.items) walk(obj.items);
    }
  };
  walk(clone);
  return clone;
}

async function runGemini(opts: RunOpts, builtin: ToolDef[], mcp: McpTool[]): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set in .env");
  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.JARVIS_MODEL || "gemini-2.5-flash";
  const systemPrompt = `${buildSystemPrompt()}\n\n${memoryHeader(opts.history.at(-1)?.text)}`;

  const all = [...builtin, ...mcp];
  const declarations = all.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: geminiSchema(t.parameters),
  }));

  const contents: { role: string; parts: Record<string, unknown>[] }[] = [
    ...budgetHistory(opts.history).map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
  ];
  let finalText = "";

  for (let step = 0; step < 10; step++) {
    const res = await ai.models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction: systemPrompt,
        tools: declarations.length ? [{ functionDeclarations: declarations }] : undefined,
        abortSignal: opts.signal,
      },
    });

    let fnCalls: { name: string; args: Record<string, unknown> }[] = [];
    for await (const chunk of res) {
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const p of parts) {
        if (p.text) {
          finalText += p.text;
          opts.onEvent({ type: "text", delta: p.text });
        }
        if (p.functionCall) fnCalls.push({ name: p.functionCall.name!, args: p.functionCall.args ?? {} });
      }
    }

    if (!fnCalls.length) break;

    contents.push({ role: "model", parts: fnCalls.map((f) => ({ functionCall: { name: f.name, args: f.args } })) });
    const responses: Record<string, unknown>[] = [];
    for (const call of fnCalls) {
      const tool = all.find((t) => t.name === call.name);
      opts.onEvent({ type: "tool_start", name: call.name, args: call.args });
      if (!tool) {
        responses.push({ functionResponse: { name: call.name, response: { error: "Unknown tool" } } });
        opts.onEvent({ type: "tool_end", name: call.name, ok: false, summary: "Unknown tool" });
        continue;
      }
      try {
        const out = await tool.handler(call.args);
        const summary =
          typeof out === "object" && out !== null && "ok" in (out as Record<string, unknown>)
            ? "done"
            : "completed";
        responses.push({ functionResponse: { name: call.name, response: out as object } });
        opts.onEvent({ type: "tool_end", name: call.name, ok: true, summary });
        logActivity(`TOOL:${call.name}`, JSON.stringify(call.args).slice(0, 200));
      } catch (err) {
        responses.push({
          functionResponse: { name: call.name, response: { error: err instanceof Error ? err.message : String(err) } },
        });
        opts.onEvent({ type: "tool_end", name: call.name, ok: false, summary: err instanceof Error ? err.message : "failed" });
      }
    }
    contents.push({ role: "user", parts: responses.map((r) => ({ functionResponse: r.functionResponse! })) });
  }

  if (!finalText.trim()) throw new Error("Gemini returned an empty response");
  return finalText;
}

/** A provider rejected the request before/while streaming. */
class ProviderError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`Provider error ${status}: ${body.slice(0, 240)}`);
    this.status = status;
    this.body = body;
  }
}

/** Detects "I will record that…" narration with no matching action. */
const NARRATION_RE =
  /\b(i will|i'll|i am going to|let me|allow me|i shall|i can)\b[^.!?\n]{0,90}\b(record|create|add|file|schedule|queue|quote|invoice|note|task|search|research|pull|check|compute|calculate|draft|send|log|remember|brief|look up|find out)\b/i;

const CORRECTIVE_NUDGE =
  "You described an action but took none. Execute the directive NOW with your tools — call them one by one until every part is done. Only if genuinely no tool applies, state that plainly in one line.";

/** Imperative action verbs a directive can be held to. */
const ACTION_VERBS = /\b(add|record|create|log|schedule|send|quote|invoice|issue|update|complete|delete|draft|queue)\b/gi;

/** Verbs the directive demands that no executed tool name covers. */
function unexecutedActions(directive: string, executedTools: string[]): string[] {
  const executed = executedTools.join(" ").toLowerCase();
  const missing = new Set<string>();
  for (const m of directive.matchAll(ACTION_VERBS)) {
    if (!executed.includes(m[1].toLowerCase())) missing.add(m[1].toLowerCase());
  }
  return [...missing];
}

/**
 * One attempt against one OpenAI-compatible model (streaming, tool calling).
 * Rounds: stream → execute tools → model summarizes → … (max 8 rounds).
 * If the model narrates an action without executing, one corrective round forces execution.
 */
async function streamOpenAIOnce(
  opts: RunOpts,
  model: string,
  baseUrl: string,
  apiKey: string,
  builtin: ToolDef[],
  mcp: McpTool[],
  onEvent?: (e: AgentEvent) => void
): Promise<string> {
  const emit = onEvent ?? opts.onEvent;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const all = [...builtin, ...mcp];
  const oaiTools = all.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

    const historyTurns = budgetHistory(opts.history).map((h) => ({ role: h.role === "model" ? "assistant" : "user", content: h.text as string | Record<string, unknown>[] }));
  // Attachments ride on the FINAL user turn as multimodal content parts (vision + file text).
  if (opts.attachmentParts?.length && historyTurns.length && historyTurns[historyTurns.length - 1].role === "user") {
    const last = historyTurns[historyTurns.length - 1];
    last.content = [{ type: "text", text: String(last.content) }, ...opts.attachmentParts];
  }
  const messages: Record<string, unknown>[] = [
    { role: "system", content: `${buildSystemPrompt()}\n\n${memoryHeader(opts.history.at(-1)?.text)}` },
    ...historyTurns,
  ];

  /** Streams one round; returns this round's text and any tool calls. */
  const streamRound = async (): Promise<{ roundText: string; toolCalls: { id: string; name: string; args: string }[] }> => {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages,
        tools: oaiTools.length ? oaiTools : undefined,
        stream: true,
        temperature: 0.2, // precision over creativity — directives need exact args
      }),
      // A hanging brain must never stall a turn — 90s cap per attempt, plus the user's abort.
      signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
    });
    if (!res.ok || !res.body) throw new ProviderError(res.status, await res.text().catch(() => ""));

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let roundText = "";
    const toolCalls: { id: string; name: string; args: string }[] = [];

    // First-token watchdog: a brain that opens a stream but stalls (SSE pings only,
    // no actual data) must fail fast (20s) so the walk continues — a hung turn is
    // worse than a quick failover.
    const dataDeadline = Date.now() + 20_000;
    let gotData = false;
    let chunk: Awaited<ReturnType<typeof reader.read>>;
    for (;;) {
      if (!gotData && Date.now() > dataDeadline) {
        await reader.cancel().catch(() => {});
        throw new Error("no stream data within 20s (ping-stall)");
      }
      chunk = !gotData
        ? await Promise.race([
            reader.read(),
            new Promise<Awaited<ReturnType<typeof reader.read>>>((r) => setTimeout(() => r({ done: false, value: new Uint8Array() }), 5_000)),
          ])
        : await reader.read();
      const { done, value } = chunk;
      if (done) break;
      if (value && value.length === 0) continue; // watchdog tick — loop re-checks the deadline
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const j = JSON.parse(data) as {
            choices?: {
              delta?: {
                content?: string | null;
                tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
              };
            }[];
          };
          gotData = true; // real payload received — stop deadline enforcement
          const d = j.choices?.[0]?.delta;
          if (d?.content) {
            roundText += d.content;
            emit({ type: "text", delta: d.content });
          }
          for (const tc of d?.tool_calls ?? []) {
            const idx = typeof tc.index === "number" ? tc.index : 0; // some providers omit index
            const slot = toolCalls[idx] ?? (toolCalls[idx] = { id: tc.id ?? `call_${idx}`, name: "", args: "" });
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.name += tc.function.name;
            if (tc.function?.arguments) slot.args += tc.function.arguments;
          }
        } catch {
          /* skip malformed chunk */
        }
      }
      // NB: no extra read here — the for(;;) loop head reads next. A second read
      // in the body discarded every OTHER SSE chunk (missing mid-word fragments,
      // shuffled joins) and made healthy models look scrambled.
    }
    return { roundText, toolCalls };
  };

  let finalText = "";
  let correctiveUsed = false;
  let completenessUsed = false;
  const executedToolNames: string[] = [];
  const toolResults: { name: string; summary: string; raw: unknown; args: Record<string, unknown> }[] = [];

  for (let round = 0; round < 8; round++) {
    let roundRes: { roundText: string; toolCalls: { id: string; name: string; args: string }[] };
    try {
      roundRes = await streamRound();
    } catch (err) {
      // A model that stalls AFTER tools executed must not kill the turn — finalize
      // from the real tool results instead (graceful degradation, no duplicates).
      if (round === 0 || opts.signal?.aborted || toolResults.length === 0) throw err;
      logActivity("AGENT_FALLBACK_SUMMARY", `${model} stalled after tools — finalizing from results`);
      finalText += "\n" + toolResults.map((t) => `${t.name}: ${t.summary}`).join(" | ");
      break;
    }
    const { roundText, toolCalls } = roundRes;
    finalText += roundText;

    if (toolCalls.length) {
      executedToolNames.push(...toolCalls.map((t) => t.name));
      messages.push({
        role: "assistant",
        content: roundText || null,
        tool_calls: toolCalls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: t.args || "{}" } })),
      });
      for (const call of toolCalls) {
        const tool = all.find((t) => t.name === call.name);
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(call.args || "{}") as Record<string, unknown>;
        } catch {
          parsedArgs = {};
        }
        emit({ type: "tool_start", name: call.name, args: parsedArgs });
        let result: unknown;
        try {
          result = tool ? await tool.handler(parsedArgs) : { error: "Unknown tool" };
          emit({ type: "tool_end", name: call.name, ok: true, summary: "done" });
          if (tool) logActivity(`TOOL:${call.name}`, JSON.stringify(parsedArgs).slice(0, 200));
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err) };
          emit({ type: "tool_end", name: call.name, ok: false, summary: err instanceof Error ? err.message : "failed" });
        }
        toolResults.push({
          name: call.name,
          summary: JSON.stringify(result).replace(/[{}"\\\[\]]/g, "").slice(0, 140),
          raw: result,
          args: parsedArgs,
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 1500) });
      }
      // After two tool rounds, hold the model to directive actions it still has not executed
      // (e.g. compulsive reads while the directed writes never happen).
      if (!completenessUsed && round >= 2) {
        const lastUser = [...opts.history].reverse().find((h) => h.role === "user")?.text ?? "";
        const missing = unexecutedActions(lastUser, executedToolNames);
        if (missing.length > 0) {
          completenessUsed = true;
          logActivity("AGENT_NUDGE", `unexecuted: ${missing.join(",")}`.slice(0, 160));
          messages.push({
            role: "user",
            content: `You did not execute these directive actions: ${missing.join(", ")}. Execute them NOW with the matching tools (add → add_lead, record → record_expense, create → create_document). Use ONLY the exact details from the directive. Then confirm each result in one line.`,
          });
        }
      }
      continue; // next round: the model summarizes tool results (or chains more calls)
    }

    // No tool calls — hold JARVIS to every ACTION the directive contained.
    if (!completenessUsed) {
      const lastUser = [...opts.history].reverse().find((h) => h.role === "user")?.text ?? "";
      const missing = unexecutedActions(lastUser, executedToolNames);
      if (missing.length > 0) {
        completenessUsed = true;
        logActivity("AGENT_NUDGE", `unexecuted: ${missing.join(",")} — ${roundText.slice(0, 60)}`.slice(0, 160));
        messages.push({ role: "assistant", content: roundText || null });
        messages.push({
          role: "user",
          content: `You did not execute these directive actions: ${missing.join(", ")}. Execute them NOW with the matching tools (add → add_lead, record → record_expense, create → create_document). Use ONLY the exact details from the directive. Then confirm each result in one line. Only state plainly (one line) if genuinely no tool applies.`,
        });
        continue;
      }
    }

    // No tool calls — if the model promised action ("I will create…") or FABRICATED a
    // completed result ("QTE-2026-0003 created"), force real execution once before
    // the pool gives up on this brain.
    if (!correctiveUsed && roundText.trim() && (NARRATION_RE.test(roundText) || FABRICATION_RE.test(roundText))) {
      correctiveUsed = true;
      logActivity("AGENT_NUDGE", roundText.slice(0, 120));
      messages.push({ role: "assistant", content: roundText });
      messages.push({ role: "user", content: CORRECTIVE_NUDGE });
      continue;
    }
    // A round with no text and no tool calls is a dead stream — round 0: walk to the
    // next model; later rounds: end the turn (tools already ran — restarting would dup them).
    if (!roundText.trim() && toolCalls.length === 0) {
      if (round === 0) throw new Error("empty stream from model");
      break;
    }
    break;
  }

  if (!finalText.trim()) throw new Error("stream ended with no output");
  // A model that writes "tool_call: …" as TEXT instead of emitting real tool calls
  // is useless for directives — fail it so the pool walks to a brain that streams tools.
  if (executedToolNames.length === 0 && /\btool_call\b/i.test(finalText)) {
    throw new Error("model emitted tool calls as text — no streaming tool support");
  }

  // NARRATION RESCUE (structural, not pattern-based) — for ACTION tools (documents,
  // payments, leads, outreach) the confirmation must quote a REAL result identifier
  // (document number, amount, receipt) with zero garble. Free models scramble tokens
  // in endlessly novel ways ("Recorded for Ac KES 9 (ref432)"), so prose-pattern
  // detection lost the arms race; the tool results themselves are the truth and they
  // narrate perfectly every time. Pure answers and non-action turns are untouched.
  const ACTION_TOOL_SET = new Set(["create_document", "add_lead", "record_payment", "create_expense", "schedule_outreach", "send_email", "create_approval", "score_lead", "update_profile"]);
  const actionResults = toolResults.filter((t) => ACTION_TOOL_SET.has(t.name));
  if (actionResults.length > 0) {
    const ids: string[] = [];
    for (const t of actionResults) {
      const r = (t.raw ?? {}) as Record<string, unknown>;
      for (const k of ["number", "receipt_number", "reconciled"]) if (typeof r[k] === "string" && r[k]) ids.push(r[k]);
      const money = typeof r.total === "number" ? r.total : typeof r.amount === "number" ? r.amount : null;
      if (money !== null) ids.push(String(money), money.toLocaleString("en-US"));
    }
    const jsonEcho = /:\s*ok:(true|false)|\{"\s*ok|number:\s*[A-Z]{3}-/.test(finalText);
    const verbatimClean = garbleScore(finalText) === 0 && !jsonEcho && ids.some((d) => finalText.includes(d));
    if (!verbatimClean) {
      const clean =
        "Done, sir.\n" +
        toolResults.map((t) => `· ${prettyToolLine(t.name, t.raw, t.args)}`).join("\n");
      emit({ type: "reset" });
      emit({ type: "text", delta: clean });
      finalText = clean;
    }
  }
  return finalText;
}

/**
 * Walks the ranked free-model chain across ALL configured providers. Every failure trips
 * the failed model's breaker and hands the turn to the next brain — the conversation never dies.
 */
/**
 * QUALITY GATE — some free "reasoning" models leak interleaved thinking tokens
 * into content, producing garbled narration ("Ochien2 × 10 cameras + 1000
 * installation41") or empty replies while claiming success. When an attempt
 * produced NO tool executions and the text fails the garble heuristics, treat
 * it as a brain failure and walk the chain. Attempts WITH tool work always
 * pass — actions are real even when narration is rough, and retrying would
 * duplicate them.
 */
function garbleScore(text: string): number {
  if (!text) return 0;
  const fusedDigits = (text.match(/[a-z]{3,}\d/gi) ?? []).length; // letters fused to digits mid-word ("Ochien2", "installation41")
  const fusedWords = (text.match(/[a-z]{4,}[A-Z][a-z]{3,}/g) ?? []).length; // words smashed together ("dueCreated")
  const total = fusedDigits + fusedWords;
  return total >= 3 ? 2 : fusedDigits >= 2 ? 1 : 0;
}

/** Raw scramble-signal count — used to fail NO-TOOL attempts (conversational turns
 *  have nothing to rescue from, so a scrambled reply must simply fail over). */
function garbleSignals(text: string): number {
  if (!text) return 0;
  return (text.match(/[a-z]{3,}\d/gi) ?? []).length + (text.match(/[a-z]{4,}[A-Z][a-z]{3,}/g) ?? []).length;
}

/** Claims a COMPLETED action or document number with no tool behind it — fabricated
 *  results ("QTE-2026-0003 created…", "Done, sir, invoice issued"). Narrow on purpose:
 *  ordinary answers that merely mention past events must not trip it. */
const FABRICATION_RE =
  /\b(?:QTE|QUO|INV|RCP|RCPT)-?\s?\d{2,}|\bI\s+(?:created|recorded|issued|saved|sent|scheduled)\b|^\s*(?:done|created|recorded|issued|saved)\b[,:—-]/i;

/**
 * Human one-liner from a REAL tool result. Reads only fields the tool actually
 * returned — never invents. Unknown tools fall back to name + compact summary.
 */
function prettyToolLine(name: string, raw: unknown, args: Record<string, unknown> = {}): string {
  const r = (raw ?? {}) as Record<string, unknown>;
  const s = (k: string): string => (typeof r[k] === "string" || typeof r[k] === "number" ? String(r[k]) : "");
  switch (name) {
    case "create_document": {
      const kindRaw = s("kind") || "Document";
      const kind = kindRaw.charAt(0) + kindRaw.slice(1).toLowerCase();
      const num = s("number");
      const client = s("client") || (typeof args.client === "string" ? args.client : "");
      const total = s("total");
      const due = s("due_date") || (typeof args.due_date === "string" ? args.due_date : "");
      return `${kind} ${num} created for ${client || "the client"} — KES ${Number(total).toLocaleString("en-US")}${due ? `, due ${due}` : ""}`;
    }
    case "add_lead": {
      const who = s("company") || s("contact") || s("name") || "Lead";
      const email = s("email");
      return `Lead saved: ${who}${email ? ` (${email})` : ""}`;
    }
    case "update_profile": {
      // Render the patch's leaf assignments: "payment.till → 999555".
      const leaves: string[] = [];
      const walk = (obj: Record<string, unknown>, prefix: string): void => {
        for (const [k, v] of Object.entries(obj ?? {})) {
          if (v && typeof v === "object" && !Array.isArray(v)) walk(v as Record<string, unknown>, prefix ? `${prefix}.${k}` : k);
          else leaves.push(`${prefix ? `${prefix}.` : ""}${k.replace(/_/g, " ")} → ${String(v)}`);
        }
      };
      walk((args.patch ?? {}) as Record<string, unknown>, "");
      return `Profile updated${leaves.length ? `: ${leaves.slice(0, 4).join(", ")}` : ""} — on record permanently`;
    }
    case "record_payment": {
      // The result payload doesn't echo the amount — take it from the call args.
      const argAmt = typeof args.amount === "number" ? args.amount : null;
      const amount = typeof r.amount === "number" ? r.amount : argAmt;
      const dup = r.duplicate_suppressed === true;
      const tail = s("receipt")
        ? ` — receipt ${s("receipt")} issued`
        : s("reconciled")
          ? ` — reconciled to ${s("reconciled")}`
          : s("needs_confirmation")
            ? ` — awaiting your approval to reconcile with ${s("needs_confirmation")}`
            : r.unmatched_task
              ? " — unmatched; an identify-payment task is open"
              : "";
      return `Payment ${dup ? "already recorded — not duplicated" : "recorded"}${amount !== null ? `: KES ${amount.toLocaleString("en-US")}` : ""}${tail}`;
    }
    default: {
      const summary = JSON.stringify(raw ?? {}).replace(/[{}"\\\[\]]/g, "").slice(0, 120);
      return `${name}: ${summary || "done"}`;
    }
  }
}

async function runOpenAIPool(
  opts: RunOpts,
  builtin: ToolDef[],
  mcp: McpTool[],
  onFailover: (from: string, to: string, reason: string) => void
): Promise<{ text: string; provider: string }> {
  const { chain } = await rankedChain({ preferVision: Boolean(opts.attachmentParts?.length) });
  const openRouterKey = process.env.OPENROUTER_API_KEY ?? process.env.JARVIS_API_KEY ?? "";
  const skipProvider = new Set<string>(); // account-level daily caps skip the rest of a provider
  const label = (c: PoolCandidate): string => (c.provider ? `${c.provider.id}:${c.id}` : c.id);
  let lastErr: unknown = new Error("model chain is empty");

  for (let i = 0; i < chain.length; i++) {
    const cand = chain[i];
    if (cand.provider && skipProvider.has(cand.provider.id)) continue;
    const model = cand.id;
    const baseUrl = cand.provider?.baseUrlEnv
      ? (process.env[cand.provider.baseUrlEnv] ?? cand.provider.baseUrl)
      : (cand.provider?.baseUrl ?? OPENROUTER_BASE);
    const apiKey = cand.provider ? (process.env[cand.provider.keyEnv] ?? "") : openRouterKey;
    // Track whether the attempt emitted anything — a retry is only safe when the
    // attempt produced zero text and zero tool executions (otherwise duplicates).
    let emittedText = 0;
    let toolEvents = 0;
    const countingOnEvent = (e: Parameters<typeof opts.onEvent>[0]): void => {
      if (e.type === "text") emittedText += e.delta.length;
      if (e.type === "tool_start") toolEvents++;
      opts.onEvent(e);
    };
    try {
      const text = await streamOpenAIOnce(opts, model, baseUrl, apiKey, builtin, mcp, countingOnEvent);
      // Quality gate: with NO tool work, an attempt fails if the narration is empty,
      // garbled, or CLAIMS an action/document that was never executed (doctrine:
      // a promise without a tool call is a failure — treat the brain as broken).
      const claimsAction = FABRICATION_RE.test(text);
      // NO-TOOL attempts (conversation, analysis) have nothing to rescue from and
      // nothing to duplicate — so ANY scramble signal fails the brain and the walk
      // tries the next one. A false positive costs one hop; a scrambled reply costs
      // the principal's trust.
      if (toolEvents === 0 && (text.trim().length === 0 || garbleSignals(text) >= 1 || claimsAction)) {
        tripBreaker(candidateKey(cand));
        opts.onEvent({ type: "reset" }); // wipe the garbled partial text from the console
        const next = chain[i + 1];
        if (!next) throw new Error(`brain produced garbled output: ${text.slice(0, 80) || "(empty)"}`);
        const why = text.trim().length === 0 ? "empty reply, no tool work" : garbleSignals(text) >= 1 ? "scrambled narration, no tool work" : "claimed an action it never executed";
        lastErr = new Error(why);
        onFailover(label(cand), label(next), why);
        continue;
      }
      return { text, provider: label(cand) };
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      lastErr = err;
      const recoverable =
        err instanceof ProviderError ? shouldFailover(err.status, err.body) : shouldFailoverOnStreamError(err);
      if (!recoverable) throw err;
      // Account-level daily cap: skip the rest of this provider for the rest of the turn.
      if (err instanceof ProviderError && err.body.includes("free-models-per-day")) {
        skipProvider.add(cand.provider?.id ?? "openrouter");
      }
      // Instant stream deaths are often transient — retry the same model once if it
      // emitted nothing (no duplicate text, no duplicate tool executions).
      if (!(err instanceof ProviderError) && emittedText === 0 && toolEvents === 0) {
        try {
          const text = await streamOpenAIOnce(opts, model, baseUrl, apiKey, builtin, mcp, countingOnEvent);
          return { text, provider: label(cand) };
        } catch (retryErr) {
          if (opts.signal?.aborted) throw retryErr;
          lastErr = retryErr;
        }
      }
      tripBreaker(
        candidateKey(cand),
        err instanceof ProviderError ? breakerCooldownFor(err.status, err.body) : undefined
      );
      const next = chain[i + 1];
      if (!next) break;
      const reason = err instanceof Error ? err.message.slice(0, 120) : "provider failure";
      onFailover(label(cand), label(next), reason);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

let schedulerStarted = false;
export function ensureScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  // Nightly self-check at 03:00 (brains, MCP servers, SMTP mailboxes)
  import("./selfcheck").then((m) => m.ensureSelfCheckScheduler()).catch(() => {});
  setInterval(() => {
    try {
      const { sent, gated } = processDue(25);
      if (sent > 0 || gated > 0) {
        logActivity("SCHEDULER_TICK", `${sent} sent, ${gated} gated`);
        remember({ kind: "event", content: `Scheduler processed ${sent} outreach touches (${gated} gated).`, importance: 1, source: "scheduler" });
      }
    } catch { /* db not ready */ }
  }, 60_000);

  // Nightly distiller at 03:00 local (DESIGN.md §10.2)
  const scheduleDistiller = (): void => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(3, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    setTimeout(() => {
      void runDistiller().catch(() => {});
      scheduleDistiller();
    }, next.getTime() - now.getTime());
  };
  scheduleDistiller();
}

export async function runAgent(opts: RunOpts): Promise<{ text: string; provider: string; failovers: number }> {
  ensureScheduler();
  const { builtin, mcp } = await allTools();
  let failovers = 0;
  const onFailover = (from: string, to: string, reason: string): void => {
    failovers++;
    opts.onEvent({ type: "failover", from, to, reason });
    logActivity("BRAIN_FAILOVER", `${from} → ${to} (${reason.slice(0, 80)})`.slice(0, 180));
  };

  // Tier 1 — Gemini free tier, if a key is configured.
  if (process.env.GEMINI_API_KEY) {
    try {
      const text = await runGemini(opts, builtin, mcp);
      return { text, provider: `gemini:${process.env.JARVIS_MODEL || "gemini-2.5-flash"}`, failovers };
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      const reason = err instanceof Error ? err.message.slice(0, 120) : String(err);
      onFailover(`gemini:${process.env.JARVIS_MODEL || "gemini-2.5-flash"}`, "openrouter free pool", reason);
    }
  }

  // Tier 2 — self-healing free pool across ALL configured providers (OpenRouter + extras):
  // up to ~30 brains per turn, re-ranked against the live catalog so new free models
  // are adopted automatically.
  let poolCapped = false;
  if (isOpenRouterConfigured() || configuredProviders().length > 0) {
    try {
      const { text, provider } = await runOpenAIPool(opts, builtin, mcp, onFailover);
      return { text, provider, failovers };
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("free-models-per-day")) poolCapped = true;
      onFailover("model pool", `local:${process.env.JARVIS_MODEL || "llama3.1"}`, msg.slice(0, 120));
    }
  }

  // Tier 3 — local endpoint (Ollama / LM Studio / OmniRoute) keeps the lights on when offline.
  const baseUrl = (process.env.JARVIS_BASE_URL || "http://localhost:11434/v1").replace(/\/$/, "");
  const model = process.env.JARVIS_MODEL || "llama3.1";
  try {
    const text = await streamOpenAIOnce(opts, model, baseUrl, process.env.JARVIS_API_KEY ?? "", builtin, mcp);
    return { text, provider: `local:${model}`, failovers };
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    if (poolCapped) {
      throw new Error(
        "Sir — the free-model daily allowance is exhausted (resets midnight UTC). Options: top up OpenRouter credits, or add free keys in .env — GEMINI_API_KEY (Tier 1), GROQ_API_KEY, CEREBRAS_API_KEY, GITHUB_MODELS_TOKEN, MISTRAL_API_KEY, NVIDIA_API_KEY — each joins the failover pool automatically."
      );
    }
    throw err;
  }
}
