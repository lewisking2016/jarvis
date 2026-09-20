import { DatabaseSync } from "node:sqlite";
import path from "node:path";

export const DB_PATH = path.join(process.cwd(), "jarvis.data.sqlite");

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company TEXT NOT NULL,
        contact TEXT,
        email TEXT,
        phone TEXT,
        source TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        score INTEGER NOT NULL DEFAULT 0,
        bant TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT
      );

      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('QUOTE','INVOICE','RECEIPT')),
        number TEXT NOT NULL UNIQUE,
        client TEXT NOT NULL,
        client_phone TEXT,
        items_json TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT 'KES',
        tax_rate REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        linked_doc INTEGER,
        due_date TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        due TEXT,
        priority TEXT NOT NULL DEFAULT 'normal',
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent TEXT NOT NULL DEFAULT 'JARVIS',
        action TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Money Desk (DESIGN.md §13)
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        direction TEXT NOT NULL CHECK (direction IN ('in','out')),
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'KES',
        tx_type TEXT,
        counterparty TEXT,
        counterparty_phone TEXT,
        category TEXT,
        source TEXT NOT NULL DEFAULT 'mpesa',
        ref TEXT,
        linked_doc INTEGER,
        raw_sms TEXT,
        balance REAL,
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS suppression (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        value TEXT NOT NULL UNIQUE,
        channel TEXT,
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Revenue Command (§14)
      CREATE TABLE IF NOT EXISTS goals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        metric TEXT NOT NULL,
        target REAL NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
      );

      CREATE TABLE IF NOT EXISTS metric_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        metric TEXT NOT NULL,
        value REAL NOT NULL,
        taken_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Outbound engine (§15)
      CREATE TABLE IF NOT EXISTS outreach_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id INTEGER NOT NULL,
        channel TEXT NOT NULL,
        step INTEGER NOT NULL DEFAULT 1,
        template TEXT,
        body TEXT,
        scheduled_for TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        sent_at TEXT,
        reply_at TEXT,
        approval_required INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS sequences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id INTEGER NOT NULL,
        channel TEXT NOT NULL DEFAULT 'email',
        current_step INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        started_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Memory brain (§10)
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('fact','decision','preference','event','lesson','relationship','identity')),
        content TEXT NOT NULL,
        entities TEXT,
        importance INTEGER NOT NULL DEFAULT 2,
        confidence REAL NOT NULL DEFAULT 0.8,
        source TEXT NOT NULL DEFAULT 'distiller',
        use_count INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT,
        superseded_by INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Approval gates (§5 medium policy)
      CREATE TABLE IF NOT EXISTS approvals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        summary TEXT NOT NULL,
        payload_json TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT,
        resolved_via TEXT
      );

      -- Worker fleet (§3 Wave 3)
      CREATE TABLE IF NOT EXISTS workers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        jurisdiction TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        last_heartbeat TEXT,
        tasks_done INTEGER NOT NULL DEFAULT 0
      );

      -- Key/value state (distiller timestamps etc.)
      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // migrations for databases created before a column existed
    const txCols = (db.prepare("PRAGMA table_info(transactions)").all() as { name: string }[]).map((c) => c.name);
    if (!txCols.includes("balance")) db.exec("ALTER TABLE transactions ADD COLUMN balance REAL");

    seedIdentityIfEmpty();
  }
  return db;
}

function seedIdentityIfEmpty(): void {
  const c = (db!.prepare("SELECT COUNT(*) AS c FROM memories WHERE kind='identity'").get() as { c: number }).c;
  if (c === 0) {
    const ins = db!.prepare("INSERT INTO memories (kind, content, importance, source, confidence) VALUES ('identity', ?, 5, 'seed', 1)");
    ins.run("Company: IMT General System (imeantech.com) — IT services and SaaS products.");
    ins.run("Principal runs IMT; JARVIS addresses them as 'sir'.");
    ins.run("Mission: KES 400,000 revenue in Q4 2026; north star 1,000,000 active users.");
    ins.run("Currency: KES. Payments tracked via M-Pesa; transactional mail from info@imeantech.com.");
    ins.run("Cold outreach never runs on imeantech.com — secondary domains only (§15.8).");
    ins.run("Website CTA: 'Ready to Get Started?' paths anchor at imeantech.com/#get-started — steer leads there.");
    ins.run("Founder: Lewis — Visionary & Lead Architect. Office: Waris Mall, Kenya.");
    ins.run("Products: Wangari (AI IoT smart-farm platform, imeantech.com/wangari) and Workora (digital trust passport for informal workers, imeantech.com/workora).");
    ins.run("Services: website development, SEO & GEO, AI automation, managed IT — lead paths are forms, calls and WhatsApp.");
    ins.run("Social proof: 500+ students trained, 50+ projects delivered, 10+ global partners, 5 awards won.");
  }
  const g = (db!.prepare("SELECT COUNT(*) AS c FROM goals").get() as { c: number }).c;
  if (g === 0) {
    const year = new Date().getFullYear();
    const sprintStart = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    db!.prepare(
      "INSERT INTO goals (name, metric, target, period_start, period_end) VALUES (?, ?, ?, ?, ?)"
    ).run("Q4 revenue", "revenue_kes", 400000, sprintStart, `${year}-12-31`);
  }
}

export function nextDocNumber(kind: "QUOTE" | "INVOICE" | "RECEIPT"): string {
  const prefix = kind === "INVOICE" ? "INV" : kind === "RECEIPT" ? "RCP" : "QTE";
  const year = new Date().getFullYear();
  const row = getDb()
    .prepare("SELECT COUNT(*) AS c FROM documents WHERE number LIKE ?")
    .get(`${prefix}-${year}-%`) as { c: number };
  return `${prefix}-${year}-${String(row.c + 1).padStart(4, "0")}`;
}

export function logActivity(action: string, detail?: string, agent = "JARVIS"): void {
  getDb()
    .prepare("INSERT INTO activity (agent, action, detail) VALUES (?, ?, ?)")
    .run(agent, action, detail ?? null);
}
