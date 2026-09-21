#!/usr/bin/env node
/**
 * MESSY-DIRECTIVE GAUNTLET — 10 real-world directives (slang, Sheng, partial
 * details, mixed languages) fired at the LIVE site. Captures per-turn:
 * brain, tools fired, reply text, latency. Verdict heuristics per directive.
 * Test data is tagged TESTGX for later cleanup.
 *
 * Run: node deploy/gauntlet.mjs
 */
const BASE = "https://jarvis.imeantech.com";

const CASES = [
  {
    tag: "G1", kind: "invoice", expect: /create_document/,
    msg: "yo raise an invoice for TESTGX Wanjala Mtaani, 2 wifi routers ksh 4,500 kila moja, anabeba leo",
    check: (t, tools) => tools.includes("create_document") && /Wanjala/i.test(t),
  },
  {
    tag: "G2", kind: "quote", expect: /create_document/,
    msg: "QuoteTESTGX Skyline Salon: 3 hair dryers 7,200 each na 2 mirrors 11k, VAT 16%, do a quote",
    check: (t, tools) => tools.includes("create_document") && /43,744|43,7/.test(t), // 3*7200+2*11000=43600 *1.16=43776 → tolerate rounding
  },
  {
    tag: "G3", kind: "payment", expect: /record_payment/,
    msg: "TESTGX Kuna malipo ya 12,500 from Rafiki Prints via M-Pesa leo asubuhi, ref RP-881",
    check: (t, tools) => tools.includes("record_payment"),
  },
  {
    tag: "G4", kind: "lead", expect: /add_lead/,
    msg: "Ongeza TESTGX mpya kwa pipeline: Njeri Auto Garage, mtu wake Brian, phone 0720-000-G4",
    check: (t, tools) => tools.includes("add_lead") && /Njeri/i.test(t),
  },
  {
    tag: "G5", kind: "research", expect: /search_web|research|web/,
    msg: "Jarvis do some quick researchTESTGX: best-selling CCTV brands in Kenya right now, one paragraph",
    check: (t) => t.length > 120,
  },
  {
    tag: "G6", kind: "email", expect: /send_email|outreach/,
    msg: "Send TESTGX email to info@imeantech.com subject 'Pipeline check' body just say testing 1-2-3, from the marketing box",
    check: (t, tools) => /send_email|outreach/.test(tools.join(",")),
  },
  {
    tag: "G7", kind: "mixed", expect: /create_document/,
    msg: "TESTGX receipt for Mama Njeri Canteen — amelipa 8,000 cash for the CCTV install, make it a receipt",
    check: (t, tools) => tools.includes("create_document") && /8,000|8000/.test(t),
  },
  {
    tag: "G8", kind: "followup", expect: /add_task|follow/,
    msg: "Nikumbuishe TESTGX kufollow up Nile Supply kesho saa tatu — put it as a task",
    check: (t, tools) => /add_task|create_task|follow/.test(tools.join(",")) || /follow/i.test(t),
  },
  {
    tag: "G9", kind: "status", expect: null,
    msg: "Bratha Jarvis hesabu TESTGX: ngapi invoices ziko open na pesa ngapi iko outstanding? summary fupi",
    check: (t) => t.length > 60 && /KES|kwa|invoice/i.test(t),
  },
  {
    tag: "G10", kind: "profile", expect: /update_profile/,
    msg: "Remember TESTGX: our new warranty policy ni months 12 for all CCTV installs",
    check: (t, tools) => tools.includes("update_profile") || /warranty|12/i.test(t),
  },
];

async function turn(msg) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: msg, history: [] }),
    signal: AbortSignal.timeout(170000),
  });
  let text = "", provider = "", tools = [];
  for (const l of (await r.text()).split("\n")) {
    if (!l.startsWith("data: ")) continue;
    try {
      const e = JSON.parse(l.slice(6));
      if (e.type === "tool_start") tools.push(e.name);
      if (e.type === "done") { text = e.text || ""; provider = e.provider || ""; }
    } catch {}
  }
  return { text, provider, tools, ms: Date.now() - t0 };
}

const results = [];
for (const c of CASES) {
  process.stdout.write(`${c.tag} (${c.kind}) → `);
  let r;
  try { r = await turn(c.msg); } catch (e) { r = { text: "", provider: "ERR:" + e.message, tools: [], ms: 0 }; }
  const ok = c.check(r.text, r.tools);
  results.push({ ...c, ...r, ok });
  console.log(`${ok ? "PASS" : "FAIL"} | ${r.provider} | ${(r.ms / 1000).toFixed(1)}s | tools: ${r.tools.join(",") || "none"}`);
  if (!ok) console.log("   reply:", r.text.slice(0, 200).replace(/\n/g, " / "));
  await new Promise((res) => setTimeout(res, 1500));
}
console.log("\n═══ GAUNTLET ═══");
const pass = results.filter((r) => r.ok).length;
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.tag} ${r.kind.padEnd(9)} ${(r.ms / 1000).toFixed(1)}s  ${r.provider.slice(0, 40)}`);
console.log(`\n${pass}/10 PASS`);
console.log("GAUNTLET_DONE");
