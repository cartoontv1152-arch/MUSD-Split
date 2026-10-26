import { deleteExpense, getExpenseRevisions, updateExpense } from "@/lib/server/expenses";
import { EXPENSE_SELECT, expenseDTO, isAdmin, loadLedger, requireMember, settlementDTO } from "@/lib/server/groups";
import { q1 } from "@/lib/server/db";
import { json, notFound, readJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { getProfiles } from "@/lib/server/users";
import { expenseDeleteSchema, expenseUpdateSchema } from "@/lib/validation";
import type { ExpenseRow } from "@/lib/server/groups";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string; eid: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  const { group, membership } = await requireMember(params.id, s.address);
  if (!/^[0-9a-f-]{36}$/i.test(params.eid)) throw notFound("Expense not found");
  const e = await q1<ExpenseRow>(`${EXPENSE_SELECT} WHERE e.id = $1 AND e.group_id = $2`, [params.eid, params.id]);
  if (!e) throw notFound("Expense not found");
  const loaded = await loadLedger(group);
  const cov = loaded.ledger.coverage.get(e.id);
  const revisions = await getExpenseRevisions(e.id);
  const linked = loaded.settlements.filter((x) => (x.expense_ids ?? []).includes(e.id));
  const receipt = e.receipt_id
    ? await q1<{ id: string; mime: string; size: number; filename: string | null }>(
        `SELECT id, mime, size, filename FROM split.receipts WHERE id = $1`,
        [e.receipt_id],
      )
    : null;
  const profiles = await getProfiles([
    e.payer,
    e.created_by,
    ...e.participants.map((p) => p.address),
    ...revisions.map((r) => r.actor),
    ...linked.flatMap((x) => [x.from_address, x.to_address]),
  ]);
  return json({
    expense: {
      ...expenseDTO(e),
      status: e.deleted_at ? "deleted" : (cov?.status ?? "open"),
      outstanding: (cov?.outstanding ?? 0n).toString(),
      coverage: (cov?.participants ?? []).map((p) => ({
        member: p.member,
        share: p.share.toString(),
        outstanding: p.outstanding.toString(),
        isPayer: p.isPayer,
      })),
    },
    canEdit: !e.deleted_at && (isAdmin(membership.role) || e.created_by === s.address || e.payer === s.address),
    revisions: revisions.map((r) => ({
      id: String(r.id),
      version: r.version,
      action: r.action,
      isAdjustment: r.is_adjustment,
      reason: r.reason,
      snapshot: r.snapshot,
      deltas: r.deltas,
      actor: r.actor,
      createdAt: r.created_at.toISOString(),
    })),
    settlements: linked.map(settlementDTO),
    receipt,
    profiles,
    groupName: group.name,
  });
});

export const PATCH = route<{ id: string; eid: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  const input = expenseUpdateSchema.parse(await readJson(req));
  return json(await updateExpense(params.id, params.eid, s.address, input));
});

export const DELETE = route<{ id: string; eid: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  const input = expenseDeleteSchema.parse(await readJson(req));
  return json(await deleteExpense(params.id, params.eid, s.address, input));
});
