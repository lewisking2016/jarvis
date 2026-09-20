#!/usr/bin/env node
/**
 * Disable Vercel "Deployment Protection" (SSO interstitial) on the jarvis project —
 * the dashboard must be publicly reachable. Uses the CLI's stored auth token.
 * Run: node deploy/vercel-unprotect.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const candidates = [
  path.join(os.homedir(), "AppData", "Roaming", "com.vercel.cli", "Data", "auth.json"),
  path.join(os.homedir(), ".vercel", "auth.json"),
  path.join(os.homedir(), "AppData", "Local", "com.vercel.cli", "auth.json"),
  path.join(os.homedir(), ".local", "share", "com.vercel.cli", "auth.json"),
];
let token = null;
for (const p of candidates) {
  if (fs.existsSync(p)) {
    try {
      token = JSON.parse(fs.readFileSync(p, "utf8")).token;
      console.log("token file:", p);
      break;
    } catch {}
  }
}
if (!token) { console.error("No Vercel CLI token found in", candidates.join(", ")); process.exit(1); }

const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

// find the team (personal workspace) that owns the project
const teamsRes = await fetch("https://api.vercel.com/v2/teams?limit=20", { headers: H });
const teams = (await teamsRes.json()).teams ?? [];
const team = teams.find((t) => /lewis/i.test(t.name ?? t.slug ?? ""));
const qs = team ? `?teamId=${team.id}` : "";
console.log("team:", team ? `${team.name} (${team.id})` : "(personal account — no teamId)");

// locate the project
let project = null;
for (const slug of ["jarvis"]) {
  const r = await fetch(`https://api.vercel.com/v9/projects/${slug}${qs}`, { headers: H });
  if (r.ok) { project = await r.json(); break; }
}
if (!project) { console.error("project 'jarvis' not found"); process.exit(1); }
console.log("project:", project.name, project.id);

// disable standard/sso deployment protection (try both API shapes)
for (const body of [
  { ssoProtection: null },
  { deploymentProtection: { enabled: false } },
  { passwordProtection: null },
]) {
  const r = await fetch(`https://api.vercel.com/v9/projects/${project.id}${qs}`, {
    method: "PATCH",
    headers: H,
    body: JSON.stringify(body),
  });
  console.log(`PATCH ${Object.keys(body)[0]} →`, r.status, r.ok ? "OK" : (await r.text()).slice(0, 120));
}

// verify current settings
const v = await fetch(`https://api.vercel.com/v9/projects/${project.id}${qs}`, { headers: H });
const pj = await v.json();
console.log("ssoProtection now:", JSON.stringify(pj.ssoProtection ?? null));
console.log("deploymentProtection now:", JSON.stringify(pj.deploymentProtection ?? null));
