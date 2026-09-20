# J.A.R.V.I.S. — IMT General System Command Core

An Iron-Man-inspired, self-hosted AI **marketer + manager + operations chief** in a single dashboard.

- **Talk to it (voice or text)** — it answers in character and *acts*: records leads, creates quotes & invoices, manages tasks and notes, reports on your machine, and calls any MCP tool you plug in.
- **Free & open-source stack** — Next.js 15 + React 19, Node's built-in SQLite, and a **self-healing free-LLM pool** (OpenRouter `:free` models with auto-failover; optional Gemini tier and Ollama fallback). The brain never runs out: if the active model is rate-limited, down, or over context, the next free model takes over mid-turn.

![status](https://img.shields.io/badge/status-v2%20--%20CRM%2FERP%20command%20core-cyan)

## v2 — the full command core (CRM + ERP + agent)

| Module | Route | What it does |
|---|---|---|
| Command Deck | `/` | Mission ring (Q4 pace), money pulse, funnel, today's levers, approvals, activity |
| CRM / Pipeline | `/crm` | Board + table views, one lead record fed by chat, outreach and research |
| Money Desk | `/money` | M-Pesa ledger, invoices/receipts, manual entry, category breakdown, webhook bridge |
| Revenue Mission | `/revenue` | Target pace math, forecast, pipeline value, daily levers |
| Outbound | `/outreach` | Sequence queue, gated sends, reply classifier, kill-switch doctrine |
| Memory Core | `/memory` | What JARVIS knows — identity, lessons, decisions; recall search; teach him more |
| Fleet & MCP | `/fleet` | Worker registry, MCP relays, integration roadmap |
| Approvals | `/approvals` | Every gate awaiting your yes, with policy |
| Settings | `/settings` | Runtime, provider checklist, webhooks, demo dataset (SEED button) |

Press **⌘K / Ctrl+K** anywhere to talk to JARVIS (voice 🎙/🔊 built in). Full design rationale in `DESIGN.md` (§13 money desk, §14 revenue engine, §15 outbound).

---

## 1. Quick start

```bash
npm install
cp .env.example .env        # then paste your OpenRouter key (free) into .env
npm run dev                 # open http://localhost:3000
```

Production: `npm run build && npm start`.

### Bring the brain online (free, 2 minutes)

1. Get a **free OpenRouter API key** at <https://openrouter.ai/keys> and paste it into `.env` as `OPENROUTER_API_KEY`.
2. Restart the server. JARVIS now runs on the free-model pool — ranked by context window (1M-token brains first), re-ranked against the live OpenRouter catalog every 10 minutes.
3. If a model is rate-limited, down, or context-overflows, the circuit breaker trips and **the next free brain answers mid-turn** — you'll see a `◈ BRAIN` badge in the console.

Optional tiers: set `GEMINI_API_KEY` for a Gemini-first brain, or install [Ollama](https://ollama.com) as the offline Tier-3 fallback.

### M-Pesa → ledger (live)

Set up the Android SMS bridge per **`MPESA-BRIDGE.md`** — real payments then auto-reconcile to
invoices and issue receipt PDFs (`RCP-…`) with zero manual work. Every document has a **PDF**
download button in Money Desk / Revenue Mission.

## 2. What JARVIS can do today (built-in tools)

| Area | Say things like… |
|---|---|
| **CRM / Leads** | "Add a lead: Acme Ltd, contact John, score 70" · "Show my contacted leads" |
| **Quotes & Invoices** | "Create a quote for Acme: 3 sites at $500 each, 16% VAT" — numbers & totals are computed and recorded automatically |
| **Tasks / follow-ups** | "Remind me to call Acme on Friday" (stored as a task) |
| **Notes / briefings** | "Take a note: client wants delivery by March" · "What did I note about Acme?" |
| **System reports** | "System report" — CPU, memory, uptime, DB record counts |
| **Any MCP tool** | Whatever you plug into `jarvis.mcp.json` (below) |

Everything is stored locally in `jarvis.data.sqlite` (leads, documents, tasks, notes, activity log). The HUD polls live panels: **Leads · Ledger · Tasks · Activity feed · System diagnostics · MCP status**.

## 3. Voice

- 🎙 mic button — speech-to-text via the Web Speech API (Chrome/Edge).
- 🔊 speaker button — JARVIS speaks his replies back (pitched down, JARVIS-style).
- Voice is off by default; toggle it with the 🔊 button.

## 4. Extending JARVIS — the MCP bridge

Every MCP server you add in **`jarvis.mcp.json`** is auto-discovered and becomes callable by JARVIS (with streaming status shown in the chat). The format matches Claude Desktop / Cursor configs, so you can copy server blocks straight from those ecosystems:

```jsonc
{
  "mcpServers": {
    "web-research": { "command": "npx", "args": ["-y", "mcp-server-fetch"] },
    // "google-sheets": { "command": "npx", "args": ["-y", "@heyyang/mcp-google-sheets"], "env": { "GOOGLE_OAUTH_CREDS": "..." } },
    // "whatsapp":      { "command": "npx", "args": ["-y", "whatsapp-mcp-server"] },
    // "fathom":        { "command": "npx", "args": ["-y", "fathom-mcp"], "env": { "FATHOM_API_KEY": "..." } },
    // "firecrawl":     { "command": "npx", "args": ["-y", "firecrawl-mcp"], "env": { "FIRECRAWL_API_KEY": "..." } }
  }
}
```

Save the file, then hit **POST /api/mcp** (or restart) — new tools appear in the HUD's MCP counter and are immediately usable in chat.

## 5. Architecture

```
HUD (this dashboard)          Brain (Gemini / Ollama)            Hands
┌──────────────────┐   SSE    ┌──────────────────────┐    MCP   ┌──────────────────┐
│ arc reactor · chat│ ───────▶ │ agent loop           │ ───────▶ │ jarvis.mcp.json  │
│ panels · voice    │ ◀─────── │ tool calling + memory│ ◀─────── │ + built-in tools │
└──────────────────┘  stream  └──────────────────────┘          └──────────────────┘
        │                        │
        └── SQLite (leads, docs, tasks, notes, activity) ──┘
```

Key source files:

| File | Role |
|---|---|
| `src/lib/agent.ts` | Agent loop — streaming, tool calling, tiered provider failover |
| `src/lib/llm.ts` | Free-model pool — live catalog re-rank, circuit breaker, failover classification |
| `src/lib/tools.ts` | Built-in business tools (CRM, quotes/invoices, tasks, notes, system) |
| `src/lib/mcp.ts` | MCP bridge — loads `jarvis.mcp.json`, exposes servers as tools |
| `src/lib/system.ts` | JARVIS persona & operating rules |
| `src/lib/db.ts` | SQLite schema (leads, documents, tasks, notes, activity) |
| `src/app/page.tsx` | The HUD |

## 6. Roadmap (suggested next moves)

1. **PDF export** for quotes/invoices (`paperjsx/mcp-server` plugs straight into the bridge).
2. **Lead-gen wiring**: `lead-gen-mcp` + `seo-mcp` from GitHub → JARVIS hunts and files prospects on schedule.
3. **Scheduled autonomy**: cron-driven directives ("every morning: check replies, draft follow-ups").
4. **Google Sheets / Gmail / WhatsApp / Fathom MCP servers** — copy configs from their repos into `jarvis.mcp.json`.
5. **Auth + multi-user** before exposing beyond localhost.

## 7. Notes

- The chat history is kept per-session in the browser (last 30 turns sent as context).
- Tool calls are logged to the activity table with truncated arguments for audit.
- Keep `.env` out of git (already ignored). The SQLite file is git-ignored too.
