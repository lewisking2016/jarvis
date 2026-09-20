import os from "node:os";
import { isOpenRouterConfigured, breakerOpen, FREE_MODEL_CHAIN, rankedChain, candidateKey, configuredProviders } from "@/lib/llm";

export const runtime = "nodejs";

function brainHealth(): {
  active: string;
  chain: { id: string; breaker: boolean }[];
  catalog_rerank: string;
} {
  const head = (process.env.JARVIS_MODEL ?? "").trim();
  const active = head || FREE_MODEL_CHAIN[0];
  return {
    active,
    chain: FREE_MODEL_CHAIN.map((id) => ({ id, breaker: breakerOpen(id) })),
    catalog_rerank: isOpenRouterConfigured() ? "live (every 10 min)" : "static chain",
  };
}

async function liveChain(): Promise<{ id: string; breaker: boolean }[]> {
  try {
    const { chain } = await rankedChain();
    return chain.slice(0, 24).map((c) => ({
      id: c.provider ? `${c.provider.id}:${c.id}` : c.id,
      breaker: breakerOpen(candidateKey(c)),
    }));
  } catch {
    return [];
  }
}

export async function GET(): Promise<Response> {
  const memTotal = os.totalmem();
  const memFree = os.freemem();
  const orOn = isOpenRouterConfigured();
  return Response.json({
    status: "online",
    hostname: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    cpu: {
      model: os.cpus()[0]?.model ?? "unknown",
      cores: os.cpus().length,
      load: os.loadavg().map((l) => Math.round(l * 100) / 100),
      speed_mhz: os.cpus()[0]?.speed ?? 0,
    },
    memory: {
      total_gb: Math.round((memTotal / 2 ** 30) * 10) / 10,
      used_pct: Math.round(((memTotal - memFree) / memTotal) * 100),
    },
    uptime_hours: Math.round((os.uptime() / 3600) * 10) / 10,
    provider: orOn ? "openrouter-free-pool" : "openai-compatible",
    model: brainHealth().active,
    brain: {
      pool: orOn || configuredProviders().length > 0 ? "multi-provider-free-pool" : "static",
      ...(await (async () => {
        const base = brainHealth();
        const live = await liveChain();
        return live.length ? { ...base, chain: live } : base;
      })()),
      extra_providers: configuredProviders().map((p) => p.id),
      gemini_tier: Boolean(process.env.GEMINI_API_KEY),
      local_tier: Boolean(process.env.JARVIS_BASE_URL),
    },
    time: new Date().toISOString(),
  });
}
