# JARVIS × The 19 Repos — Design & Reasoning Document

> **Status:** design (no code). Blueprint for evolving the JARVIS core we built into a
> company-wide operating system by integrating 19 open-source projects — each in its natural role,
> with zero paid services in the critical path.
>
> **Design philosophy:**
> 1. JARVIS stays the single brain. Everything else is muscle, senses, or pipes.
> 2. One interface per external system — never two agents talking to the same platform.
> 3. Human control points where money or reputation is at stake (emails sent, posts published, invoices issued).
> 4. Every integration enters through one of three doors: **MCP** (tools), **REST** (services), or **harness sidecar** (autonomous processes).

---

## 1. The reasoning model: three doors

Every one of the 19 repos must enter the system through exactly one of three doors. This is the
core architectural decision — it keeps integration surface small and avoids duplicate paths:

| Door | What it means | When to choose it |
|---|---|---|
| **MCP tool** | JARVIS calls it on demand, mid-conversation | The repo exposes MCP or an easy CLI/HTTP call, and the action is *pull-based* ("do X now") |
| **REST service** | Long-running service JARVIS talks to via HTTP | The repo is a server (gateway, mail server) that must stay up |
| **Harness sidecar** | Autonomous process with its own loop, supervised by JARVIS | The repo is a harness/orchestrator that *runs* other agents or *watches* the world |

The JARVIS core (Next.js + agent loop + SQLite + `jarvis.mcp.json`) already implements doors 1 and 3 partially.

---

## 2. Integration matrix — all 19 repos

### Wave 1 — Channels: be reachable everywhere (weeks 1–2)

| Repo | What it really is | Door | JARVIS touchpoint |
|---|---|---|---|
| **rmyndharis/OpenWA** ⭐14.3k | Self-hosted WhatsApp **HTTP API gateway** (REST + React dashboard, plugin system) | **REST** | JARVIS gets `send_whatsapp` / `get_unread` / `reply` tools that hit OpenWA's REST API. OpenWA runs as a container; webhook → JARVIS `/api/webhooks/whatsapp` → agent loop → reply |
| **wangrongding/wechat-bot** ⭐11.4k | Multi-platform **IM bot** (WeChat QR login, Telegram Bot API, Lark, WhatsApp Cloud API) with model routing (ChatGPT/Claude/Kimi/DeepSeek/Ollama) | **REST + webhook** | Deployed as the *Telegram/WeChat/Lark front-end*. Its LLM slot is pointed **away from ChatGPT and at JARVIS** (`JARVIS_BASE_URL`): it forwards every message to JARVIS and delivers the streamed answer back |
| **novuhq/novu** ⭐40k | Communication **infrastructure layer** — unified inbox, triggered notifications, digests, preferences | **REST** (self-hosted) | The notification router: JARVIS emits "notify principal, priority high, channel X" and Novu decides email vs WhatsApp vs Telegram vs digest. Stops JARVIS from hard-coding channels |

**Reasoning — the WhatsApp conflict:** you listed *two* WhatsApp paths. Decision: **OpenWA is the
persistence/transport layer** (real gateway, phone session, plugin ecosystem). **wechat-bot is
demoted to non-WhatsApp channels** (Telegram, WeChat, Lark). One brain never speaks to the same
mailbox through two mouths — dual delivery paths cause duplicate replies and ban risk.

**Result of Wave 1:** JARVIS is reachable on WhatsApp, Telegram, WeChat, Lark. You can message him
from your phone, "create a quote for Acme, 3 sites at $500" and the invoice exists before you're home.

### Wave 2 — Marketing engine: find, warm, convert (weeks 3–6)

| Repo | What it really is | Door | JARVIS touchpoint |
|---|---|---|---|
| **eracle/OpenOutreach** ⭐3k | B2B lead-gen **agent**: describe product → finds fitting people (licensed data) → explains why → emails from your own mailbox. Data in `~/.openoutreach/data` | **Harness sidecar** | Runs its own loop; JARVIS reads its output folder via the existing `workspace-files` MCP server. Every qualified lead is auto-filed into JARVIS's `leads` table (Webhook/CLI bridge) |
| **zubair-trabzada/ai-sales-team-claude** ⭐1.4k | **Claude Code skill pack** (14 skills / 5 agents): company research, BANT+MEDDIC qualification, buying-committee mapping, outreach sequences, meeting prep, PDF proposals | **MCP tool / skill import** | Loaded as skills the JARVIS brain can invoke for deal work: "qualify this lead BANT" → structured scorecard stored on the lead; "write proposal" → feeds JARVIS's quote/invoice tools |
| **laramies/theHarvester** ⭐17.6k | OSINT harvester: emails, subdomains, names from public sources | **CLI → MCP tool** | Thin MCP wrapper: `harvest_domain(domain)` → parsed emails/names become candidate leads with source "OSINT" |
| **BillionMail/BillionMail** ⭐15.6k | Self-hosted **mail server + campaigns + newsletters + SMTP** (Go) | **REST service** | Owns *sending at scale*. JARVIS composes → `POST /api/campaigns` → BillionMail handles deliverability, bounces, unsubscribes. JARVIS reads campaign stats back into reports |
| **DimiMikadze/orca** ⭐1.3k | Deep **LinkedIn profile analysis** agent | **REST/CLI → MCP tool** | `analyze_linkedin(profile_url)` → scored profile summary attached to lead records |
| **stickerdaniel/linkedin-mcp-server** ⭐3.5k | **MCP server for LinkedIn**: profiles, companies, jobs, messages | **MCP tool** | Direct MCP entry in `jarvis.mcp.json` — JARVIS can read LinkedIn conversations and profiles (read-only at first; sending stays manual) |
| **ScrapeCreators/social-media-research-skills** ⭐2.5k | **Skills** for social research: outlier posts, comment mining, competitor teardowns, ad libraries across TikTok/IG/YT/Reddit/X/LinkedIn | **Skill import** | Marketing-intelligence skills for the JARVIS brain: weekly "what's working in our niche" briefs, competitor teardown reports |

**Reasoning — division of labor in outreach:** three engines could all "do email" (OpenOutreach,
ai-sales-team, BillionMail). Fixed roles: **OpenOutreach finds + first-touches**, **BillionMail
sends campaigns/nurture**, **JARVIS composes everything and files every contact**. theHarvester and
orca are intelligence, never senders. linkedin-mcp is ears, not mouth (initially). This prevents
the classic failure: three agents emailing the same prospect three times.

**Result of Wave 2:** a real funnel — OSINT → LinkedIn intel → qualification (BANT/MEDDIC) →
first-touch email → campaign nurture → JARVIS quote/invoice. The marketer is born.

### Wave 3 — Manager layer: operations, memory, workspaces (weeks 7–9)

| Repo | What it really is | Door | JARVIS touchpoint |
|---|---|---|---|
| **zhayujie/CowAgent** ⭐47k | **Agent harness**: plans tasks, runs tools/skills, multi-agent teams, self-evolution, multi-channel (its own WeChat/Feishu/DingTalk channels) | **Harness sidecar** | The *worker-fleet engine*. JARVIS is the manager; CowAgent pods are departments. Workers register in JARVIS's task table; JARVIS dispatches, workers execute, results land back in SQLite |
| **tinyhumansai/openhuman** ⭐39.9k | Personal **agent harness**: local-first structured memory, agent-fleet orchestration, workflows, deep research | **Harness sidecar** | Competes with CowAgent as orchestrator — see §4 decision. Its local-first **memory engine** is the most valuable part; can be adopted standalone as JARVIS's long-term memory layer |
| **ghostwright/phantom** ⭐1.5k | AI co-worker **on its own VM** (Claude Agent SDK): self-evolving, vector memory, **exposes an MCP server**, email identity, credential collection | **Harness sidecar + MCP** | The "remote office": a dedicated VM where long-running/credential-heavy work happens away from your PC. Its MCP server plugs into JARVIS so the co-worker is callable; its email identity becomes the outreach sender for OpenOutreach |
| **gastownhall/gastown** ⭐18.1k | Multi-agent **workspace manager for coding agents** (Claude Code, Copilot, Codex, Gemini…) via tmux; persists context across restarts | **Harness sidecar** | The *engineering department*. Your IMT dev projects get their own Gas Town; JARVIS holds the budget/task view and receives completion reports. This is the "connect with any AI coding tool on my PC" requirement, done properly |
| **microsoft/apm** ⭐3.9k | **Agent Package Manager**: `apm.yml` dependency manager for agent configurations (skills, rules, context) across harnesses | **CLI tooling** | The *supply chain*: your JARVIS config becomes `apm.yml`; skills from ECC/ai-sales-team/ScrapeCreators are versioned and installed reproducibly on every machine (PC + Phantom VM) |
| **affaan-m/ECC** ⭐262.8k | Cross-harness **performance system**: 67 agents, 271 skills, security scanner for Claude Code/Codex/Cursor/etc. | **Skill import** | Performance + security skills for every harness sidecar (and for Freebuff/Cursor when *you* code). Install via apm; JIT-loaded, never fully in JARVIS's context |

**Reasoning — harnesses are coworkers, not brains.** CowAgent/OpenHuman/Phantom/gastown/ECC all
contain orchestration. Swallowing them into JARVIS would duplicate state and create five competing
"me"s. Instead each gets a *jurisdiction*: CowAgent = business task workers, gastown = coding agents,
Phantom = remote VM co-worker, ECC = skill/perf layer, OpenHuman = memory + personal workflows.
JARVIS remains the only thing that talks to *you*.

### Wave 4 — Knowledge surface: unify what you read (weeks 10+)

| Repo | What it really is | Door | JARVIS touchpoint |
|---|---|---|---|
| **macro-inc/macro** ⭐4.4k (Rust) | Unified workspace: email + chat + docs + tasks + agents + calls + CRM, @-linked with shared team memory | **Evaluate / adopt** | See §4. Macro overlaps with JARVIS's own panels — adopt as team UI *only if* it exposes API/MCP to JARVIS; otherwise JARVIS's dashboard remains the surface and Macro is skipped |
| **OpenBB-finance/OpenBB** ⭐73.3k | Open data platform: market/financial data + analysts platform | **MCP/REST tool** | Only relevant if IMT deals touch markets/investments. Park until a business need appears |

---

## 3. The memory design (the thing that makes him feel alive)

```
                     ┌──────────────────────────────────────┐
   working memory    │ SQLite (already built)               │  session turns, leads,
   (hot, seconds)    │ chat turns · leads · docs · tasks    │  quotes, tasks, notes,
                     └──────────────┬───────────────────────┘  activity log
                                    │ Promote
                     ┌──────────────▼───────────────────────┐
   company memory    │ structured records + summaries       │  every lead touched,
   (warm, days)      │ (what happened, decisions, scores)   │  every deal state,
                     └──────────────┬───────────────────────┘  every doc issued
                                    │ Distill
                     ┌──────────────▼───────────────────────┐
   institutional     │ OpenHuman-style local-first memory    │  client history,
   memory (cold)     │ + pgvector embeddings (later)         │  lessons learned,
                     └──────────────────────────────────────┘  your preferences
```

Rules:
- Every tool call already writes an **activity row** — that's the raw feed for distillation.
- A nightly **distiller job** summarizes the day into memory entries ("Met Acme, quoted $1,740, they want March delivery").
- The JARVIS system prompt gains a **memory header**: the 10 most relevant facts injected per conversation.
- OpenHuman's memory engine is the candidate to power the cold layer (it's local-first, which matches your "everything on my PC" requirement).

## 4. The funnel (marketer logic)

```
theHarvester ─┐                          ┌→ BillionMail campaigns (nurture, newsletters)
              ├→ leads table ─→ JARVIS ──┼→ quote/invoice tools (close)
orca ─────────┤   (single source         │
linkedin-mcp ─┤    of truth)             ├→ WhatsApp/Telegram/Email reply (conversation)
OpenOutreach ─┘   score + BANT/MEDDIC    └→ tasks + notes (follow-ups, meeting prep)
ScrapeCreators skills → weekly market briefs → content/positioning advice
```

One lead record, one score, one status. Every channel writes to the same row. This single-table
discipline is what turns 19 tools into *one marketer* instead of 19 tools.

## 5. Control zones (what JARVIS may do alone)

| Zone | Examples | Policy |
|---|---|---|
| **Autonomous** | read anything, harvest OSINT, analyze LinkedIn, draft documents, file leads, write notes, run reports, message *you* | no approval needed |
| **Notify-then-act** | reply to a WhatsApp lead, create a quote draft, schedule a task | acts, but logs + pushes a Novu notification |
| **Approval required** | send campaign to >N people, publish/post publicly, issue an invoice, spend money, contact someone new first time | waits for your yes in the dashboard (and via WhatsApp "approve" reply) |

This mirrors what you asked for ("ready in any conversation") without the classic autonomous-agent
failure of emailing clients unsupervised in week one. The zones loosen as trust builds.

## 6. Conflicts resolved (decisions, not options)

| Conflict | Repos | Decision |
|---|---|---|
| WhatsApp transport | OpenWA vs wechat-bot | **OpenWA owns WhatsApp**; wechat-bot handles Telegram/WeChat/Lark |
| Lead-gen & email | OpenOutreach vs ai-sales-team vs BillionMail | **OpenOutreach = find + first touch; BillionMail = campaigns; ai-sales-team = qualification/proposal skills** |
| Orchestration harness | CowAgent vs OpenHuman | **CowAgent = worker fleet for business tasks; OpenHuman = memory + personal workflows.** Re-evaluate in 3 months; keep one, retire the other's overlap |
| Team workspace | Macro vs JARVIS dashboard | **JARVIS dashboard is canonical**; Macro only if its API/MCP proves out (Rust, self-host, young) |
| Coding agents | gastown vs ECC vs apm | **gastown runs them; ECC arms them; apm version-controls the arming** |
| Coding assistant | Freebuff/Cursor etc. | They keep their own harnesses; JARVIS gets *visibility* (reports, tasks) and shares MCP servers/apm packages, not control |

## 7. Concrete wiring (what changes in the repo per wave)

- **Wave 1:** `jarvis.mcp.json` + two new env blocks (OpenWA URL/key, Novu URL/key) + `/api/webhooks/whatsapp` + a `send_whatsapp` built-in tool + wechat-bot config pointed at JARVIS's chat endpoint.
- **Wave 2:** MCP entries for `linkedin-mcp-server`; thin MCP wrappers for theHarvester + orca; OpenOutreach sidecar with output folder inside `jarvis-workspace/`; BillionMail container + campaign tools; skill imports for ai-sales-team + ScrapeCreators (via apm).
- **Wave 3:** CowAgent worker registration (`workers` table), gastown projects, Phantom VM + its MCP server in config, apm.yml in repo root, ECC installed into each harness.
- **Wave 4:** decision gate on Macro/OpenBB.

## 8. Sequencing rule

Never integrate two repos from different layers in the same week. Waves exist because each layer
multiplies the value of the next: channels without memory = amnesia on WhatsApp; marketing without
channels = leads nobody talks to; harnesses without control zones = chaos.

## 9. Decisions (recorded — see §12 for rationale)

| # | Decision | Status |
|---|---|---|
| 1 | Channels = **WhatsApp + Telegram**; WeChat/Lark dormant | ✅ recorded |
| 2 | **Run on the PC first**, migrate channels + mail to a VPS in Wave 3 | ✅ recorded |
| 3 | Macro = **skip**, revisit after Wave 3 | ✅ recorded |
| 4 | Approvals = **medium** (autonomous with existing contacts; approval for new contacts, campaigns, invoices, public posts) | ✅ recorded |
| 5 | **Dedicated outreach domain** required for BillionMail; action item if none exists | ✅ recorded |

---

## 10. The memory brain — full design

### 10.1 Storage: SQLite first, vectors later

The cold layer starts as **SQLite with FTS5** (full-text search), not pgvector. Rationale: the
principal's PC has ~7 GB RAM and already runs the dashboard + several containers; a separate
Postgres+pgvector stack is unjustified until memory exceeds ~5k entries. The schema is
vector-ready (nullable `embedding` column) so sqlite-vec or Postgres can slot in later without a
migration of concepts — only of storage.

```sql
CREATE TABLE memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('fact','decision','preference','event','lesson','relationship')),
  -- fact: verifiable state ("Acme uses Ubuntu servers")
  -- decision: something the principal decided
  -- preference: how the principal likes things done
  -- event: dated occurrence ("quoted $1,740 on 2026-09-19")
  -- lesson: what worked / what backfired
  -- relationship: who-knows-who / org politics
  content TEXT NOT NULL,            -- one atomic statement, written for retrieval
  entities TEXT,                    -- JSON array: ["lead:3","client:acme","project:imt-web"]
  importance INTEGER NOT NULL DEFAULT 2,  -- 1..5 (5 = identity-level)
  confidence REAL NOT NULL DEFAULT 0.8,   -- distiller-set; decays if contradicted
  source TEXT NOT NULL DEFAULT 'distiller', -- 'chat' | 'tool' | 'distiller' | 'openhuman'
  embedding BLOB,                   -- null until a vector layer is added
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  superseded_by INTEGER,            -- set when a newer memory replaces this one
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE VIRTUAL TABLE memories_fts USING fts5(content, content=memories, content_rowid=id);
```

**Identity rows** (importance 5) are seeded once and never auto-expire: company name, what IMT
sells, principal's name and preferences, tone rules. Everything else is earned.

### 10.2 The distiller job (nightly, 03:00)

Runs inside the Next.js process via a scheduler utility (instrumentation hook + setInterval
aligned to local 03:00; no extra container):

```
1. GATHER: activity rows + chat transcript + tool-call payloads since last run.
2. PROMPT (one Gemini call, cheap model):  
   system: "You are the memory distiller. From this raw operational log, emit JSON ops."
   user:   "<log>\n\nEmit ops: ADD(kind,content,entities,importance,confidence),
            SUPERSEDE(id, content) when something changed,
            LINK(lead_id, summary) for lead-state changes."
3. DEDUPE: FTS similarity + exact-hash check; near-duplicates bump use_count instead of inserting.
4. CONTRADICTION PASS: new fact vs old fact on same entity → older row gets superseded_by set.
5. WRITE + rollup: append a one-paragraph "daily brief" note (feeds the weekly company report).
```

Budget guard: if the day's log exceeds ~8k tokens, the distiller first summarizes per-tool-group
then distills the summaries (two-stage). The distiller never invents facts; it only rewrites what
happened into retrievable statements.

### 10.3 Injection format (the memory header)

Every conversation start, JARVIS assembles a memory block and prepends it to the system prompt:

```
[MEMORY — auto-injected, treat as ground truth]
WHO YOU SERVE: <importance-5 identity rows, always>
ACTIVE THREADS: <top-3 entities by recency, with their 2 most important facts each>
PRINCIPAL PREFERENCES: <top-3 preferences, usage-weighted>
RELEVANT RECALL: <top-5 memories by retrieval score for the user's incoming message>
LESSONS THAT BIND: <top-2 lessons>
```

**Retrieval score** (on the incoming user message):
`score = 2.0·text_match(FTS) + 1.5·recency + 1.0·importance + 0.5·log(1+use_count)`

Hard budget: **500 tokens** of memory per turn. Anything cut is simply not shown — never
paraphrased on the fly. `last_used_at`/`use_count` update on every injection, so useful memories
strengthen and stale ones fade (a Hebbian rule in SQL).

### 10.4 Where OpenHuman plugs in

OpenHuman ships an **MCP stdio memory server that any other agent can read from** — that is the
official integration seam, and it lands in `jarvis.mcp.json` as a server named `openhuman-memory`:

```
Division of labor:
  JARVIS SQLite memories .... operational truth: leads, deals, quotes, tasks, dates
  OpenHuman (Neocortex) ..... human context: principal's habits, cross-app data from its
                              118+ integrations, long-horizon personal/company context
```

- The **distiller writes decisions and lessons twice**: locally (SQLite) and via OpenHuman's
  `remember` tool (context layer). Facts stay SQLite-only — operational truth must not depend on a
desktop app being open.
- **Recall**: injection step queries both stores; OpenHuman results enter the same scored pool
  tagged `source: openhuman` with confidence 0.7 (treat as context, not gospel).
- **Graceful degradation**: if the OpenHuman MCP server is down, JARVIS runs on SQLite memory and
  logs a warning. Memory must never become a single point of failure.
- **License note**: OpenHuman is GPL-3.0. Running it as a separate process behind MCP keeps IMT's
code clean — no linking, no vendoring.

### 10.5 Failure modes designed for

| Failure | Mitigation |
|---|---|
| Contradictory memories | distiller contradiction pass; newer supersedes, old kept for audit |
| Memory bloat | superseded rows pruned after 90 days; hard cap 5k rows before vector migration |
| Injection overload | 500-token budget, importance-weighted cut |
| OpenHuman down | SQLite-only mode (always functional) |
| Distiller hallucination | ops validated against log entities; unmatched entity names rejected |
| Privacy | `jarvis.data.sqlite` already git-ignored; OpenHuman is local-first by design |

---

## 11. CowAgent vs OpenHuman — head-to-head verdict

Both were researched for the same job: **the worker fleet under JARVIS's management.**

| Dimension | CowAgent (zhayujie) ⭐47k | OpenHuman (tinyhumansai) ⭐39.9k |
|---|---|---|
| Core identity | Agent **harness**: plans tasks, runs tools/skills, multi-agent teams, self-evolution | Personal AI: **memory-first** (Neocortex), agent fleets, workflows, deep research |
| Multi-agent | First-class: named agents with own roles collaborating on complex tasks | Fleet orchestration exists, but centered on one personal assistant |
| Worker ergonomics | Plugin architecture (chatgpt-on-wechat lineage), one-line installer, Docker compose, Windows support | Desktop app (Mac/Win/Linux); workflows more than headless workers |
| Channels | WeChat ecosystem roots + multi-channel; proven at serving IM channels | Desktop presence (voice, autocomplete), not IM-channel oriented |
| Memory | Long-term memory + self-evolution loop (v2.1.1+) | **The superpower**: structured local memory, MCP stdio server others read from, TokenJuice compression |
| Integrations | Models: mainstream providers; plugin ecosystem | **118+ OAuth integrations**, 20-min fetch loop |
| Deployment risk | Agent mode grants **bash/file tools** → must run sandboxed (Docker) | GPL-3.0 → keep as separate process (fine over MCP); needs desktop app running |
| Fit as *fleet* | ✅ designed for it | ⚠️ capable but it's a persona, not a department |
| Fit as *memory* | Good, but harness-coupled | ✅ best-in-class, and **exposes it over MCP** |

### Verdict

**CowAgent is the worker fleet. OpenHuman is the memory brain.** They were never really competing —
the research confirmed the jurisdiction split already sketched in §3:

- **CowAgent** gets the multi-agent roles (each a named worker: researcher, outreach drafter,
  report builder), Docker-sandboxed because of its system-level tools, registered in JARVIS's task
  table, dispatched and audited by JARVIS.
- **OpenHuman** sits beside the principal as the personal/company context engine, feeding JARVIS
  through its MCP memory server per §10.4 — not as a second assistant talking to IM channels.

One fleet, one brain, one memory — three processes, zero role overlap.

---

## 12. Decision rationale (recorded 2026-09-19)

1. **Channels: WhatsApp + Telegram.** WeChat's QR-login channel is fragile and carries ToS/ban
   risk for a business identity; Lark only pays off if the team already lives in it. Telegram's Bot
   API is a 30-minute integration and rock-solid for JARVIS-to-principal traffic. WeChat/Lark
   configs stay in the tree, dormant — enabling later is a config change, not a redesign.
2. **PC first, VPS in Wave 3.** The PC (Ryzen 5, ~7 GB RAM, currently 81% memory used) can host the
   dashboard + a couple of light containers now. But two services genuinely want a server: **OpenWA**
   (WhatsApp session must stay alive 24/7 — a sleeping PC means missed messages) and **BillionMail**
   (deliverability wants a stable IP + reverse DNS). Wave 3 migrates exactly those two to a cheap
   VPS; everything else stays local, matching the everything-on-my-PC requirement.
3. **Macro: skip.** It overlaps JARVIS's own dashboard (email/docs/tasks/CRM panels), is young,
   self-hosting Rust adds footprint, and its API/MCP story is unproven. Re-evaluate after Wave 3
   if team collaboration (beyond the principal) becomes real. OpenBB stays parked — no market-data
   need on the table.
4. **Approvals: medium.** Strict mode would make JARVIS annoying within days (approval for every
   reply), full autonomy on first contact is how you burn leads and reputation. Medium = autonomous
   for reads/records/drafts/replies-to-existing-contacts; approval gates for first contact with a
   new person, campaigns >5 recipients, issuing invoices, and any public post. Zones loosen by
   tracked exceptions, not vibes.
5. **Domain strategy (updated 2026-09-20): `info@imeantech.com` is the company's reputation
   asset — reserved for transactional mail (quotes, invoices, receipts) and consented marketing
   campaigns. Cold outbound does NOT run on it**; it requires 1–2 separate warmed domains
   (e.g. imeantech.co / tryimeantech.com) per §15.8. SMTP credentials go in `.env`, never in chat or git.

---

## 13. The Money Desk — invoices, receipts, M-Pesa, financial advice

> Design principle: **every shilling gets a story.** A payment that arrives with no story attached
> becomes a task, never a mystery. JARVIS doesn't just record money — he *reconciles*, *explains*,
> and *advises*. Wave placement: 2.5 (needs Wave 1 channels for receipt delivery + Wave 2 invoices).

### 13.1 Payment rails: getting M-Pesa into JARVIS

Two rails, in order of rollout:

**Rail A — SMS bridge (consumer path, start here).** M-Pesa confirmations arrive as SMS. An Android
forwarder app (Tasker / MacroDroid / an open-source SMS-gateway app) pushes every M-Pesa SMS to
`POST /api/webhooks/mpesa` with a shared-secret header. Requirements: token auth, HTTPS-only
(or LAN-only while on PC), raw SMS stored optionally and truncated (they carry financial data).

**Rail B — Daraja official API (business path, Wave 3+).** When IMT runs a Paybill/Till, Safaricom's
Daraja C2B confirmation webhooks become the official, tamper-proof feed — same parser, cleaner
data, no dependency on a phone staying online. The parser is written once; rails A and B feed it
the same normalized shape.

Parser output (normalized):
```json
{ "direction": "in|out", "type": "send|receive|paybill|till|withdraw|airtime",
  "amount": 5000, "currency": "KES", "counterparty": {"name": "JOHN DOE", "phone": "+2547xx"},
  "ref": "QGH7XYZ123", "balance": 42310, "occurred_at": "2026-09-19T14:22:05+03:00",
  "raw": "SAF M-PESA confirmation..." }
```

### 13.2 The ledger (new table, same SQLite)

```sql
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'KES',
  tx_type TEXT,
  counterparty TEXT,
  counterparty_phone TEXT,
  category TEXT,                 -- utilities|salary|hardware|transport|fees|... (JARVIS-assigned)
  source TEXT NOT NULL DEFAULT 'mpesa',  -- mpesa|bank|manual|invoice
  ref TEXT,
  linked_doc INTEGER,            -- documents.id when reconciled to an invoice
  raw_sms TEXT,                  -- optional, truncated
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Categorization is a memory-brain citizen.** First pass: keyword map ("KPLC"→utilities). Every
correction you make in the weekly review becomes a **lesson memory** (§10) — the classifier improves
from your habits instead of a config file. Outgoing M-Pesa fees auto-tag as `fees` (they add up;
JARVIS reports them monthly).

### 13.3 Invoice → payment → receipt state machine (the reconciliation engine)

```
DRAFT ──approve──▶ SENT ──payment──▶ PAID ──auto──▶ RECEIPTED
                       │                              │
                       ├──part payment──▶ PARTIAL ────┤  (receipt per installment)
                       └──14/30/60 days──▶ OVERDUE ──▶ reminder tasks + aging report
```

Matching rules, in confidence order:
1. **Phone + amount match** on an open invoice → auto-reconcile (confidence high).
2. **Amount match within window** (30 days) where client phone is known from CRM → auto-reconcile.
3. **Amount-only match, ambiguous** → JARVIS asks you in chat: "KES 5,000 from +2547xx — Acme's
   QTE-2026-0004?" One tap resolves; the pairing is remembered.
4. **No match** → `unidentified_payment` task + a WhatsApp question. Never guessed.

On reconcile → receipt `RCP-2026-####` is generated (same PDF layer as invoices), marked against the
invoice, and delivered **via WhatsApp (OpenWA) + email (BillionMail transactional)** — notify-then-act
zone, since it's an existing client relationship. Partial payments emit receipts per installment and
keep the invoice in PARTIAL until settled.

### 13.4 The advice engine (analysis, not fortune-telling)

JARVIS's money briefings are built from the ledger, invoices, and quotes — every number traceable:

| Briefing | Content | Cadence |
|---|---|---|
| **Money minute** | cash in/out this week, receivables total, anything overdue, unusual spend vs 4-week baseline | daily, 08:00, WhatsApp + HUD |
| **Cashflow review** | monthly chart, category breakdown, runway estimate (months at current burn), M-Pesa fee total | monthly |
| **Receivables aging** | unpaid invoices by age buckets; suggested reminder messages ready to send | weekly |
| **Deal profitability** | quoted price vs. logged project expenses (transactions linked to a project/client) | per project close |
| **Tax provisioning** | "set aside ~X% of this month's revenue" suggestion based on your declared rate; informational only | monthly |

Advice rules live in the system prompt's money section + a `financial_status` built-in tool (computes
all of the above in one call so JARVIS never does arithmetic in his head). Standing orders he can
act on: auto-remind overdue invoices (approval zone: draft always, send needs your yes per medium
policy), flag any expense >KES threshold same-day, and warn when balance < upcoming known obligations.

Honesty boundary: JARVIS gives analysis and recommendations; he says "consider" not "do", and tax
outputs are informational, not filing advice.

### 13.5 The Iron Man money experience (MARK I money desk)

- **Power-reserves ring** — the arc reactor gains a cash gauge: current balance as % of your
  3-month comfort level. Green ≥100%, amber 50–99%, red <50%. "Power reserves at 62%, sir."
- **Voice money briefings** — "JARVIS, financial status" → spoken 20-second briefing, same data as
  the Money minute. Morning boot sequence now ends with reserves + anything overdue.
- **Alert chimes** — payment received (soft chime + green pulse on the reactor), overdue crossed
  (amber pulse), unidentified payment (red pulse + question in chat).
- **Ledger panel** — live transactions feed in the HUD, category-colored; click a transaction → the
  story (invoice, client, notes). Money panels follow the existing scanline aesthetic; no graphs
  that lie — every chart derives from the ledger.

### 13.6 Wave 2.5 checklist (what gets built, in order)

1. `transactions` table + `/api/webhooks/mpesa` (auth, parse, store) + Android forwarder configured.
2. `financial_status` tool + Money minute briefing + HUD ledger panel.
3. Reconciliation engine (matching rules 1–4) + receipt numbering + receipt PDF.
4. Receipt delivery over WhatsApp/email (Wave 1 dependency), reminders for overdue invoices.
5. Voice briefings + reactor cash gauge (the Iron Man layer).
6. Later: Daraja Rail B when the Paybill exists; bank statements CSV import as `source: bank`.

---

## 14. The Revenue Engine — the mission layer

> **The mission:** KES 400,000 revenue in Q4 2026 (Oct–Dec), and a north star of **1,000,000 active
> clients/users** across all IMT products. Starting point: **zero active clients.** JARVIS is not a
> passive tool — he carries the quota, runs the loops, and reports pace like a growth officer.

### 14.1 The honest math (two clocks, one system)

**Clock 1 — Q4 cash target (KES 400k in ~90 days ≈ KES 4,450/day):**

| Route | Unit economics | Required in Q4 |
|---|---|---|
| Services (primary cash) | avg project KES 40,000 | **10 projects** (~3–4/month) |
| SaaS (seeds the compounding asset) | avg KES 1,000/user/month | **~100 paying users by Dec** |
| Blend (recommended) | 70% services / 30% SaaS | 8–9 projects + 40–50 users |

Pipeline math behind 10 service projects: at a 15% close rate on qualified leads →
**~67 qualified leads in Q4 → ~5/week**. With Wave 2 tooling (theHarvester + OpenOutreach + orca +
BANT scoring) the *prospecting volume is trivially sustainable* — the bottleneck is the principal's
meetings and delivery capacity. The system is designed around that truth: JARVIS fills the top of
the funnel and preps everything below it.

**Clock 2 — 1M users (multi-year, loop-driven):** no company goes 0→1M in a quarter; the honest
decomposition is **100 users (Q4) → 10k (2027, product-led loops + PMF) → 100k (2028) → 1M (2029+)**.
What JARVIS does now is build the machine that compounds: distribution loops, activation, retention
instrumentation. The Q4 SaaS cohort of ~100 users *is the first rotation of that machine* — users,
feedback, testimonials, referral seeds.

### 14.2 Revenue Command (new subsystem, slots into Wave 2)

New tables:
```sql
CREATE TABLE goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,              -- "Q4 revenue", "100 SaaS users"
  metric TEXT NOT NULL,            -- 'revenue_kes' | 'active_users' | 'mrr_kes' | 'projects_won'
  target REAL NOT NULL,
  period_start TEXT NOT NULL, period_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE metric_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric TEXT NOT NULL, value REAL NOT NULL,
  taken_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`revenue_status` built-in tool (single call, zero mental arithmetic):
earned vs target, days left, **required daily rate**, pace delta (ahead/behind %), pipeline value,
forecast, per-product split, and the 3 highest-leverage actions today.

**Standing revenue behavior:**
- **Daily 08:00 Money Minute now includes the mission line:** "Q4 pace: KES 118k of 400k — 12%
  behind. Required rate: KES 5,100/day. Levers today: 2 proposals pending (follow up), 11 new
  leads to contact, 3 SaaS trial users to activate."
- **Weekly growth review (auto-generated):** funnel conversion rates, channel report, what moved
  the number last week, proposed plan for next week. The principal approves; JARVIS executes.
- **Arc reactor gains mission mode:** a progress ring around the reactor showing Q4 target
  completion — the daily visual of "are we winning." Green pulse when ahead, amber behind.
- **Win/chime events:** project won → chime + ledger entry + case-study task created. User #100 →
  milestone event.

### 14.3 The four growth loops JARVIS runs

1. **Outbound loop** (Wave 2 as designed): harvest → enrich → qualify (BANT) → first-touch →
   follow-up sequence → meeting → quote → invoice → receipt. Every turn logged; weekly conversion
   report per channel. This is the *cash* loop.
2. **Content loop**: ScrapeCreators skills detect what's working in the niche → JARVIS drafts
   posts/threads (approval zone) → social MCP publishes to LinkedIn/TikTok/IG/FB → engagement data
   back into memory → next week's content is smarter. This is the *audience* loop — the top of the
   1M funnel.
3. **Activation loop (SaaS)**: every signup gets a WhatsApp onboarding sequence from JARVIS via
   OpenWA (day 0 welcome, day 1 first-value nudge, day 3 check-in, day 7 upgrade ask). Trial→paid
   conversion is a metric JARVIS owns and reports. This is the *users* loop.
4. **Referral loop**: from user #1, JARVIS issues referral codes, tracks who brought whom (K-factor),
   and runs referral pushes when a user hits their aha-moment (usage trigger). Referrers get
   credits/months-free — JARVIS manages the ledger of rewards. This is the *compounding* loop.

Loops report weekly: which loop produced what. Budget attention accordingly.

### 14.4 Client-Zero plan (the immediate playbook — before any wave machinery)

You can't run loops with zero users, so week one is the **first-10-clients sprint**, JARVIS-assisted:

1. **Define two service offers** with fixed scope + price (JARVIS drafts the offer sheets and PDF
   proposals from the ai-sales-team skills). Offers sell faster than "we do IT."
2. **Build the first 200-company prospect list** (theHarvester + manual seeds; scored, filed as leads).
3. **Warm channel:** principal's personal WhatsApp/LinkedIn status + existing network — JARVIS
   drafts the announcement, you send it from your own account (never blast cold on day one).
4. **SaaS beta cohort:** recruit 20–50 beta users (free/discounted) from the same audience; their
   job is feedback + 3 testimonials. JARVIS interviews them over WhatsApp and files notes.
5. **Proof flywheel:** every delivered project → case study + testimonial task; JARVIS drafts both
   from the project notes. Proof compounds into the content loop.

### 14.5 What JARVIS does daily for revenue (standing orders)

| When | Action | Zone |
|---|---|---|
| 08:00 | Money Minute + mission pace + today's levers | autonomous |
| 08:00 | Yesterday's new leads scored, follow-ups due today listed | autonomous |
| 09:00 | Outreach batch: N first-touches + M follow-ups (drafted or sent per policy) | notify/approve |
| Continuous | Every inbound (WhatsApp/Telegram/email) checked against CRM; qualifying questions asked in-conversation | autonomous (existing contacts) |
| 17:00 | EOD pipeline delta: anything won/lost/stalled + tomorrow's plan | autonomous |
| Weekly | Growth review + content plan + receivables aging + goal forecast | approval for plan execution |
| Monthly | Revenue report PDF: revenue by line, loop performance, runway, next-month plan | autonomous (report), approval (plan) |

### 14.6 Honest risks (stated plainly)

1. **Cold start is the whole game.** Tools fill funnels; they don't close deals. The principal owns
   meetings and delivery. JARVIS maximizes your hit rate per hour, not replaces your hours.
2. **Capacity ceiling on services.** If projects consume all working hours, SaaS starves. The design
   answer: cap services at ~2 concurrent projects in Q4; ring-fence SaaS hours.
3. **1M needs PMF first.** Loops amplify what exists; if the SaaS isn't retaining users, JARVIS
   will say so (churn in the weekly report) — the system surfaces truth early.
4. **Spread too thin.** Four loops + waves + money desk is a lot. Sequencing rule stands: Wave 1
   channels → client-zero sprint (immediate, no waves needed) → Wave 2 marketing + revenue command
   → loops 3 & 4 once there are users to loop.
5. **Metric honesty.** "Active" is defined as: logged in / transacted / messaged within 30 days.
   JARVIS reports active, not cumulative signups. No vanity numbers in this house.

---

## 15. The Outbound Engine — volume without burnout, bans, or spam folders

> **Principle: JARVIS never gets tired — so the design must supply the judgment a tired human
> would have.** Volume is a physics problem: every platform punishes naive blasting and rewards
> disciplined cadence. This section is how we send a *lot* without killing the domain, the
> LinkedIn account, or IMT's reputation.

### 15.1 Two email engines, two rails (never confused)

| | **Cold outbound** (prospecting) | **Marketing campaigns** (audience) |
|---|---|---|
| Audience | targeted prospects, 1:1 researched | opted-in list: leads, clients, beta users, newsletter |
| Rail | mailbox fleet, sequenced steps | BillionMail broadcasts + newsletters |
| Volume shape | tens per day per mailbox | thousands per send (to opt-ins) |
| Personalization | deep (research-driven) | segmented, template + merge fields |
| Lawful basis | legitimate interest (B2B) | consent (opt-in), one-click unsubscribe |
| Owner in stack | OpenOutreach + JARVIS compose | BillionMail |

Both write to the same CRM; the `leads.source` field says which engine produced each contact.

### 15.2 The mailbox fleet (cold outbound capacity math)

Cold deliverability is earned per-domain, per-mailbox. The fleet grows by **adding mailboxes, never
by raising caps**:

| Stage | Mailboxes | First-touches/day | Weekly first-touches | Notes |
|---|---|---|---|---|
| Warm-up (wk 1–2) | 1 | 5→15 | ~50 | SPF/DKIM/DMARC set, inbox placement tested |
| Ramp (wk 3–4) | 2 | 30 | ~250 | second domain added as backup |
| Cruise (month 2) | 3 | 100 | ~500 | templates A/B tested, kill-switches armed |
| Scale (month 3) | 5 | 200 | ~1,000+ | rotation + reply handling fully automated |

Caps per mailbox: **≤50 first-touches/day, ≤120 total touches/day**, business hours of the
recipient's timezone. With 4–7 step sequences, cruise stage = **~2,000+ touches/week** — at even a
1.5% qualified rate that's ~30 qualified leads/week, overshooting the Q4 target 5×. That overshoot
is deliberate: quality stays high (JARVIS personalizes from research data) because volume headroom
exists.

### 15.3 The sequence machine

Every prospect enters a default 4-step sequence (day 0 / 3 / 7 / 14), stored in an
`outreach_queue` table — every touch is a scheduled row, auditable, pausable:

```sql
CREATE TABLE outreach_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  channel TEXT NOT NULL,            -- email|linkedin|telegram|whatsapp|x
  step INTEGER NOT NULL,            -- sequence step
  template TEXT,
  scheduled_for TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', -- queued|sent|replied|bounced|skipped|paused
  sent_at TEXT, reply_at TEXT,
  approval_required INTEGER NOT NULL DEFAULT 0
);
```

- **Personalization injection:** each step pulls from the lead's research record (OpenOutreach
  reasoning, orca profile insights, theHarvester intel) — no "Dear Sir/Madam" ever leaves the house.
- **Stop rules:** reply → sequence stops instantly → reply classifier takes over.
- **A/B testing:** subject lines and openers rotate per 50-send batch; winners inherit the list.
- **Kill-switches (automatic):** template reply rate <0.5% after 200 sends → paused + flagged.
  Bounce rate >3% or spam complaint >0.1% on a mailbox → that mailbox paused, JARVIS investigates
  before resuming. Global pause: one command ("JARVIS, pause all outreach") or the HUD button.

### 15.4 Reply handling (where leads are won)

Every reply is classified within minutes, 24/7:

| Class | JARVIS action |
|---|---|
| Interested / question | **hot lead alert** to your WhatsApp + Telegram within minutes; qualifies with BANT questions in-thread; drafts meeting times |
| Not now | schedule re-touch in 60–90 days, note the reason |
| Not interested | stop all sequences, log objection (feeds copy improvements) |
| Wrong person | ask for a referral to the right person, restart sequence on reply |
| Out of office | schedule restart on return date |
| Unsubscribe | **suppression list, permanent, cross-channel, enforced everywhere** — non-negotiable |

### 15.5 LinkedIn & business-platform DMs — the tiered doctrine

LinkedIn automation at volume is how accounts die; the mission dies with them. Doctrine: **match
automation level to what each platform sanctions.**

| Tier | Platforms | Policy |
|---|---|---|
| **Tier 1 — full auto** | Email (own domain), Telegram, WhatsApp Business | sequenced, unlimited-ish per caps, 24/7 |
| **Tier 2 — semi-auto** | LinkedIn, X, Instagram DMs | JARVIS researches + drafts every DM and connection note; **you tap send** from the approval queue (HUD or WhatsApp). Caps: ≤20 connects/day, ≤15 DMs/day, human-speed pacing |
| **Tier 3 — content-led** | LinkedIn feed, TikTok, IG, FB, X | no DMs; the content loop does the work; inbound DMs get full JARVIS handling (Tier 1 for replies to *their* messages) |

LinkedIn specifically: posting cadence 3–5/week via the content loop; connection requests with
personalized notes at human speeds; DMs only after acceptance, referencing their content or profile
(research from orca/linkedin-mcp). The approval queue makes this ~2 minutes of your day — JARVIS
queues 15 drafted sends, you swipe through with morning coffee. When a lead replies anywhere,
conversation continues at full speed — **replies are always Tier 1, initiations respect tiers.**

Every platform touch still lands in `outreach_queue` and the CRM — the funnel never fragments.

### 15.6 Compliance & reputation guardrails (Kenya DPA 2019 + deliverability)

- One-click unsubscribe in every marketing email; cold email includes opt-out line; both feed the
  same **suppression list** enforced across every channel and engine.
- B2B legitimate-interest basis documented per campaign; data minimized (store what the funnel needs).
- Weekly domain health report: postmaster reputation, bounce/complaint rates, inbox-placement
  seed test. Domains rotate in when warmed, out when tired.
- No purchased blast lists, ever. Lists come from research (theHarvester/OpenOutreach) or opt-ins.

### 15.7 What "never tired" looks like in practice

Day in the life of the engine: 06:00 — due touches sent to recipient-morning timezones. 09:00 —
you wake to: 2 hot leads, 12 DM drafts queued for approval, mailbox report all-green. 14:00 — a
reply lands; JARVIS qualifies in-thread before you've seen it; meeting proposed. 17:00 — EOD:
87 touches sent, 6 replies (4 hot), sequence adjustments applied. Midnight — tomorrow's queue built.

The human does: approvals (2 min), hot-lead conversations, meetings, closing. Everything else —
hunting, drafting, scheduling, following up 7 times, classifying, recording — is JARVIS's shift,
and it's 24/7.

### 15.8 The imeantech.com SMTP setup (decision + volume physics)

**Mailbox roles (locked):**

| Mailbox | Role | Engine | Volume shape |
|---|---|---|---|
| `info@imeantech.com` | Transactional + consented marketing: quotes, invoices, receipts, newsletters to opt-ins | BillionMail (SMTP relay) | bursts to opt-in list, reputation protected |
| `hello@imeantech.com` (optional split) | inbound replies/community | — | — |
| Cold fleet mailboxes on 1–2 secondary domains (§15.2) | prospecting | OpenOutreach + sequence machine | ≤50 first-touches/day per mailbox |

**Volume physics for `info@imeantech.com` (the honest numbers):**
- Self-hosted SMTP (BillionMail) on a fresh VPS IP starts from **zero reputation**, regardless of
  how good the content is. Warm-up: 20–50/day → double every 2–3 days → steady state
  **~500–1,000/day within ~4–6 weeks**, higher if engagement stays clean (opens/replies, low bounces).
- "Send as many as possible" therefore means: **as many as the reputation earns** — which is how
  the big senders actually operate. Gmail/Microsoft don't count ambition; they count bounce,
  complaint, and engagement signals per domain+IP.
- Marketing sends to the opt-in list are effectively **unlimited in list size** (they're consented);
  the daily cap applies to *new acquisition* (cold) traffic only.
- Google/Yahoo bulk-sender rules apply at 5,000/day: one-click unsubscribe + aligned DMARC become
  mandatory — the design already includes both.

**Setup checklist when SMTP details are shared:**
1. DNS on imeantech.com: SPF including the VPS IP, DKIM keys from BillionMail, DMARC
   `p=quarantine` → later `p=reject`, custom tracking domain, MX + return-path alignment.
2. SMTP credentials → `.env` only (JARVIS_BACKEND never logs them; `.gitignore` already covers).
3. Warm-up schedule runs through BillionMail (starts at 20–50/day, engagement-gated).
4. Seed-test inbox placement (gmail/outlook/yahoo) before first real campaign.
5. Cold fleet domains get identical DNS treatment — never share the main domain's reputation.

**Messages (WhatsApp/Telegram/LinkedIn):** governed by §15.5 tiers — WhatsApp Business follows
Meta quality-rating rules (template quality, opt-outs honored, start ~250 unique recipients/day,
scales with rating); Telegram DMs are uncapped technically but conversation-rate-governed;
LinkedIn stays semi-auto per doctrine. "As many as possible" across all channels = the sum of
each channel's maximum *sustainable* rate, which the kill-switches (§15.3) enforce automatically.

**Bottom line:** with imeantech.com handling transactional + opt-in marketing, and a 5-mailbox cold
fleet on secondary domains by month 3, the combined sustainable outbound is **~2,000 cold touches +
1,000 marketing sends + all transactional mail per day** — and every number above rises as the
reputation metrics prove IMT deserves it. The engine scales by earning, not by hoping.
