import "server-only";
import { computeGroupLedger, type GroupLedger, type LedgerExpense, type LedgerSettlement, type SettlementStatus } from "@/lib/engine";
import { q, q1, type Queryable } from "./db";
import { forbidden, notFound } from "./http";

export type Role = "owner" | "admin" | "member";

export interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  created_by: string;
  members_can_invite: boolean;
  simplify_debts: boolean;
  currency: string;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

export interface MemberRow {
  group_id: string;
  address: string;
  role: Role;
  status: "active" | "left" | "removed";
  joined_at: Date;
  left_at: Date | null;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getGroup(groupId: string, client?: Queryable): Promise<GroupRow | null> {
  if (!UUID_RE.test(groupId)) return null;
  return q1<GroupRow>(`SELECT * FROM split.groups WHERE id = $1`, [groupId], client);
}

export async function getMembership(groupId: string, address: string, client?: Queryable): Promise<MemberRow | null> {
  return q1<MemberRow>(
    `SELECT * FROM split.group_members WHERE group_id = $1 AND address = $2`,
    [groupId, address.toLowerCase()],
    client,
  );
}

/** Authorization gate used by every group-scoped route: the caller must be an ACTIVE member. */
export async function requireMember(groupId: string, address: string, client?: Queryable) {
  const group = await getGroup(groupId, client);
  if (!group) throw notFound("Group not found");
  const membership = await getMembership(groupId, address, client);
  if (!membership || membership.status !== "active") throw forbidden("You're not a member of this group");
  return { group, membership };
}

export function isAdmin(role: Role): boolean {
  return role === "owner" || role === "admin";
}

export async function requireAdmin(groupId: string, address: string, client?: Queryable) {
  const ctx = await requireMember(groupId, address, client);
  if (!isAdmin(ctx.membership.role)) throw forbidden("Only group admins can do this");
  return ctx;
}

export async function listMembers(groupId: string, client?: Queryable): Promise<MemberRow[]> {
  return q<MemberRow>(
    `SELECT * FROM split.group_members WHERE group_id = $1 ORDER BY
       CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, joined_at`,
    [groupId],
    client,
  );
}

export interface ExpenseRow {
  id: string;
  group_id: string;
  title: string;
  amount: string;
  currency: string;
  payer: string;
  category: string;
  expense_date: string;
  notes: string | null;
  split_method: "equal" | "custom" | "percentage" | "shares";
  split_input: Record<string, unknown>;
  receipt_id: string | null;
  recurring_id: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  version: number;
  deleted_at: Date | null;
  deleted_by: string | null;
  delete_reason: string | null;
  participants: Array<{ address: string; share: string; input: string | null }>;
}

export const EXPENSE_SELECT = `
  SELECT e.id, e.group_id, e.title, e.amount::text AS amount, e.currency, e.payer, e.category,
         to_char(e.expense_date, 'YYYY-MM-DD') AS expense_date, e.notes, e.split_method, e.split_input,
         e.receipt_id, e.recurring_id, e.created_by, e.created_at, e.updated_at, e.version,
         e.deleted_at, e.deleted_by, e.delete_reason,
         COALESCE((SELECT json_agg(json_build_object('address', p.address, 'share', p.share::text, 'input', p.input) ORDER BY p.address)
                   FROM split.expense_participants p WHERE p.expense_id = e.id), '[]'::json) AS participants
  FROM split.expenses e`;

export async function listExpenses(groupId: string, opts: { includeDeleted?: boolean } = {}, client?: Queryable) {
  return q<ExpenseRow>(
    `${EXPENSE_SELECT} WHERE e.group_id = $1 ${opts.includeDeleted ? "" : "AND e.deleted_at IS NULL"}
     ORDER BY e.expense_date DESC, e.created_at DESC LIMIT 1000`,
    [groupId],
    client,
  );
}

export function toLedgerExpense(e: ExpenseRow): LedgerExpense {
  return {
    id: e.id,
    payer: e.payer,
    total: BigInt(e.amount),
    shares: e.participants.map((p) => ({ member: p.address, share: BigInt(p.share) })),
    date: e.expense_date,
    createdAt: new Date(e.created_at).getTime(),
  };
}

export interface SettlementRow {
  id: string;
  group_id: string;
  from_address: string;
  to_address: string;
  amount: string;
  method: "direct" | "contract" | "contract_permit" | "batch" | "batch_permit";
  settlement_key: string;
  status: SettlementStatus;
  tx_hash: string | null;
  log_index: number | null;
  block_number: string | null;
  block_time: Date | null;
  chain_id: number;
  created_block: string | null;
  payment_request_id: string | null;
  batch_id: string | null;
  expense_ids: string[];
  note: string | null;
  failure_code: string | null;
  failure_reason: string | null;
  rejected_tx_hash: string | null;
  verify_attempts: number;
  last_checked_at: Date | null;
  created_at: Date;
  submitted_at: Date | null;
  confirmed_at: Date | null;
  updated_at: Date;
}

export const SETTLEMENT_SELECT = `SELECT s.*, s.amount::text AS amount, s.block_number::text AS block_number,
  s.created_block::text AS created_block FROM split.settlements s`;

export async function listSettlements(groupId: string, client?: Queryable) {
  return q<SettlementRow>(`${SETTLEMENT_SELECT} WHERE s.group_id = $1 ORDER BY s.created_at DESC`, [groupId], client);
}

export function toLedgerSettlement(s: SettlementRow): LedgerSettlement {
  return { id: s.id, from: s.from_address, to: s.to_address, amount: BigInt(s.amount), status: s.status };
}

export interface LoadedLedger {
  group: GroupRow;
  members: MemberRow[];
  expenses: ExpenseRow[];
  settlements: SettlementRow[];
  ledger: GroupLedger;
  activeMembers: Set<string>;
}

export async function loadLedger(group: GroupRow, client?: Queryable): Promise<LoadedLedger> {
  const [members, expenses, settlements] = await Promise.all([
    listMembers(group.id, client),
    listExpenses(group.id, {}, client),
    listSettlements(group.id, client),
  ]);
  const ledger = computeGroupLedger({
    members: members.map((m) => m.address),
    expenses: expenses.map(toLedgerExpense),
    settlements: settlements.map(toLedgerSettlement),
  });
  return {
    group,
    members,
    expenses,
    settlements,
    ledger,
    activeMembers: new Set(members.filter((m) => m.status === "active").map((m) => m.address)),
  };
}

export function groupDTO(g: GroupRow) {
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    icon: g.icon,
    color: g.color,
    createdBy: g.created_by,
    createdAt: g.created_at.toISOString(),
    membersCanInvite: g.members_can_invite,
    simplifyDebts: g.simplify_debts,
    currency: g.currency,
    archivedAt: g.archived_at?.toISOString() ?? null,
  };
}

export function settlementDTO(s: SettlementRow) {
  return {
    id: s.id,
    groupId: s.group_id,
    from: s.from_address,
    to: s.to_address,
    amount: s.amount,
    method: s.method,
    settlementKey: s.settlement_key,
    status: s.status,
    txHash: s.tx_hash,
    logIndex: s.log_index,
    blockNumber: s.block_number,
    blockTime: s.block_time?.toISOString() ?? null,
    chainId: s.chain_id,
    paymentRequestId: s.payment_request_id,
    batchId: s.batch_id,
    expenseIds: s.expense_ids ?? [],
    note: s.note,
    failureCode: s.failure_code,
    failureReason: s.failure_reason,
    rejectedTxHash: s.rejected_tx_hash,
    verifyAttempts: s.verify_attempts,
    lastCheckedAt: s.last_checked_at?.toISOString() ?? null,
    createdAt: s.created_at.toISOString(),
    submittedAt: s.submitted_at?.toISOString() ?? null,
    confirmedAt: s.confirmed_at?.toISOString() ?? null,
  };
}

export function expenseDTO(e: ExpenseRow) {
  return {
    id: e.id,
    groupId: e.group_id,
    title: e.title,
    amount: e.amount,
    currency: e.currency,
    payer: e.payer,
    category: e.category,
    date: e.expense_date,
    notes: e.notes,
    splitMethod: e.split_method,
    splitInput: e.split_input,
    receiptId: e.receipt_id,
    recurringId: e.recurring_id,
    createdBy: e.created_by,
    createdAt: new Date(e.created_at).toISOString(),
    updatedAt: new Date(e.updated_at).toISOString(),
    version: e.version,
    deletedAt: e.deleted_at ? new Date(e.deleted_at).toISOString() : null,
    deleteReason: e.delete_reason,
    participants: e.participants,
  };
}

/** Serialize the engine output for the client (bigints -> decimal strings). */
export function ledgerDTO(l: GroupLedger) {
  return {
    nets: Object.fromEntries([...l.nets.entries()].map(([k, v]) => [k, v.toString()])),
    simplified: l.simplified.map((t) => ({ ...t, amount: t.amount.toString() })),
    pairwise: l.pairwise.map((t) => ({ ...t, amount: t.amount.toString() })),
    totalSpent: l.totalSpent.toString(),
    totalSettled: l.totalSettled.toString(),
    outstanding: l.outstanding.toString(),
  };
}
