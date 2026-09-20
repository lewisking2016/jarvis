#!/usr/bin/env node
/**
 * NSG FIX — runs INSIDE the VPS via SSH. If the VM has a managed identity,
 * use it to open inbound 8080 on the NIC's NSG. Run: node deploy/nsg-fix.mjs
 */
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const _s = require("ssh2");
const SSHClient = _s.Client || _s.default || _s;

let HOST = "172.209.208.171", USER = "jarvis", PASS = "";
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^(JARVIS_VPS_(HOST|USER|PASS))=(.*)$/);
  if (!m) continue;
  const key = m[2], val = m[3].trim();
  if (key === "HOST") HOST = val; else if (key === "USER") USER = val; else if (key === "PASS") PASS = val;
}
if (!PASS) PASS = process.env.JARVIS_VPS_PASS || "";

const conn = new SSHClient();
const run = (cmd, timeout = 30_000) => new Promise((res) => {
  conn.exec(cmd, (err, stream) => {
    if (err) return res({ code: -1, out: String(err) });
    let out = "";
    const t = setTimeout(() => stream.close(), timeout);
    stream.on("data", (d) => (out += d)).on("stderr", (d) => (out += d))
      .on("close", () => { clearTimeout(t); res({ out }); });
  });
});

conn.on("ready", async () => {
  // 1. Does the VM have a managed identity?
  const id = await run(`curl -s -m 4 -H Metadata:true "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fmanagement.azure.com%2F"`);
  console.log("IMDS:", id.out.slice(0, 200));
  const tokMatch = id.out.match(/"access_token":"([^"]+)"/);
  if (!tokMatch) {
    console.log("NO_MANAGED_IDENTITY — cannot open the NSG from inside the VM.");
    conn.end(); return;
  }
  const token = tokMatch[1];

  // 2. Find the NIC → NSG
  const sub = "95f3064f-112d-4ca7-b861-10ea1834c7bd", rg = "LEWIS_GROUP", vm = "jarvis";
  const meta = await run(`curl -s -m 4 -H Metadata:true "http://169.254.169.254/metadata/instance?api-version=2021-02-01"`);
  const nicName = (meta.out.match(/"name":"(jarvis\d+)"/) || [])[1] || "jarvis487";
  console.log("NIC:", nicName);

  const hdr = `-H "Authorization: Bearer ${token}" -H "Content-Type: application/json"`;
  const nic = await run(`curl -s -m 10 ${hdr} "https://management.azure.com/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.Network/networkInterfaces/${nicName}?api-version=2023-09-01"`);
  const nsgId = (nic.out.match(/"id":"([^"]*networkSecurityGroups\/[^"]+)"/) || [])[1];
  if (!nsgId) { console.log("NO_NSG_ON_NIC — NSG not attached to NIC (maybe subnet-level)."); conn.end(); return; }
  const nsgName = nsgId.split("/").pop();
  console.log("NSG:", nsgName);

  // 3. GET the NSG, add the rule if missing, PUT it back
  const nsg = await run(`curl -s -m 10 ${hdr} "https://management.azure.com${nsgId}?api-version=2023-09-01"`);
  let nsgJson; try { nsgJson = JSON.parse(nsg.out); } catch { console.log("NSG_PARSE_FAIL:", nsg.out.slice(0, 200)); conn.end(); return; }
  const props = nsgJson.properties || {};
  props.securityRules = props.securityRules || [];
  const exists = props.securityRules.some((r) => r.name === "jarvis-backend" || (r.properties && r.properties.destinationPortRange === "8080" && r.properties.access === "Allow"));
  if (exists) { console.log("RULE_ALREADY_PRESENT"); conn.end(); return; }
  props.securityRules.push({
    name: "jarvis-backend",
    properties: { protocol: "Tcp", sourcePortRange: "*", destinationPortRange: "8080", sourceAddressPrefix: "*", sourcePortRange2: undefined,
      destinationAddressPrefix: "*", access: "Allow", priority: 1001, direction: "Inbound" },
  });
  const body = JSON.stringify({ location: nsgJson.location, properties: { securityRules: props.securityRules } }).replace(/"sourcePortRange2":undefined,?/g, "");
  const put = await run(`curl -s -m 30 -X PUT ${hdr} -d '${body.replace(/'/g, `'\\''`)}' "https://management.azure.com${nsgId}?api-version=2023-09-01"`, 40_000);
  console.log("PUT_RESULT:", put.out.slice(0, 300));
  conn.end();
});
conn.on("error", (e) => { console.log("SSH_ERR:", e.message); process.exit(1); });
conn.connect({ host: HOST, port: 22, username: USER, password: PASS, readyTimeout: 20_000 });
