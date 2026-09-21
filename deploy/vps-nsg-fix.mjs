#!/usr/bin/env node
/** Try to reopen NSG port 8080 via the VM's managed identity (IMDS token → Azure REST).
 *  Falls back with clear guidance if the VM has no identity/permission.
 *  Run: node deploy/vps-nsg-fix.mjs */
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const _s = require("ssh2");
const SSHClient = _s.Client || _s.default || _s;

let HOST = "172.209.208.171", USER = "jarvis", PASS = "";
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^(JARVIS_VPS_(HOST|USER|PASS))=(.*)$/);
  if (!m) continue;
  if (m[2] === "HOST") HOST = m[3].trim();
  else if (m[2] === "USER") USER = m[3].trim();
  else if (m[2] === "PASS") PASS = m[3].trim();
}

const SUB = "95f3064f-112d-4ca7-b861-10ea1834c7bd"; // Azure for Students (from portal)
const RG = "LEWIS_GROUP";

const conn = new SSHClient();
await new Promise((res, rej) => conn.on("ready", res).on("error", rej).connect({
  host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 25000, keepaliveInterval: 10000,
}));

const exec = (cmd, timeout = 90000) => new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error("timeout")), timeout);
  conn.exec(cmd, (err, stream) => {
    if (err) { clearTimeout(to); return rej(err); }
    let out = "";
    stream.on("data", (d) => (out += d));
    stream.stderr.on("data", (d) => (out += d));
    stream.on("close", () => { clearTimeout(to); res(out); });
  });
});

try {
  // 1. IMDS token — proves a managed identity exists on this VM
  console.log("=== 1. managed identity token ===");
  const tokRaw = await exec(
    `curl -s -m 10 -H Metadata:true "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fmanagement.azure.com%2F"`,
  );
  let token = "";
  try { token = JSON.parse(tokRaw).access_token || ""; } catch {}
  if (!token) {
    console.log("NO_MANAGED_IDENTITY:", tokRaw.slice(0, 200));
    console.log("\n>>> FALLBACK: need portal click or az login. Exiting.");
    process.exit(2);
  }
  console.log("token acquired, length", token.length);

  // 2. Find the NIC's NSG
  console.log("\n=== 2. locating NSG ===");
  const listRaw = await exec(
    `curl -s -m 20 -H "Authorization: Bearer ${token}" "https://management.azure.com/subscriptions/${SUB}/resourceGroups/${RG}/providers/Microsoft.Network/networkSecurityGroups?api-version=2023-09-01"`,
  );
  let nsgName = "";
  try {
    const list = JSON.parse(listRaw);
    if (list.error) { console.log("LIST_ERROR:", JSON.stringify(list.error).slice(0, 300)); process.exit(3); }
    nsgName = list.value?.[0]?.name || "";
    console.log("NSGs found:", (list.value || []).map((n) => n.name).join(", ") || "none");
  } catch (e) {
    console.log("PARSE_FAIL:", listRaw.slice(0, 300));
    process.exit(3);
  }
  if (!nsgName) { console.log("no NSG in", RG); process.exit(3); }

  // 3. Read current rules
  console.log("\n=== 3. current rules on", nsgName, "===");
  const getRaw = await exec(
    `curl -s -m 20 -H "Authorization: Bearer ${token}" "https://management.azure.com/subscriptions/${SUB}/resourceGroups/${RG}/providers/Microsoft.Network/networkSecurityGroups/${nsgName}?api-version=2023-09-01"`,
  );
  let rules = [];
  let nsgEtag = "";
  try {
    const nsg = JSON.parse(getRaw);
    nsgEtag = nsg.etag || "";
    rules = nsg.properties?.securityRules || [];
    for (const r of rules) {
      console.log(` - ${r.name}: ${r.properties.direction} ${r.properties.protocol} ${r.properties.sourcePortRange}->${r.properties.destinationPortRange} ${r.properties.access} prio:${r.properties.priority}`);
    }
  } catch { console.log("get failed:", getRaw.slice(0, 200)); }

  const has8080 = rules.some(
    (r) => r.properties.direction === "Inbound" && r.properties.access === "Allow" &&
      (r.properties.destinationPortRange === "8080" || r.properties.destinationPortRange === "*"),
  );
  if (has8080) { console.log("\n8080 already allowed — issue is elsewhere."); process.exit(0); }

  // 4. Add allow rule for 8080 (PUT on the rule sub-resource; no full-NSG etag dance needed)
  console.log("\n=== 4. adding rule allow-8080 ===");
  const putBody = JSON.stringify({
    properties: {
      protocol: "Tcp",
      sourcePortRange: "*",
      destinationPortRange: "8080",
      sourceAddressPrefix: "*",
      destinationAddressPrefix: "*",
      access: "Allow",
      priority: 310,
      direction: "Inbound",
    },
  });
  const putRaw = await exec(
    `curl -s -m 30 -X PUT -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" ` +
    `-d '${putBody.replace(/'/g, `'\\''`)}' ` +
    `"https://management.azure.com/subscriptions/${SUB}/resourceGroups/${RG}/providers/Microsoft.Network/networkSecurityGroups/${nsgName}/securityRules/allow-8080?api-version=2023-09-01"`,
    60000,
  );
  let ok = false;
  try {
    const put = JSON.parse(putRaw);
    if (put.name === "allow-8080" && !put.error) ok = true;
    console.log(ok ? "RULE CREATED (provisioning state: " + (put.properties?.provisioningState || "?") + ")" : "PUT_FAILED:", ok ? "" : JSON.stringify(put.error || put).slice(0, 400));
  } catch { console.log("PUT_PARSE_FAIL:", putRaw.slice(0, 300)); }

  // 5. Verify from outside
  if (ok) {
    console.log("\n=== 5. external re-probe (20s wait for rule to apply) ===");
    await exec("sleep 20", 30000);
    const probe = await exec(
      `node -e "const net=require('net');const s=net.connect({host:'172.209.208.171',port:8080});const t=setTimeout(()=>{s.destroy();console.log('STILL_BLOCKED')},8000);s.on('connect',()=>{clearTimeout(t);s.destroy();console.log('PORT_8080_OPEN')});s.on('error',()=>{clearTimeout(t);console.log('STILL_BLOCKED')})"`,
      30000,
    );
    console.log(probe.trim());
  }
} finally {
  conn.end();
}
console.log("\nNSG_FIX_DONE");
