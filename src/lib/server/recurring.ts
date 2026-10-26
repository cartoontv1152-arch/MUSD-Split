import "server-only";
import { formatAmount, parseAmount } from "@/lib/engine";
import { addDays, daysBetween, dueRuns, todayUTC } from "@/lib/recurrence";
import { bodyToEngine, storedToBody, type StoredSplit } from "@/lib/split-input";
import { computeSplit } from "@/lib/engine";
import type { z } from "zod";
import type { recurringCreateSchema } from "@/lib/validation";
import { q, q1, withTx } from "./db";
import { notify, recordActivity } from "./events";
import { createExpense } from "./expenses";
import { isAdmin, requireMember } from "./groups";
import { badRequest, forbidden, notFound } from "./http";

export interface RecurringRow {
  id: string;
  group_id: string;
  title: string;
  amount: string;
  payer: string;
  category: string;
  split_input: StoredSplit;
  cadence: "weekly" | "monthly";
  interval_count: number;
  anchor_day: number | null;
  next_run_on: string;
  end_on: string | null;
  remind_days_before: number;
  last_reminded_for: string | null;
  active: boolean;
  created_by: string;
  created_at: Date;
  last_run_at: Date | null;
}

const SELECT = `SELECT r.id, r.group_id, r.title, r.amount::text AS amount, r.payer, r.category, r.split_input, r.cadence,
  r.interval_count, r.anchor_day, to_char(r.next_run_on,'YYYY-MM-DD') AS next_run_on, to_char(r.end_on,'YYYY-MM-DD') AS end_on,
  r.remind_days_before, to_char(r.last_reminded_for,'YYYY-MM-DD') AS last_reminded_for, r.active, r.created_by, r.created_at, r.last_run_at
  FROM split.recurring_expenses r`;

export function recurringDTO(r: RecurringRow) {
  return {
    id: r.id,
    groupId: r.group_id,
    title: r.title,
    amount: r.amount,
    payer: r.payer,
    category: r.category,
    split: r.split_input,
    cadence: r.cadence,
    intervalCount: r.interval_count,
    nextRunOn: r.next_run_on,
    endOn: r.end_on,
    remindDaysBefore: r.remind_days_before,
    active: r.active,
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
    lastRunAt: r.last_run_at?.toISOString() ?? null,
  };
}

export async function listRecurring(groupId: string) {
  return q<RecurringRow>(`${SELECT} WHERE r.group_id = $1 ORDER BY r.active DESC, r.next_run_on`, [groupId]);
}

export async function upcomingForUser(address: string, days = 30) {
  return q<RecurringRow & { group_name: string }>(
    `${SELECT.replace("FROM split.recurring_expenses r", ", g.name AS group_name FROM split.recurring_expenses r JOIN split.groups g ON g.id = r.group_id")}
     WHERE r.active AND r.next_run_on <= (current_date + make_interval(days => $2))
       AND EXISTS (SELECT 1 FROM split.group_members m WHERE m.group_id = r.group_id AND m.address = $1 AND m.status = 'active')
     ORDER BY r.next_run_on LIMIT 10`,
    [address, days],
  );
}

export async function createRecurring(groupId: string, actor: string, input: z.infer<typeof recurringCreateSchema>) {
  await requireMember(groupId, actor);
  const amount = parseAmount(input.amount);
  const members = await q<{ address: string }>(
    `SELECT address FROM split.group_members WHERE group_id = $1 AND status = 'active'`,
    [groupId],
  );
  const allowed = new Set(members.map((m) => m.address));
  const payer = input.payer.toLowerCase();
  if (!allowed.has(payer)) throw badRequest("The payer must be a member of this group", "PAYER_NOT_MEMBER");
  const { input: eng, stored } = bodyToEngine(input.split);
  const shares = computeSplit(amount, eng, { payer });
  if (shares.some((s) => !allowed.has(s.member))) throw badRequest("Every participant must be a member", "PARTICIPANT_NOT_MEMBER");
  if (input.startOn < todayUTC()) throw badRequest("Start date can't be in the past", "START_IN_PAST");
  if (input.endOn && input.endOn < input.startOn) throw badRequest("End date must be after the start date", "END_BEFORE_START");
  const id = crypto.randomUUID();
  await withTx(async (c) => {
    await q(
      `INSERT INTO split.recurring_expenses (id, group_id, title, amount, payer, category, split_input, cadence, interval_count,
         anchor_day, next_run_on, end_on, remind_days_before, created_by)
       VALUES ($1,$2,$3,$4::numeric,$5,$6,$7::jsonb,$8,$9,$10,$11::date,$12::date,$13,$14)`,
      [id, groupId, input.title, amount.toString(), payer, input.category, JSON.stringify(stored), input.cadence, input.intervalCount,
        Number(input.startOn.slice(8, 10)), input.startOn, input.endOn ?? null, input.remindDaysBefore, actor],
      c,
    );
    await recordActivity(c, groupId, actor, "recurring_created", {
      recurringId: id,
      title: input.title,
      amount: amount.toString(),
      cadence: input.cadence,
      startOn: input.startOn,
    });
  });
  return id;
}

export async function setRecurringActive(groupId: string, id: string, actor: string, active: boolean) {
  const { membership } = await requireMember(groupId, actor);
  const r = await q1<RecurringRow>(`${SELECT} WHERE r.id = $1 AND r.group_id = $2`, [id, groupId]);
  if (!r) throw notFound("Recurring expense not found");
  if (!isAdmin(membership.role) && r.created_by !== actor) throw forbidden("Only admins or its creator can change this schedule");
  await q(`UPDATE split.recurring_expenses SET active = $3, updated_at = now() WHERE id = $1 AND group_id = $2`, [id, groupId, active]);
}

/**
 * Creates expense records for schedules that are due (never moves funds), and sends reminders
 * for upcoming ones. Idempotent: (recurring_id, run date) is unique on expenses.
 */
export async function runRecurring(opts: { groupId?: string; today?: string } = {}) {
  const today = opts.today ?? todayUTC();
  const due = await q<RecurringRow>(
    `${SELECT} WHERE r.active AND r.next_run_on <= $1::date AND ($2::uuid IS NULL OR r.group_id = $2) ORDER BY r.next_run_on LIMIT 50`,
    [today, opts.groupId ?? null],
  );
  let created = 0;
  for (const r of due) {
    const { runs, next, finished } = dueRuns(r.next_run_on, today, r.cadence, r.interval_count, r.anchor_day, r.end_on);
    // skip if payer / participants left the group
    const active = new Set(
      (await q<{ address: string }>(`SELECT address FROM split.group_members WHERE group_id=$1 AND status='active'`, [r.group_id])).map(
        (m) => m.address,
      ),
    );
    for (const runOn of runs) {
      try {
        const res = await createExpense(
          r.group_id,
          r.created_by,
          {
            title: r.title,
            amount: formatAmount(BigInt(r.amount)).replace(/,/g, ""),
            payer: r.payer,
            category: r.category as never,
            date: runOn,
            notes: "Created automatically from a recurring schedule",
            split: storedToBody(r.split_input),
          },
          { recurringId: r.id, recurringRunOn: runOn, system: true },
        );
        if (!res.duplicate) created++;
      } catch (e) {
        console.error("[recurring] run failed", r.id, runOn, (e as Error).message, active.size);
      }
    }
    await q(
      `UPDATE split.recurring_expenses SET next_run_on = $2::date, last_run_at = now(), active = $3, updated_at = now() WHERE id = $1`,
      [r.id, next, !finished],
    );
    if (runs.length) {
      await withTx((c) => recordActivity(c, r.group_id, null, "recurring_run", { recurringId: r.id, title: r.title, runs }));
    }
  }

  // reminders for upcoming runs
  const upcoming = await q<RecurringRow>(
    `${SELECT} WHERE r.active AND r.next_run_on > $1::date AND ($2::uuid IS NULL OR r.group_id = $2)
       AND (r.last_reminded_for IS NULL OR r.last_reminded_for <> r.next_run_on)`,
    [today, opts.groupId ?? null],
  );
  let reminded = 0;
  for (const r of upcoming) {
    const daysLeft = daysBetween(today, r.next_run_on);
    if (daysLeft > r.remind_days_before) continue;
    const participants = Object.keys(
      r.split_input.method === "equal"
        ? Object.fromEntries((r.split_input.participants ?? []).map((p) => [p, 1]))
        : (r.split_input.amounts ?? r.split_input.bps ?? r.split_input.weights ?? {}),
    );
    await withTx(async (c) => {
      await notify(c, participants, {
        groupId: r.group_id,
        type: "recurring_reminder",
        title: `Upcoming: ${r.title} — ${formatAmount(BigInt(r.amount))} MUSD`,
        body: `Will be added on ${r.next_run_on} (${daysLeft === 0 ? "today" : `in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}). No money moves automatically.`,
        href: `/groups/${r.group_id}?tab=recurring`,
        data: { recurringId: r.id },
      });
      await q(`UPDATE split.recurring_expenses SET last_reminded_for = next_run_on WHERE id = $1`, [r.id], c);
    });
    reminded++;
  }
  return { created, reminded, today, horizon: addDays(today, 14) };
}
