import { getDb, logActivity } from "./db";
import { remember } from "./memory";
import { verifyMailbox } from "./email";
import { rankedChain, candidateKey, breakerOpen, tripBreaker } from "./llm";
import { discoverMcpTools } from "./mcp";

/**
 * NIGHTLY SELF-CHECK (03:00) — JARVIS verifies his own body:
 *   1. every brain in the failover chain (live 1-token probe, all providers —
 *      this is how the auto/* models get their verdict: measured, not assumed)
 *   2. all MCP servers (tool discovery per server)
 *   3. both SMTP mailboxes (STARTTLS auth check, no mail sent)
 * Results are stored, healthy auto models get their breakers cleared, and the
 * principal is briefed via activity feed + memory + a task when something is down.
 */

export interface BrainCheck {
  id: string;
  ok: boolean;
  ms: number;
  status: number;
  detail: string;
}

async function probeBrain(
  model: string,
  baseUrl: string,
  apiKey: string
): Promise<BrainCheck> {
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Reply with the single word: ready" }],
        tools: [
          {
            type: "function",
            function: {
              name: "noop",
              description: "Does nothing; probes tool support.",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
        max_tokens: 300, // reasoning models burn thinking tokens first
        temperature: 0,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const ms = Date.now() - started;
    const body = await res.text().catch(() => "");
    if (res.ok) {
      let ok = false;
      try {
        const j = JSON.parse(body) as { choices?: { message?: { content?: string; tool_calls?: unknown[] } }[] };
        const msg = j.choices?.[0]?.message;
        ok = Boolean(msg?.content || msg?.tool_calls?.length); // narrators that can't call tools fail later — content alone is not enough
      } catch {
        ok = false;
      }
      return { id: model, ok, ms, status: res.status, detail: ok ? "answered" : "empty reply" };
    }
    return { id: model, ok: false, ms, status: res.status, detail: body.slice(0, 140) };
  } catch (err) {
    return {
      id: model,
      ok: false,
      ms: Date.now() - started,
      status: 0,
      detail: err instanceof Error ? err.message.slice(0, 140) : "network error",
    };
  }
}

async function checkBrains(): Promise<{ results: BrainCheck[]; healthy: number; capped: boolean }> {
  const { chain } = await rankedChain();
  const openRouterKey = process.env.OPENROUTER_API_KEY ?? process.env.JARVIS_API_KEY ?? "";
  const results: BrainCheck[] = [];
  let capped = false;

  for (const cand of chain) {
    const baseUrl = cand.provider?.baseUrlEnv
      ? (process.env[cand.provider.baseUrlEnv] ?? cand.provider.baseUrl)
      : (cand.provider?.baseUrl ?? "https://openrouter.ai/api/v1");
    const apiKey = cand.provider ? (process.env[cand.provider.keyEnv] ?? "") : openRouterKey;
    const r = await probeBrain(cand.id, baseUrl, apiKey);
    // A 429 free-models-per-day cap applies to the whole OpenRouter account.
    if (!r.ok && /free-models-per-day/.test(r.detail)) capped = true;
    if (r.ok) {
      // Healthy — clear any stale breaker (incl. auto/* models proving themselves).
      const until = breakerOpen(candidateKey(cand));
      if (until) {
        // breakerOpen only reads; reset by re-tripping with 0 cooldown is not exposed,
        // so expire it naturally by directly checking the map via tripBreaker(0ms).
        tripBreaker(candidateKey(cand), 0);
      }
    }
    results.push(r);
  }
  return { results, healthy: results.filter((r) => r.ok).length, capped };
}

export interface SelfCheckReport {
  ran_at: string;
  brains: { healthy: number; total: number; capped: boolean; results: BrainCheck[] };
  mcp: { servers: number; tools: number; errors: string[] };
  smtp: { marketing: boolean; formal: boolean };
  verdict: string;
}

export async function runSelfCheck(): Promise<SelfCheckReport> {
  const started = Date.now();
  const [brains, mcp] = await Promise.all([
    checkBrains(),
    discoverMcpTools().catch(() => ({ tools: [], errors: ["discovery crashed"] })),
  ]);
  const [marketing, formal] = await Promise.all([
    verifyMailbox("marketing").catch(() => false),
    verifyMailbox("formal").catch(() => false),
  ]);

  const deadBrains = brains.results.filter((r) => !r.ok);
  const deadMcp = mcp.errors;
  const deadSmtp = [
    ...(marketing ? [] : ["marketing (info@)"]),
    ...(formal ? [] : ["formal (admin@)"]),
  ];
  const problems: string[] = [];
  if (brains.healthy === 0) problems.push(`no brain answered (${brains.capped ? "daily free allowance exhausted" : "all providers failing"})`);
  else if (deadBrains.length) problems.push(`${deadBrains.length} brain(s) down: ${deadBrains.map((b) => b.id.split("/").pop()).join(", ")}`);
  if (deadMcp.length) problems.push(`MCP: ${deadMcp.join("; ")}`);
  if (deadSmtp.length) problems.push(`SMTP down: ${deadSmtp.join(", ")}`);

  const report: SelfCheckReport = {
    ran_at: new Date().toISOString(),
    brains: { healthy: brains.healthy, total: brains.results.length, capped: brains.capped, results: brains.results },
    mcp: { servers: new Set((mcp.tools ?? []).map((t: { server: string }) => t.server)).size, tools: (mcp.tools ?? []).length, errors: mcp.errors ?? [] },
    smtp: { marketing, formal },
    verdict: problems.length
      ? `ISSUES — ${problems.join(" · ")}`
      : `ALL SYSTEMS NOMINAL — ${brains.healthy}/${brains.results.length} brains, ${(mcp.tools ?? []).length} tools, both mailboxes`,
  };

  // persist
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES ('selfcheck_last', ?)").run(JSON.stringify(report));
  logActivity(
    problems.length ? "SELFCHECK_DEGRADED" : "SELFCHECK_OK",
    report.verdict.slice(0, 180)
  );
  void remember({
    kind: "event",
    content: `Nightly self-check ${new Date().toISOString().slice(0, 10)}: ${report.verdict}`,
    importance: problems.length ? 4 : 1,
    source: "selfcheck",
  });
  if (problems.length) {
    db.prepare("INSERT INTO tasks (title, priority, status) VALUES (?, 'high', 'open')").run(
      `Self-check issues (${new Date().toISOString().slice(0, 10)}): ${problems.join(" · ")}`.slice(0, 240)
    );
  }
  return report;
}

let selfcheckStarted = false;
export function ensureSelfCheckScheduler(): void {
  if (selfcheckStarted) return;
  selfcheckStarted = true;
  const schedule = (): void => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(3, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    setTimeout(() => {
      void runSelfCheck().catch(() => {});
      // Self-improvement cycle — after the body check, review the day and learn.
      setTimeout(() => void nightlyLessons().catch(() => {}), 90_000);
      schedule();
    }, next.getTime() - now.getTime());
  };
  schedule();
}

/* ── Nightly self-improvement (03:01) ─────────────────────────────────────────
 * Reviews the last 24h of operations and distils durable lessons into memory.
 * Memory is injected into every future system prompt, so this literally makes
 * JARVIS better at his job every day: which brains flaked, which tools failed,
 * what work got dropped, what patterns to avoid.
 * ────────────────────────────────────────────────────────────────────────── */
export async function nightlyLessons(): Promise<{ lessons: string[] }> {
  const db = getDb();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 19).replace("T", " ");
  const acts = db
    .prepare("SELECT action, detail, created_at FROM activity WHERE created_at >= ? ORDER BY id ASC")
    .all(since) as { action: string; detail: string; created_at: string }[];

  const lessons: string[] = [];
  if (acts.length === 0) {
    lessons.push("Quiet day (no logged activity) — if the principal expected work, investigate whether directives are reaching you.");
  } else {
    const byAction = new Map<string, number>();
    for (const a of acts) byAction.set(a.action, (byAction.get(a.action) ?? 0) + 1);

    // Brain reliability — which models flaked and how the walk coped.
    const failovers = acts.filter((a) => /FAILOVER|BRAIN/i.test(a.action));
    if (failovers.length >= 3) {
      const perModel = new Map<string, number>();
      for (const f of failovers) {
        const m = f.detail.match(/([\w./-]{4,60})\s*(?:→|->|failed|\()/);
        if (m) perModel.set(m[1], (perModel.get(m[1]) ?? 0) + 1);
      }
      const worst = [...perModel.entries()].sort((a, b) => b[1] - a[1])[0];
      if (worst && worst[1] >= 2)
        lessons.push(
          `Brain reliability: "${worst[0]}" failed ${worst[1]} times in 24h. Expect walks away from it; prefer proven brains for time-critical work and don't re-pin it without fresh evidence.`
        );
    }

    // Tool failures — skills that misfired deserve caution next time.
    const toolFails = acts.filter((a) => /FAILED|ERROR|_FAIL/i.test(a.action));
    if (toolFails.length)
      lessons.push(
        `${toolFails.length} tool failure(s) in 24h (${[...new Set(toolFails.map((t) => t.action))].slice(0, 5).join(", ")}). Check those tools' preconditions before using them; report root causes to the principal when asked.`
      );

    // Dropped work — follow-ups and tasks that aged past their due date.
    const overdue = (
      db.prepare("SELECT COUNT(*) c FROM tasks WHERE status='open' AND due IS NOT NULL AND due < date('now')").get() as { c: number }
    ).c;
    if (overdue)
      lessons.push(
        `${overdue} task(s) went overdue today. A butler never drops an obligation — escalate overdue items to the principal first thing tomorrow.`
      );

    // Approval latency — things the principal keeps waiting on.
    const pending = (
      db.prepare("SELECT COUNT(*) c FROM approvals WHERE status='pending'").get() as { c: number }
    ).c;
    if (pending >= 3)
      lessons.push(`${pending} approvals are pending. Batch them into one consolidated briefing instead of piecemeal pings.`);

    // Workload shape — what the day actually consisted of.
    const top = [...byAction.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (top.length)
      lessons.push(`Workload shape: most frequent operations were ${top.map(([k, v]) => `${k}×${v}`).join(", ")}. Keep these paths warm.`);
  }

  const day = new Date().toISOString().slice(0, 10);
  await remember({
    kind: "lesson",
    content: `Daily self-improvement ${day}: ${lessons.join(" | ")}`,
    importance: 3,
    source: "self-improvement",
  });
  logActivity("LEARNING_CYCLE", `${lessons.length} lesson(s) distilled from ${acts.length} activity events`);
  return { lessons };
}
