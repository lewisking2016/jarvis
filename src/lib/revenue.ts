import { getDb, logActivity } from "./db";
import { financialStatus, round2 } from "./money";

export interface RevenueStatus {
  target: number;
  earned: number;
  pct: number;
  days_total: number;
  days_left: number;
  required_per_day: number;
  actual_per_day: number;
  pace_delta_pct: number;
  pipeline_value: number;
  forecast: number;
  saas_users: number;
  actions: string[];
}

export function revenueStatus(): RevenueStatus {
  const db = getDb();
  const goal = db
    .prepare("SELECT * FROM goals WHERE status='active' AND metric='revenue_kes' ORDER BY id DESC LIMIT 1")
    .get() as { id: number; name: string; target: number; period_start: string; period_end: string } | undefined;

  if (!goal) {
    return {
      target: 0, earned: 0, pct: 0, days_total: 0, days_left: 0,
      required_per_day: 0, actual_per_day: 0, pace_delta_pct: 0, pipeline_value: 0,
      forecast: 0, saas_users: 0,
      actions: ["No active revenue goal set — create one."],
    };
  }

  const now = new Date();
  const start = new Date(goal.period_start);
  const end = new Date(goal.period_end);
  const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 864e5));
  const daysElapsed = Math.min(totalDays, Math.max(0, Math.floor((now.getTime() - start.getTime()) / 864e5)));
  const daysLeft = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 864e5));

  // Revenue = ledger in-flows within the goal period only (no pre-period leakage)
  const earnedRow = getDb()
    .prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE direction='in' AND date(occurred_at) >= date(?) AND date(occurred_at) <= date(?)")
    .get(goal.period_start, goal.period_end) as { s: number };
  const earned = earnedRow.s;

  const requiredPerDay = goal.target / totalDays;
  const actualPerDay = daysElapsed > 0 ? earned / daysElapsed : 0;
  const expectedByNow = requiredPerDay * Math.max(1, daysElapsed);
  const paceDelta = expectedByNow > 0 ? Math.round(((earned - expectedByNow) / expectedByNow) * 100) : 0;

  const pipelineRow = db
    .prepare("SELECT COALESCE(SUM(total),0) s FROM documents WHERE kind IN ('QUOTE','INVOICE') AND status IN ('draft','sent','partial','overdue')")
    .get() as { s: number };

  const wonLeads = (db.prepare("SELECT COUNT(*) c FROM leads WHERE status='won'").get() as { c: number }).c;
  const totalClosedWon = (db.prepare("SELECT COALESCE(SUM(total),0) s FROM documents WHERE kind='INVOICE' AND status='paid'").get() as { s: number }).s;
  const avgDeal = wonLeads > 0 ? totalClosedWon / wonLeads : 40000;
  const forecast = round2(actualPerDay * totalDays + (pipeline_valueShare(pipelineRow.s, avgDeal)));

  const saasUsers = (db.prepare("SELECT COUNT(*) c FROM leads WHERE status='won' AND source LIKE 'saas%'").get() as { c: number }).c;

  const actions: string[] = [];
  const pendingFollow = (db.prepare("SELECT COUNT(*) c FROM leads WHERE status='replied'").get() as { c: number }).c;
  const drafts = (db.prepare("SELECT COUNT(*) c FROM documents WHERE kind='QUOTE' AND status='draft'").get() as { c: number }).c;
  const dueOutreach = (db.prepare("SELECT COUNT(*) c FROM outreach_queue WHERE status='queued' AND scheduled_for <= datetime('now')").get() as { c: number }).c;
  const newLeads = (db.prepare("SELECT COUNT(*) c FROM leads WHERE status='new'").get() as { c: number }).c;
  if (pendingFollow > 0) actions.push(`${pendingFollow} replied lead(s) awaiting follow-up`);
  if (drafts > 0) actions.push(`${drafts} quote draft(s) to approve/send`);
  if (dueOutreach > 0) actions.push(`${dueOutreach} outreach touch(es) due now`);
  if (newLeads > 0) actions.push(`${newLeads} new lead(s) to contact`);
  if (!actions.length) actions.push("Pipeline quiet — feed the funnel (prospecting batch).");

  return {
    target: goal.target,
    earned: round2(earned),
    pct: Math.round((earned / goal.target) * 100),
    days_total: totalDays,
    days_left: daysLeft,
    required_per_day: round2(requiredPerDay),
    actual_per_day: round2(actualPerDay),
    pace_delta_pct: paceDelta,
    pipeline_value: round2(pipelineRow.s),
    forecast: round2(forecast),
    saas_users: saasUsers,
    actions: actions.slice(0, 3),
  };
}

function pipeline_valueShare(pipeline: number, avgDeal: number): number {
  // Expected value from open pipeline at ~15% close
  return pipeline * 0.15 * (avgDeal > 0 ? Math.min(1, avgDeal / 40000) : 1);
}
