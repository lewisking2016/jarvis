#!/usr/bin/env node
/** Attach jarvis.imeantech.com to the jarvis project + show required DNS. Run: node deploy/vercel-domain.mjs */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const token = JSON.parse(
  fs.readFileSync(path.join(os.homedir(), "AppData", "Roaming", "com.vercel.cli", "Data", "auth.json"), "utf8")
).token;
const teamId = "team_NwccVcRnmhZx1iXdZKjKoa1L";
const projectId = "prj_1yXRJdEhcWn6DvK0Jo9b2S7AJNcE";
const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
const qs = `?teamId=${teamId}`;

const r = await fetch(`https://api.vercel.com/v9/projects/${projectId}/domains${qs}`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({ name: "jarvis.imeantech.com" }),
});
const j = await r.json();
console.log("attach →", r.status);
console.log(JSON.stringify(j, null, 1).slice(0, 1200));

const v = await fetch(`https://api.vercel.com/v9/projects/${projectId}/domains/jarvis.imeantech.com${qs}`, { headers: H });
const vj = await v.json();
console.log("verified:", vj.verified, "| configured:", JSON.stringify(vj.configuredIn ?? null));
