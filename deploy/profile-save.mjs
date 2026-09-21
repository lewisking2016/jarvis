#!/usr/bin/env node
/** Save the principal's profile answers + dry-run the brief via the live ops API. */
const BASE = "https://jarvis.imeantech.com";

const patch = {
  payment: {
    paybill: "",
    till: "",
    terms: "50% deposit to commence, balance on delivery. Pay via Equity Bank transfer (LEWIS NDUNG'U KINAGA, 0340184547442) or M-Pesa 0114971070.",
  },
  targets: { revenue_quarter_kes: 400000 },
  principal: {
    name: "Lewis",
    title: "Principal, IMT General System",
    style_notes:
      "Busy executive; speaks in short free-form directives mixing English, Swahili and Sheng; expects execution, not questionnaires.",
  },
};

const r = await fetch(`${BASE}/api/ops`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ op: "save_profile", patch }),
});
const j = await r.json();
console.log("profile save:", r.status, j.ok ? "OK" : JSON.stringify(j).slice(0, 200));

const b = await fetch(`${BASE}/api/ops`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ op: "morning_brief", dry: true }),
});
const bj = await b.json();
console.log("brief dry-run:", b.status);
console.log(bj.brief ?? JSON.stringify(bj).slice(0, 300));
console.log("PROFILESAVE_DONE");
