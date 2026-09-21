#!/usr/bin/env node
/** End-to-end live test through the PUBLIC site: brain chat + tool execution. Run: node deploy/test-live-public.mjs */
import fs from "node:fs";

const BASE = "https://jarvis.imeantech.com";

// 1. plain chat
const t0 = Date.now();
const res = await fetch(`${BASE}/api/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: "Say exactly: LIVE_OK" }),
  signal: AbortSignal.timeout(110000),
});
console.log("chat HTTP:", res.status, `(${Math.round((Date.now() - t0) / 1000)}s)`);

const out = await res.text();
let provider = "", failovers = [], text = "";
for (const line of out.split("\n")) {
  if (!line.startsWith("data: ")) continue;
  try {
    const e = JSON.parse(line.slice(6));
    if (e.type === "provider") provider = e.provider;
    if (e.type === "failover") failovers.push(`${e.from}→${e.to}`);
    if (e.type === "done") { text = e.text || text; provider = e.provider || provider; }
  } catch {}
}
console.log("brain:", provider || "(none)");
console.log("failovers:", failovers.length ? failovers.join(" | ") : "none");
console.log("answer:", (text || "").slice(0, 120).replace(/\n/g, " ") || "(empty)");

// 2. tool-execution probe (create a lead through JARVIS himself)
const t1 = Date.now();
const res2 = await fetch(`${BASE}/api/chat`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    message: "Create a lead named LiveSite Probe with email liveprobe@example.com and phone 0712345678.",
  }),
  signal: AbortSignal.timeout(110000),
});
const out2 = await res2.text();
let tools = [], p2 = "";
for (const line of out2.split("\n")) {
  if (!line.startsWith("data: ")) continue;
  try {
    const e = JSON.parse(line.slice(6));
    if (e.type === "tool") tools.push(e.name || e.tool || "?");
    if (e.type === "done") p2 = e.provider || "";
  } catch {}
}
console.log("\ntool test:", tools.length ? `executed [${tools.join(", ")}] via ${p2} (${Math.round((Date.now() - t1) / 1000)}s)` : "NO TOOL FIRED");

// 3. verify + clean up the probe lead
const docs = await (await fetch(`${BASE}/api/leads`)).json();
const leads = docs.leads ?? docs;
const probe = (Array.isArray(leads) ? leads : []).find((l) => l.email === "liveprobe@example.com");
if (probe) {
  const del = await fetch(`${BASE}/api/leads`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: probe.id }),
  });
  console.log("probe lead verified in DB and cleaned up (DELETE", del.status + ")");
} else {
  console.log("probe lead: not found in list (tool may store async)");
}

console.log("\nLIVE_TEST_DONE");
