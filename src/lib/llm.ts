/**
 * LLM BRAIN — free-model pool with self-healing failover.
 *
 * Doctrine: J.A.R.V.I.S. never runs out of brain. Every model here is FREE on OpenRouter.
 * The chain is ranked by (context window, then novelty). If the active model is rate-limited,
 * down, context-overflowed or returns garbage, the engine trips its breaker and the next
 * model in the chain answers mid-conversation — same SSE stream, same tools, zero user pain.
 *
 * The chain re-ranks itself against the LIVE OpenRouter catalog (cached for 10 minutes),
 * so new/better free models are adopted automatically. Models that stop existing or stop
 * being free are dropped.
 */

export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

/** Fallback chain — ranked by context, then freshness. All `:free` and verified tool-capable.
 *  This is the OFFLINE fallback when the live catalog can't be fetched; it is kept in sync
 *  with models that were verified working against the real API (not just listed in the catalog).
 *  NB: some catalog-listed free models reject plain API calls ("agentic harnesses only") —
 *  they are handled by the breaker + classifier, never by trusting the catalog blindly. */
export const FREE_MODEL_CHAIN = [
  "nvidia/nemotron-3.5-lightning:free", // 1,048,576 ctx — fast, verified tools
  "dots-studio/dots-3-note-preview:free", // 524,288 ctx
  "inclusionai/ling-3.0-flash-vl:free", // 262,144 ctx — vision
  "nex-agi/nex-n2.5-mini:free", // 262,144 ctx
  "inclusionai/ling-3.0-flash-fin:free", // 262,144 ctx
  "inclusionai/ling-3.0-flash-sante:free", // 262,144 ctx
  "nex-agi/nex-n2.5-pro:free", // 262,144 ctx
  "nvidia/nemotron-3-ultra-550b-a55b:free", // LAST RESORT — leaks interleaved thinking into content (garbled narration); only when everything else is capped
  "qwen/qwen3.8-27b:free", // 262,144 ctx
  "poolside/laguna-s-2.1:free", // 262,144 ctx
] as const;

const CATALOG_TTL_MS = 10 * 60e3; // re-rank against live catalog at most every 10 min
const BREAKER_COOLDOWN_MS = 5 * 60e3; // trip time before a failed model may try again

export interface PoolCandidate {
  id: string;
  source: "catalog" | "chain" | "provider";
  /** Set when the model lives on a non-OpenRouter provider. */
  provider?: ProviderDef;
}

export interface ProviderDef {
  id: string;
  baseUrl: string;
  /** When set, baseUrl is resolved from this env var at call time (self-hosted endpoints). */
  baseUrlEnv?: string;
  keyEnv: string;
  models: string[];
}

/** Additional OpenAI-compatible free providers — any key present in .env joins the pool. */
export const EXTRA_PROVIDERS: ProviderDef[] = [
  // ORDER MATTERS: tool-proven direct providers walk first; combo/aggregator tiers follow.
  {
    id: "nvidia",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    keyEnv: "NVIDIA_API_KEY",
    // Tool-proven against the live NIM API (2026-09-20 probes with a real tools
    // request): only these two emit tool_calls. mistral-nemotron (narrator),
    // gpt-oss-20b (flaky 404) and lightning (narrator) are excluded on purpose.
    models: [
      "nvidia/nemotron-3-super-120b-a12b",
      "nvidia/nemotron-3-ultra-550b-a55b",
    ],
  },
  {
    // FreeLLMAPI (deploy/freellm-deploy.mjs): 295 free models across 21 platforms
    // behind one OpenAI-compatible /v1, with per-model rate-limit tracking and
    // automatic failover. "auto" = their balanced router across all keyed platforms.
    id: "freellmapi",
    baseUrl: "http://localhost:3001/v1",
    baseUrlEnv: "FREELLMAPI_BASE_URL",
    keyEnv: "FREELLMAPI_API_KEY",
    // "auto" = their balanced router (DeepSeek-R1 via HuggingFace today): clean
    // narration, reliable tools — preferred backup over the NVIDIA 550B narrator.
    models: ["auto", "moonshotai/Kimi-K3", "openrouter/gpt-oss-120b"],
  },
  {
    id: "omniroute",
    baseUrl: "http://localhost:20128/v1",
    baseUrlEnv: "OMNIROUTE_BASE_URL",
    keyEnv: "OMNIROUTE_API_KEY",
    // The JARVIS combos (priority failover walks inside OmniRoute) + the federation
    // auto-router as tail. Combo order is managed by deploy/push-omr-state.mjs.
    models: ["jarvis-pro", "jarvis-free", "jarvis-fast", "jarvis-coder", "auto/best-chat"],
  },
  { id: "groq", baseUrl: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY", models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "qwen/qwen3-32b", "moonshotai/kimi-k2-instruct"] },
  { id: "cerebras", baseUrl: "https://api.cerebras.ai/v1", keyEnv: "CEREBRAS_API_KEY", models: ["llama-3.3-70b", "qwen-3-32b", "gpt-oss-120b"] },
  { id: "github-models", baseUrl: "https://models.github.ai/inference", keyEnv: "GITHUB_MODELS_TOKEN", models: ["openai/gpt-4.1-mini", "meta/Llama-4-Scout-17B-16E-Instruct", "mistral-ai/mistral-small-2503"] },
  { id: "mistral", baseUrl: "https://api.mistral.ai/v1", keyEnv: "MISTRAL_API_KEY", models: ["mistral-small-latest", "open-mistral-nemo"] },
];

export function configuredProviders(): ProviderDef[] {
  return EXTRA_PROVIDERS.filter((p) => (process.env[p.keyEnv] ?? "").trim().length > 0);
}

/** Stable breaker/dedupe key for a candidate across providers. */
export function candidateKey(c: PoolCandidate): string {
  return `${c.provider?.id ?? "openrouter"}:${c.id}`;
}

const breaker = new Map<string, number>(); // candidateKey -> epoch ms when it may retry
let catalogCache: { ids: string[]; fetchedAt: number } | null = null;

/**
 * Warm the live catalog in the background so the first chat of a session doesn't
 * pay the ~2–8s catalog fetch. Fired on module load and every TTL/2.
 */
export function warmCatalog(): void {
  const key = openRouterKey();
  if (!key) return;
  if (catalogCache && Date.now() - catalogCache.fetchedAt < CATALOG_TTL_MS - 30_000) return;
  void fetchCatalogFreeModels(key).catch(() => {});
}
warmCatalog();
setInterval(warmCatalog, CATALOG_TTL_MS / 2);
setInterval(() => {
  const now = Date.now();
  for (const [k, until] of breaker) if (now > until) breaker.delete(k);
}, 60_000);

function openRouterKey(): string | null {
  const key = process.env.OPENROUTER_API_KEY ?? process.env.JARVIS_API_KEY;
  return key && key.startsWith("sk-or-") ? key : null;
}

export function isOpenRouterConfigured(): boolean {
  return openRouterKey() !== null;
}

/** Mark a model as failed right now; it cools down before rejoining the chain. */
export function tripBreaker(modelId: string, cooldownMs = BREAKER_COOLDOWN_MS): void {
  breaker.set(modelId, Date.now() + cooldownMs);
}

export function breakerOpen(key: string): boolean {
  const until = breaker.get(key);
  if (until === undefined) return false;
  if (Date.now() > until) {
    breaker.delete(key);
    return false;
  }
  return true;
}

/** Live OpenRouter free tier: zero-cost models that support tool calling, biggest context first. */
export async function fetchCatalogFreeModels(apiKey: string): Promise<string[]> {
  const res = await fetch(`${OPENROUTER_BASE}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const json = (await res.json()) as {
    data?: {
      id: string;
      context_length?: number;
      created?: number;
      supported_parameters?: string[];
      pricing?: { prompt?: string; completion?: string };
    }[];
  };
  const now = Date.now();
  const usable = (json.data ?? []).filter(
    (m) =>
      m.id.endsWith(":free") &&
      Number(m.pricing?.prompt ?? 1) === 0 &&
      Number(m.pricing?.completion ?? 1) === 0 &&
      Array.isArray(m.supported_parameters) &&
      m.supported_parameters.includes("tools")
  );
  usable.sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0) || (b.created ?? 0) - (a.created ?? 0));
  catalogCache = { ids: usable.map((m) => m.id), fetchedAt: now };
  return catalogCache.ids;
}

function envChain(): string[] {
  const raw = (process.env.JARVIS_MODEL_CHAIN ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return raw;
}

/**
 * Ranked, de-duplicated chain: [explicit JARVIS_MODEL first] → [live catalog free models]
 * → [static FREE_MODEL_CHAIN]. Models with an open breaker are pushed to the end (not
 * dropped) so a cooled-down breaker still provides last-resort coverage.
 */
export async function rankedChain(): Promise<{ chain: PoolCandidate[]; catalogLive: boolean }> {
  const key = openRouterKey();
  let catalogLive = false;

  let catalogIds: string[] | null = null;
  if (key) {
    const fresh = catalogCache && Date.now() - catalogCache.fetchedAt < CATALOG_TTL_MS ? catalogCache.ids : null;
    if (fresh) {
      catalogIds = fresh;
      catalogLive = true;
    } else {
      try {
        catalogIds = await fetchCatalogFreeModels(key);
        catalogLive = true;
      } catch {
        catalogIds = null; // offline catalog: static chain still protects us
      }
    }
  }

  const head = (process.env.JARVIS_MODEL ?? "").trim();
  const chain: PoolCandidate[] = [];
  const seen = new Set<string>();
  const push = (id: string, source: PoolCandidate["source"], provider?: ProviderDef): void => {
    const clean = id.trim();
    const key = `${provider?.id ?? "openrouter"}:${clean}`;
    if (!clean || seen.has(key)) return;
    seen.add(key);
    chain.push({ id: clean, source, provider });
  };

  if (head) push(head, "chain"); // explicit pin wins the head (free or not)
  for (const id of envChain()) push(id, "chain"); // explicit operator chain: behavior-tested order, before catalog heuristics
  for (const p of configuredProviders()) for (const id of p.models) push(id, "provider", p);
  for (const id of catalogIds ?? []) push(id, "catalog");
  for (const id of FREE_MODEL_CHAIN) push(id, "chain");

  const open = chain.filter((c) => breakerOpen(candidateKey(c)));
  const ready = chain.filter((c) => !breakerOpen(candidateKey(c)));
  return { chain: [...ready, ...open], catalogLive };
}

/* ── Error classification ───────────────────────────────────────────────────────
 * Which failures mean "this brain is done for this turn" → try the next model.
 * Per-model access problems (403/404) MUST walk the chain; only key-level failures (401/402) should not.
 * ────────────────────────────────────────────────────────────────────────────── */
/**
 * How long a failed model should stay out of rotation:
 * policy/permanent errors cool down for a day, transient ones for minutes.
 */
export function breakerCooldownFor(status: number, body: string): number {
  const b = body.toLowerCase();
  if (b.includes("agentic harness")) return 24 * 60 * 60e3; // harness-only policy — effectively permanent
  if (status === 404 || b.includes("unavailable for free") || b.includes("not a valid model") || b.includes("no endpoints")) {
    return 24 * 60 * 60e3; // model retired/renamed — effectively permanent
  }
  if (b.includes("context length") || b.includes("maximum context") || b.includes("too many tokens") || b.includes("input tokens exceed")) {
    return 60 * 60e3; // dead for conversations this size, fine for smaller ones later
  }
  return BREAKER_COOLDOWN_MS; // rate limits / transient outages: standard 5 min
}

export function shouldFailover(status: number, body: string): boolean {
  if (status === 403 || status === 404) return true; // this model is blocked/gone — the next one likely isn't
  if ([408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524].includes(status)) return true;
  const b = body.toLowerCase();
  const patterns = [
    "rate limit",
    "quota",
    "insufficient", // provider credit errors on routed free models
    "temporarily",
    "overloaded",
    "capacity",
    "no allowed providers",
    "no endpoints", // model vanished from the catalog
    "not a valid model", // model renamed/removed upstream
    "invalid model",
    "unavailable for free", // free tier retired for this model
    "agentic harness", // model restricted to coding-agent harnesses — rejects plain API calls
    "context length", // prompt longer than this model's window
    "maximum context",
    "too many tokens",
    "input tokens exceed",
  ];
  return patterns.some((p) => b.includes(p));
}

/**
 * Mid-stream drop (network reset, empty stream, malformed SSE) → the next model takes over.
 * A user-initiated abort does NOT spin the chain.
 */
export function shouldFailoverOnStreamError(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err).toLowerCase();
  return !msg.includes("abort");
}
