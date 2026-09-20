# M-Pesa SMS Bridge — setup guide

Get every M-Pesa confirmation SMS into JARVIS's ledger automatically. Real payments then
reconcile to invoices and receipts issue themselves (verified working).

## How it works

```
Phone (M-Pesa SMS) → Android forwarder app → POST /api/webhooks/mpesa → parser → ledger
                                                              ↓
                              auto-reconcile → receipt PDF · or approval gate · or task
```

## 1. The webhook (already live)

- **URL:** `http://<your-PC-IP>:<port>/api/webhooks/mpesa`
- **Auth header:** `x-jarvis-token: <MPESA_WEBHOOK_TOKEN from .env>`
- **Body:** `{ "message": "<the raw SMS text>" }`
- Dedupe by M-Pesa code is built in — forwarders can retry safely.
- Find your PC's IP: `ipconfig` → IPv4 (e.g. `192.168.100.50`). Port = the one `npm start` prints.

## 2. The Android forwarder (choose one)

**Option A — "SMS Forwarder" style app (easiest)**
1. Install an SMS-forwarding app that supports **custom HTTP webhooks** (e.g. *SMS Forwarder — Auto
   forward SMS*, or *Tasker*/*MacroDroid* for power users).
2. Create a rule: **sender contains "MPESA"** → forward to webhook.
3. URL: the webhook above · Method: POST · Headers: `x-jarvis-token: <token>` ·
   Content-Type: `application/json` · Body template: `{"message":"{{sms}}"}`
4. Disable battery optimization for the app so it survives doze.

**Option B — Tasker (most reliable)**
- Profile: Event → Received Text → Sender `MPESA`
- Task: HTTP Request → URL/method/headers as above, Body: `{"message":"%SMSRB"}`

**MacroDroid:** Trigger: SMS Received (MPESA) → Action: HTTP POST with the same body template.

## 3. When the phone is offline

SMS received while the PC is asleep or the phone offline are queued by the forwarder app (most
queue until delivery succeeds) and arrive on reconnect — the dedupe guard makes late delivery
harmless. The webhook is idempotent; you lose nothing except real-time chimes.

## 4. Reaching JARVIS beyond your LAN

| Need | Approach |
|---|---|
| Phone + PC on same Wi-Fi | direct LAN URL (above) — simplest, private |
| Phone out and about | tunnel: `cloudflared tunnel --url http://localhost:3000` or ngrok, use the HTTPS URL in the forwarder; keep the token header |
| Always-on | move JARVIS (or just a relay) to the Wave-3 VPS |

## 5. Security

- The token in `.env` is the only credential — rotate by editing `.env` and the forwarder rule.
- Raw SMS is stored truncated (first 400 chars) for audit; the parsed record is what the ledger uses.
- Never expose the webhook without the token header enforced (it is — requests without it get 401).

## 6. Rail B — Daraja (official, when you have a Paybill/Till)

Safaricom Daraja C2B `ConfirmationURL` can point at the same webhook. Daraja sends JSON with
`TransAmount`, `MSISDN`, `TransID`, `BillRefNumber` — add a small adapter in
`src/app/api/webhooks/mpesa/route.ts` (detect Daraja payload shape → map to the parser input) and
the whole reconcile/receipt pipeline works unchanged, with no phone dependency.

## 7. Verified behavior (test log)

- Real-format received SMS → `{"ok":true,"tx_id":N,"reconciled":"INV-2026-0001","receipt":"RCP-2026-0001"}`
- Same SMS again → `{"ok":true,"duplicate":true}` (no double ledger entry)
- KPLC payment SMS → recorded as `utilities` expense
- Wrong/missing token → `401 unauthorized`
