import "server-only";
import { formatAmount, parseAmount } from "@/lib/engine";
import { q, q1, withTx } from "./db";
import { notify, recordActivity } from "./events";
import { loadLedger, requireMember } from "./groups";
import { badRequest, conflict, forbidden, notFound } from "./http";
import { getProfiles } from "./users";

export interface RequestRow {
  id: string;
  group_id: string;
  requester: string;
  payer: string;
  amount: string;
  note: string | null;
  expense_ids: string[];
  status: "pending" | "paid" | "cancelled" | "declined" | "expired";
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
  paid_settlement_id: string | null;
  group_name?: string;
  settlement_tx_hash?: string | null;
}

export function requestDTO(r: RequestRow) {
  return {
    id: r.id,
    groupId: r.group_id,
    groupName: r.group_name ?? null,
    requester: r.requester,
    payer: r.payer,
    amount: r.amount,
    note: r.note,
    expenseIds: r.expense_ids ?? [],
    status: r.status,
    expiresAt: r.expires_at?.toISOString() ?? null,
    createdAt: r.created_at.toISOString(),
    closedAt: r.closed_at?.toISOString() ?? null,
    paidSettlementId: r.paid_settlement_id,
    settlementTxHash: r.settlement_tx_hash ?? null,
  };
}

/** Lazily expire pending requests past their expiry (also done by the daily cron). */
export async function expireRequests(where: { address?: string; groupId?: string } = {}) {
  await q(
    `UPDATE split.payment_requests SET status = 'expired', closed_at = now(), updated_at = now()
     WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < now()
       AND ($1::text IS NULL OR payer = $1 OR requester = $1) AND ($2::uuid IS NULL OR group_id = $2)`,
    [where.address ?? null, where.groupId ?? null],
  );
}

const SELECT = `SELECT r.*, r.amount::text AS amount, g.name AS group_name, s.tx_hash AS settlement_tx_hash
  FROM split.payment_requests r JOIN split.groups g ON g.id = r.group_id
  LEFT JOIN split.settlements s ON s.id = r.paid_settlement_id`;

export async function listRequestsForUser(address: string) {
  await expireRequests({ address });
  const rows = await q<RequestRow>(
    `${SELECT} WHERE (r.payer = $1 OR r.requester = $1)
       AND EXISTS (SELECT 1 FROM split.group_members m WHERE m.group_id = r.group_id AND m.address = $1)
     ORDER BY r.created_at DESC LIMIT 200`,
    [address],
  );
  return rows;
}

export async function listRequestsForGroup(groupId: string) {
  await expireRequests({ groupId });
  return q<RequestRow>(`${SELECT} WHERE r.group_id = $1 ORDER BY r.created_at DESC LIMIT 200`, [groupId]);
}

export async function getRequest(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return q1<RequestRow>(`${SELECT} WHERE r.id = $1`, [id]);
}

export async function createRequest(
  groupId: string,
  actor: string,
  input: { payer: string; amount: string; note?: string | null; expenseIds?: string[]; expiresInDays?: number | null },
) {
  const { group } = await requireMember(groupId, actor);
  const payer = input.payer.toLowerCase();
  if (payer === actor) throw badRequest("You can't request money from yourself", "SELF_REQUEST");
  const amount = parseAmount(input.amount);
  return withTx(async (c) => {
    const loaded = await loadLedger(group, c);
    if (!loaded.activeMembers.has(payer)) throw badRequest("That person isn't an active member of this group", "PAYER_NOT_MEMBER");
    const debt = -(loaded.ledger.nets.get(payer) ?? 0n);
    if (debt <= 0n) throw conflict("This member doesn't owe anything in this group right now", "NOTHING_OWED");
    if (amount > debt) {
      throw conflict(`This member currently owes ${formatAmount(debt)} MUSD in this group — request that or less`, "EXCEEDS_DEBT", {
        max: debt.toString(),
      });
    }
    const dup = await q1(
      `SELECT id FROM split.payment_requests WHERE group_id=$1 AND requester=$2 AND payer=$3 AND amount=$4::numeric AND status='pending'
         AND created_at > now() - interval '2 minutes'`,
      [groupId, actor, payer, amount.toString()],
      c,
    );
    if (dup) throw conflict("You just sent this exact request", "DUPLICATE_REQUEST");
    const expenseIds = [...new Set(input.expenseIds ?? [])];
    const known = new Set(loaded.expenses.map((e) => e.id));
    if (expenseIds.some((e) => !known.has(e))) throw badRequest("Unknown expense in this group", "UNKNOWN_EXPENSE");
    const id = crypto.randomUUID();
    await q(
      `INSERT INTO split.payment_requests (id, group_id, requester, payer, amount, note, expense_ids, expires_at)
       VALUES ($1,$2,$3,$4,$5::numeric,$6,$7::uuid[], CASE WHEN $8::int IS NULL THEN NULL ELSE now() + make_interval(days => $8::int) END)`,
      [id, groupId, actor, payer, amount.toString(), input.note || null, expenseIds, input.expiresInDays ?? null],
      c,
    );
    await recordActivity(c, groupId, actor, "payment_requested", { requestId: id, requester: actor, payer, amount: amount.toString(), note: input.note || null });
    const prof = await getProfiles([actor], c);
    const who = prof[actor]?.displayName || `${actor.slice(0, 6)}…${actor.slice(-4)}`;
    await notify(c, [payer], {
      groupId,
      type: "payment_requested",
      title: `${who} requested ${formatAmount(amount)} MUSD`,
      body: input.note || `In ${group.name}`,
      href: `/requests?focus=${id}`,
      data: { requestId: id },
    });
    return id;
  });
}

export async function closeRequest(id: string, actor: string, action: "cancel" | "decline") {
  const r = await getRequest(id);
  if (!r) throw notFound("Request not found");
  await requireMember(r.group_id, actor);
  if (action === "cancel" && r.requester !== actor) throw forbidden("Only the requester can cancel this request");
  if (action === "decline" && r.payer !== actor) throw forbidden("Only the person asked to pay can decline");
  if (r.status !== "pending") throw conflict(`This request is already ${r.status}`, "REQUEST_CLOSED");
  return withTx(async (c) => {
    const inflight = await q1(
      `SELECT 1 FROM split.settlements WHERE payment_request_id = $1 AND status IN ('submitted','delayed')`,
      [id],
      c,
    );
    if (inflight) throw conflict("A payment for this request is being confirmed right now", "PAYMENT_IN_FLIGHT");
    const status = action === "cancel" ? "cancelled" : "declined";
    const row = await q1(
      `UPDATE split.payment_requests SET status=$2, closed_at=now(), updated_at=now() WHERE id=$1 AND status='pending' RETURNING id`,
      [id, status],
      c,
    );
    if (!row) throw conflict("This request changed in the meantime", "STATE_CHANGED");
    await recordActivity(c, r.group_id, actor, action === "cancel" ? "payment_request_cancelled" : "payment_request_declined", {
      requestId: id,
      amount: r.amount,
      requester: r.requester,
      payer: r.payer,
    });
    return status;
  });
}
