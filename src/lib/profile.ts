import { getDb } from "./db";

/**
 * COMPANY PROFILE — ground truth JARVIS reasons from when the principal gives
 * thin input ("quote them for laptops", "draft the proposal", "message them").
 * Every fact here means the AI never interrogates and never returns a skeleton:
 * he fills gaps with REAL business details (standard pricing, contacts, terms)
 * and lists his assumptions after executing. Editable by the principal in plain
 * chat ("we now do X", "our standard rate is Y") via the update_profile tool,
 * and by JARVIS himself when he learns something durable.
 */

export interface CompanyProfile {
  business_name: string;
  tagline: string;
  services: { name: string; unit_price: number; unit: string }[];
  standard_terms: string;
  payment: { paybill: string; till: string; bank: string; mpesa_phone: string; terms: string };
  contacts: { email_formal: string; email_marketing: string; phone: string; website: string; location: string };
  principal: { name: string; title: string; style_notes: string };
  targets: { revenue_quarter_kes: number };
  [key: string]: unknown; // free-form additions learned over time
}

const STATE_KEY = "company_profile";

/** Seeded defaults — REAL IMT data; the principal can correct any line in chat. */
export const DEFAULT_PROFILE: CompanyProfile = {
  business_name: "IMT General System",
  tagline: "Technology solutions — supply, installation and support for businesses.",
  services: [
    { name: "Laptop supply", unit_price: 42000, unit: "per unit (business-grade)" },
    { name: "CCTV / site camera supply & installation", unit_price: 18000, unit: "per camera, installed" },
    { name: "Installation & setup labour", unit_price: 5000, unit: "per visit" },
  ],
  standard_terms:
    "Quotation valid 14 days. Delivery 3–7 working days within Nairobi unless agreed otherwise. Warranty per manufacturer; support available on retainer.",
  payment: {
    paybill: "",
    till: "",
    bank: "Equity Bank Kenya — account name LEWIS NDUNG'U KINAGA, account number 0340184547442, bank transfer",
    mpesa_phone: "0114971070",
    terms: "50% deposit to commence, balance on delivery (default unless the principal says otherwise).",
  },
  contacts: {
    email_formal: "admin@imeantech.com",
    email_marketing: "info@imeantech.com",
    phone: "0114971070",
    website: "imeantech.com",
    location: "Waris Mall, Ruiru, Kenya",
  },
  principal: {
    name: "Lewis",
    title: "Principal, IMT General System",
    style_notes: "Busy executive; speaks in short free-form directives; expects execution, not questionnaires.",
  },
  targets: { revenue_quarter_kes: 400000 },
};

export function getProfile(): CompanyProfile {
  try {
    const row = getDb().prepare("SELECT value FROM app_state WHERE key = ?").get(STATE_KEY) as
      | { value: string }
      | undefined;
    if (!row) return { ...DEFAULT_PROFILE };
    const stored = JSON.parse(row.value) as Partial<CompanyProfile>;
    return { ...DEFAULT_PROFILE, ...stored };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export function saveProfile(patch: Record<string, unknown>, source: string): CompanyProfile {
  const current = getProfile();
  const next = deepMerge(current as unknown as Record<string, unknown>, patch) as unknown as CompanyProfile;
  getDb()
    .prepare(
      "INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(STATE_KEY, JSON.stringify(next));
  void source;
  return next;
}

/** Recursive merge so "payment.paybill is X" updates one leaf without wiping siblings. */
function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) {
      delete out[k]; // explicit null clears a field (e.g. correcting a wrong value)
      continue;
    }
    const prev = out[k];
    out[k] =
      v && typeof v === "object" && !Array.isArray(v) && prev && typeof prev === "object" && !Array.isArray(prev)
        ? deepMerge(prev as Record<string, unknown>, v as Record<string, unknown>)
        : v;
  }
  return out;
}

/** Compact block injected into the system prompt — facts JARVIS reasons from. */
export function profileHeader(): string {
  const p = getProfile();
  const lines: string[] = ["COMPANY PROFILE (ground truth — reason from these facts when input is thin):"];
  lines.push(`Business: ${p.business_name} — ${p.tagline}`);
  lines.push(`Standard price list: ${p.services.map((s) => `${s.name} KES ${s.unit_price.toLocaleString("en-US")} ${s.unit}`).join("; ")}`);
  lines.push(`Terms: ${p.standard_terms}`);
  lines.push(
    `Payment: ${[
      p.payment.bank && `bank ${p.payment.bank}`,
      (p.payment.paybill || p.payment.till) && `M-Pesa ${[p.payment.paybill && `paybill ${p.payment.paybill}`, p.payment.till && `till ${p.payment.till}`].filter(Boolean).join(" / ")}`,
      p.payment.mpesa_phone && `M-Pesa alternative phone ${p.payment.mpesa_phone}`,
    ].filter(Boolean).join(" · ") || "details not set"}. ${p.payment.terms}`,
  );
  lines.push(`Contacts: formal ${p.contacts.email_formal} · marketing ${p.contacts.email_marketing} · web ${p.contacts.website} · ${p.contacts.location}${p.contacts.phone ? ` · phone ${p.contacts.phone}` : ""}`);
  lines.push(`Principal: ${p.principal.name} (${p.principal.title}). ${p.principal.style_notes}`);
  lines.push(`Quarter revenue target: KES ${p.targets.revenue_quarter_kes.toLocaleString("en-US")}`);
  const extras = Object.entries(p).filter(
    ([k, v]) =>
      !["business_name", "tagline", "services", "standard_terms", "payment", "contacts", "principal", "targets"].includes(k) &&
      v !== null &&
      v !== "" &&
      !(Array.isArray(v) && v.length === 0),
  );
  if (extras.length) lines.push(`Also on record: ${extras.map(([k, v]) => `${k.replace(/_/g, " ")}: ${JSON.stringify(v)}`).join(" | ")}`);
  return lines.join("\n");
}
