import "server-only";
import type { PoolClient } from "@neondatabase/serverless";
import { categoryLabel } from "@/config/app";
import {
  computeSplit,
  diffExpenseEffects,
  formatAmount,
  parseAmount,
  serializeDeltas,
  type LedgerExpense,
} from "@/lib/engine";
import { bodyToEngine } from "@/lib/split-input";
import type { z } from "zod";
import type { expenseCreateSchema, expenseUpdateSchema } from "@/lib/validation";
import { q, q1, withTx } from "./db";
import { notify, recordActivity } from "./events";
import { EXPENSE_SELECT, isAdmin, loadLedger, requireMember, toLedgerExpense, type ExpenseRow, type GroupRow } from "./groups";
import { ApiError, badRequest, conflict, forbidden, notFound } from "./http";
import { getProfiles } from "./users";

type CreateInput = z.infer<typeof expenseCreateSchema>;
type UpdateInput = z.infer<typeof expenseUpdateSchema>;

function displayName(p: { displayName: string | null; username: string | null; address: string } | undefined, addr: string) {
  return p?.displayName || (p?.username ? `@${p.username}` : `${addr.slice(0, 6)}…${addr.slice(-4)}`);
}

interface Prepared {
  amount: bigint;
  payer: string;
  shares: { member: string; share: bigint }[];
  stored: ReturnType<typeof bodyToEngine>["stored"];
  labels: Record<string, string>;
}

function prepare(input: CreateInput | UpdateInput, allowed: Set<string>): Prepared {
  const amount = parseAmount(input.amount);
  const payer = input.payer.toLowerCase();
  if (!allowed.has(payer)) throw badRequest("The payer must be a member of this group", "PAYER_NOT_MEMBER");
  const { input: engineInput, stored, labels } = bodyToEngine(input.split);
  const shares = computeSplit(amount, engineInput, { payer });
  for (const s of shares) {
    if (!allowed.has(s.member)) throw badRequest("Every participant must be a member of this group", "PARTICIPANT_NOT_MEMBER");
  }
  return { amount, payer, shares, stored, labels };
}

function snapshot(e: { title: string; amount: bigint; payer: string; category: string; date: string; notes: string | null }, p: Prepared) {
  return {
    title: e.title,
    amount: e.amount.toString(),
    payer: e.payer,
    category: e.category,
    date: e.date,
    notes: e.notes,
    split: p.stored,
    shares: Object.fromEntries(p.shares.map((s) => [s.member, s.share.toString()])),
  };
}

async function insertParticipants(c: PoolClient, expenseId: string, p: Prepared) {
  await q(
    `INSERT INTO split.expense_participants (expense_id, address, share, input)
     SELECT $1, a, s::numeric, i FROM unnest($2::text[], $3::text[], $4::text[]) AS t(a, s, i)`,
    [expenseId, p.shares.map((s) => s.member), p.shares.map((s) => s.share.toString()), p.shares.map((s) => p.labels[s.member] ?? null)],
    c,
  );
}

async function assertReceipt(c: PoolClient, groupId: string, receiptId: string | null | undefined) {
  if (!receiptId) return;
  const r = await q1(`SELECT id FROM split.receipts WHERE id = $1 AND group_id = $2`, [receiptId, groupId], c);
  if (!r) throw badRequest("Receipt not found in this group", "RECEIPT_NOT_FOUND");
}

export async function createExpense(
  groupId: string,
  actor: string,
  input: CreateInput,
  opts: { recurringId?: string; recurringRunOn?: string; system?: boolean } = {},
) {
  if (!opts.system) await requireMember(groupId, actor);
  return withTx(async (c) => {
    const members = await q<{ address: string }>(
      `SELECT address FROM split.group_members WHERE group_id = $1 AND status = 'active'`,
      [groupId],
      c,
    );
    const allowed = new Set(members.map((m) => m.address));
    const p = prepare(input, allowed);
    await assertReceipt(c, groupId, input.receiptId);
    const id = crypto.randomUUID();
    const inserted = await q1<{ id: string }>(
      `INSERT INTO split.expenses (id, group_id, title, amount, payer, category, expense_date, notes, split_method,
         split_input, receipt_id, recurring_id, recurring_run_on, created_by, client_request_id)
       VALUES ($1,$2,$3,$4::numeric,$5,$6,$7::date,$8,$9,$10::jsonb,$11,$12,$13::date,$14,$15)
       ON CONFLICT DO NOTHING RETURNING id`,
      [
        id,
        groupId,
        input.title,
        p.amount.toString(),
        p.payer,
        input.category,
        input.date,
        input.notes || null,
        input.split.method,
        JSON.stringify(p.stored),
        input.receiptId || null,
        opts.recurringId ?? null,
        opts.recurringRunOn ?? null,
        actor,
        ("clientRequestId" in input && input.clientRequestId) || null,
      ],
      c,
    );
    if (!inserted) {
      // idempotent replay (same clientRequestId) or recurring run already created
      const existing = await q1<{ id: string }>(
        `SELECT id FROM split.expenses WHERE group_id = $1 AND (client_request_id = $2 OR (recurring_id = $3 AND recurring_run_on = $4::date))`,
        [groupId, ("clientRequestId" in input && input.clientRequestId) || null, opts.recurringId ?? null, opts.recurringRunOn ?? null],
        c,
      );
      return { id: existing?.id ?? null, duplicate: true };
    }
    await insertParticipants(c, id, p);
    const after: LedgerExpense = { id, payer: p.payer, total: p.amount, shares: p.shares, date: input.date, createdAt: Date.now() };
    const deltas = diffExpenseEffects(null, after);
    await q(
      `INSERT INTO split.expense_revisions (expense_id, group_id, version, action, snapshot, deltas, actor)
       VALUES ($1,$2,1,'created',$3::jsonb,$4::jsonb,$5)`,
      [id, groupId, JSON.stringify(snapshot({ ...input, amount: p.amount, payer: p.payer, notes: input.notes ?? null }, p)), JSON.stringify(serializeDeltas(deltas)), actor],
      c,
    );
    await recordActivity(c, groupId, actor, "expense_added", {
      expenseId: id,
      title: input.title,
      amount: p.amount.toString(),
      payer: p.payer,
      category: input.category,
      participants: p.shares.map((s) => s.member),
      recurring: !!opts.recurringId,
    });
    const profiles = await getProfiles([actor, p.payer], c);
    const who = opts.system ? "A recurring bill" : displayName(profiles[actor], actor);
    for (const s of p.shares) {
      if (s.member === actor && !opts.system) continue;
      if (s.member === p.payer && s.share === p.amount) continue;
      await notify(c, [s.member], {
        groupId,
        type: opts.system ? "recurring_created" : "expense_added",
        title: `${who} added “${input.title}”`,
        body:
          s.member === p.payer
            ? `${formatAmount(p.amount)} MUSD · ${categoryLabel(input.category)} · you paid`
            : `Your share: ${formatAmount(s.share)} MUSD of ${formatAmount(p.amount)} MUSD`,
        href: `/groups/${groupId}/expenses/${id}`,
        data: { expenseId: id },
      });
    }
    return { id, duplicate: false };
  });
}

async function lockExpense(c: PoolClient, groupId: string, expenseId: string): Promise<ExpenseRow> {
  const lock = await q1(`SELECT id FROM split.expenses WHERE id = $1 AND group_id = $2 FOR UPDATE`, [expenseId, groupId], c);
  if (!lock) throw notFound("Expense not found");
  const row = await q1<ExpenseRow>(`${EXPENSE_SELECT} WHERE e.id = $1`, [expenseId], c);
  if (!row) throw notFound("Expense not found");
  return row;
}

function canModify(role: "owner" | "admin" | "member", actor: string, e: ExpenseRow) {
  return isAdmin(role) || e.created_by === actor || e.payer === actor;
}

/** Was any part of this expense already paid back (or explicitly linked to a settlement)? */
async function settlementTouched(c: PoolClient, groupId: string, expense: ExpenseRow): Promise<{ touched: boolean; status: string }> {
  const g = await q1<GroupRow>(`SELECT * FROM split.groups WHERE id = $1`, [groupId], c);
  if (!g) throw notFound("Group not found");
  const loaded = await loadLedger(g, c);
  const cov = loaded.ledger.coverage.get(expense.id);
  const linked = await q1(
    `SELECT 1 FROM split.settlements WHERE group_id = $1 AND $2 = ANY(expense_ids) AND status IN ('confirmed','submitted','delayed') LIMIT 1`,
    [groupId, expense.id],
    c,
  );
  const status = cov?.status ?? "open";
  // "settled" purely by offsets with no settlement ever confirmed in the group is not a payment
  const anyConfirmed = loaded.settlements.some((s) => s.status === "confirmed");
  return { touched: !!linked || (status !== "open" && anyConfirmed), status };
}

export async function updateExpense(groupId: string, expenseId: string, actor: string, input: UpdateInput) {
  const { membership } = await requireMember(groupId, actor);
  return withTx(async (c) => {
    const before = await lockExpense(c, groupId, expenseId);
    if (before.deleted_at) throw conflict("This expense was deleted", "EXPENSE_DELETED");
    if (!canModify(membership.role, actor, before)) {
      throw forbidden("Only the person who added or paid this expense, or a group admin, can edit it");
    }
    if (before.version !== input.expectedVersion) {
      throw conflict("Someone else changed this expense. Reload to see the latest version.", "VERSION_CONFLICT");
    }
    const members = await q<{ address: string; status: string }>(
      `SELECT address, status FROM split.group_members WHERE group_id = $1`,
      [groupId],
      c,
    );
    const allowed = new Set(members.filter((m) => m.status === "active").map((m) => m.address));
    for (const p of before.participants) allowed.add(p.address); // keep past participants who have since left
    allowed.add(before.payer);
    const p = prepare(input, allowed);
    await assertReceipt(c, groupId, input.receiptId);

    const touched = await settlementTouched(c, groupId, before);
    if (touched.touched && !input.reason?.trim()) {
      throw new ApiError(
        400,
        "REASON_REQUIRED",
        "This expense has already been (partly) settled. Add a short reason — the change will be recorded as an adjustment.",
      );
    }
    const oldLedger = toLedgerExpense(before);
    const after: LedgerExpense = { ...oldLedger, payer: p.payer, total: p.amount, shares: p.shares, date: input.date };
    const deltas = diffExpenseEffects(oldLedger, after);
    const newVersion = before.version + 1;
    await q(
      `UPDATE split.expenses SET title=$2, amount=$3::numeric, payer=$4, category=$5, expense_date=$6::date, notes=$7,
         split_method=$8, split_input=$9::jsonb, receipt_id=$10, version=$11, updated_at=now() WHERE id=$1`,
      [expenseId, input.title, p.amount.toString(), p.payer, input.category, input.date, input.notes || null, input.split.method, JSON.stringify(p.stored), input.receiptId || null, newVersion],
      c,
    );
    await q(`DELETE FROM split.expense_participants WHERE expense_id = $1`, [expenseId], c);
    await insertParticipants(c, expenseId, p);
    await q(
      `INSERT INTO split.expense_revisions (expense_id, group_id, version, action, is_adjustment, reason, snapshot, deltas, actor)
       VALUES ($1,$2,$3,'edited',$4,$5,$6::jsonb,$7::jsonb,$8)`,
      [
        expenseId,
        groupId,
        newVersion,
        touched.touched,
        input.reason || null,
        JSON.stringify(snapshot({ ...input, amount: p.amount, payer: p.payer, notes: input.notes ?? null }, p)),
        JSON.stringify(serializeDeltas(deltas)),
        actor,
      ],
      c,
    );
    await recordActivity(c, groupId, actor, touched.touched ? "expense_adjusted" : "expense_edited", {
      expenseId,
      title: input.title,
      amount: p.amount.toString(),
      previousAmount: before.amount,
      version: newVersion,
      reason: input.reason || null,
      deltas: serializeDeltas(deltas),
    });
    const affected = [...deltas.keys()].filter((m) => m !== actor);
    if (affected.length) {
      const prof = await getProfiles([actor], c);
      await notify(c, affected, {
        groupId,
        type: "expense_changed",
        title: `${displayName(prof[actor], actor)} ${touched.touched ? "adjusted" : "edited"} “${input.title}”`,
        body: touched.touched ? `Recorded as an adjustment: ${input.reason}` : "Balances were recalculated.",
        href: `/groups/${groupId}/expenses/${expenseId}`,
        data: { expenseId },
      });
    }
    return { id: expenseId, version: newVersion, adjustment: touched.touched };
  });
}

export async function deleteExpense(groupId: string, expenseId: string, actor: string, input: { expectedVersion: number; reason?: string | null }) {
  const { membership } = await requireMember(groupId, actor);
  return withTx(async (c) => {
    const before = await lockExpense(c, groupId, expenseId);
    if (before.deleted_at) throw conflict("This expense was already deleted", "EXPENSE_DELETED");
    if (!canModify(membership.role, actor, before)) {
      throw forbidden("Only the person who added or paid this expense, or a group admin, can delete it");
    }
    if (before.version !== input.expectedVersion) {
      throw conflict("Someone else changed this expense. Reload to see the latest version.", "VERSION_CONFLICT");
    }
    const touched = await settlementTouched(c, groupId, before);
    if (touched.touched && !input.reason?.trim()) {
      throw new ApiError(
        400,
        "REASON_REQUIRED",
        "This expense has already been (partly) settled. Add a short reason — the removal will be recorded as an adjustment.",
      );
    }
    const deltas = diffExpenseEffects(toLedgerExpense(before), null);
    const newVersion = before.version + 1;
    await q(
      `UPDATE split.expenses SET deleted_at = now(), deleted_by = $2, delete_reason = $3, version = $4, updated_at = now() WHERE id = $1`,
      [expenseId, actor, input.reason || null, newVersion],
      c,
    );
    await q(
      `INSERT INTO split.expense_revisions (expense_id, group_id, version, action, is_adjustment, reason, snapshot, deltas, actor)
       VALUES ($1,$2,$3,'deleted',$4,$5,'{}'::jsonb,$6::jsonb,$7)`,
      [expenseId, groupId, newVersion, touched.touched, input.reason || null, JSON.stringify(serializeDeltas(deltas)), actor],
      c,
    );
    await recordActivity(c, groupId, actor, touched.touched ? "expense_adjusted" : "expense_deleted", {
      expenseId,
      title: before.title,
      amount: before.amount,
      deleted: true,
      reason: input.reason || null,
      deltas: serializeDeltas(deltas),
    });
    const affected = [...deltas.keys()].filter((m) => m !== actor);
    if (affected.length) {
      const prof = await getProfiles([actor], c);
      await notify(c, affected, {
        groupId,
        type: "expense_changed",
        title: `${displayName(prof[actor], actor)} removed “${before.title}”`,
        body: input.reason ? `Reason: ${input.reason}` : "Balances were recalculated.",
        href: `/groups/${groupId}/expenses/${expenseId}`,
        data: { expenseId },
      });
    }
    return { id: expenseId, version: newVersion, adjustment: touched.touched };
  });
}

export async function getExpenseRevisions(expenseId: string) {
  return q<{
    id: string;
    version: number;
    action: string;
    is_adjustment: boolean;
    reason: string | null;
    snapshot: Record<string, unknown>;
    deltas: Record<string, string>;
    actor: string;
    created_at: Date;
  }>(`SELECT * FROM split.expense_revisions WHERE expense_id = $1 ORDER BY version DESC`, [expenseId]);
}
