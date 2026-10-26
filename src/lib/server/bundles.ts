import "server-only";
import { memberPosition } from "@/lib/engine";
import { q } from "./db";
import { expenseDTO, groupDTO, isAdmin, ledgerDTO, loadLedger, requireMember, settlementDTO, type GroupRow } from "./groups";
import { listRecurring, recurringDTO, upcomingForUser } from "./recurring";
import { listRequestsForGroup, listRequestsForUser, requestDTO } from "./requests";
import { getProfiles } from "./users";

export interface ActivityRow {
  id: string;
  group_id: string;
  actor: string | null;
  type: string;
  data: Record<string, unknown>;
  created_at: Date;
  group_name?: string;
}

export function activityDTO(a: ActivityRow) {
  return {
    id: String(a.id),
    groupId: a.group_id,
    groupName: a.group_name ?? null,
    actor: a.actor,
    type: a.type,
    data: a.data,
    createdAt: a.created_at.toISOString(),
  };
}

export async function groupActivity(groupId: string, before?: string | null, limit = 40) {
  return q<ActivityRow>(
    `SELECT * FROM split.activity WHERE group_id = $1 AND ($2::bigint IS NULL OR id < $2::bigint) ORDER BY id DESC LIMIT $3`,
    [groupId, before ?? null, limit],
  );
}

function collectAddresses(...lists: Array<Array<string | null | undefined>>): string[] {
  const s = new Set<string>();
  for (const l of lists) for (const a of l) if (a && /^0x[0-9a-f]{40}$/.test(a)) s.add(a);
  return [...s];
}

export async function groupBundle(groupId: string, me: string) {
  const { group, membership } = await requireMember(groupId, me);
  const loaded = await loadLedger(group);
  const [requests, recurring, activity] = await Promise.all([
    listRequestsForGroup(groupId),
    listRecurring(groupId),
    groupActivity(groupId),
  ]);
  const actAddrs = activity.flatMap((a) => [a.actor, a.data.from as string, a.data.to as string, a.data.payer as string]);
  const profiles = await getProfiles(
    collectAddresses(
      loaded.members.map((m) => m.address),
      loaded.expenses.flatMap((e) => [e.payer, e.created_by, ...e.participants.map((p) => p.address)]),
      loaded.settlements.flatMap((s) => [s.from_address, s.to_address]),
      requests.flatMap((r) => [r.requester, r.payer]),
      actAddrs,
    ),
  );
  const coverage = loaded.ledger.coverage;
  return {
    group: groupDTO(group),
    me: { address: me, role: membership.role, isAdmin: isAdmin(membership.role) },
    members: loaded.members.map((m) => ({
      address: m.address,
      role: m.role,
      status: m.status,
      joinedAt: m.joined_at.toISOString(),
      net: (loaded.ledger.nets.get(m.address) ?? 0n).toString(),
    })),
    profiles,
    ledger: ledgerDTO(loaded.ledger),
    expenses: loaded.expenses.map((e) => {
      const c = coverage.get(e.id);
      return {
        ...expenseDTO(e),
        status: c?.status ?? "open",
        outstanding: (c?.outstanding ?? 0n).toString(),
        coverage: (c?.participants ?? []).map((p) => ({ member: p.member, share: p.share.toString(), outstanding: p.outstanding.toString(), isPayer: p.isPayer })),
      };
    }),
    settlements: loaded.settlements.filter((s) => s.status !== "cancelled" || s.from_address === me).slice(0, 200).map(settlementDTO),
    requests: requests.map(requestDTO),
    recurring: recurring.map(recurringDTO),
    activity: activity.map(activityDTO),
  };
}

export async function myGroups(me: string) {
  const groups = await q<GroupRow & { role: string; member_count: string }>(
    `SELECT g.*, m.role, (SELECT count(*) FROM split.group_members x WHERE x.group_id = g.id AND x.status = 'active')::text AS member_count
     FROM split.groups g JOIN split.group_members m ON m.group_id = g.id
     WHERE m.address = $1 AND m.status = 'active' ORDER BY g.updated_at DESC`,
    [me],
  );
  const out = [];
  for (const g of groups) {
    const loaded = await loadLedger(g);
    const net = loaded.ledger.nets.get(me) ?? 0n;
    const last = loaded.expenses[0];
    out.push({
      ...groupDTO(g),
      role: g.role,
      memberCount: Number(g.member_count),
      members: loaded.members.filter((m) => m.status === "active").map((m) => m.address),
      net: net.toString(),
      totalSpent: loaded.ledger.totalSpent.toString(),
      outstanding: loaded.ledger.outstanding.toString(),
      expenseCount: loaded.expenses.length,
      lastActivityAt: (last ? new Date(last.created_at) : g.created_at).toISOString(),
      settledUp: [...loaded.ledger.nets.values()].every((v) => v === 0n),
      _loaded: loaded,
    });
  }
  return out;
}

export async function dashboardBundle(me: string) {
  const groups = await myGroups(me);
  let owes = 0n;
  let owed = 0n;
  const recentExpenses: Array<ReturnType<typeof expenseDTO> & { groupName: string; myShare: string | null }> = [];
  const mySettlements: Array<ReturnType<typeof settlementDTO> & { groupName: string }> = [];
  const myDebts: Array<{ groupId: string; groupName: string; to: string; amount: string }> = [];
  for (const g of groups) {
    const pos = memberPosition(BigInt(g.net));
    owes += pos.owes;
    owed += pos.owed;
    const l = g._loaded;
    for (const e of l.expenses.slice(0, 6)) {
      const mine = e.participants.find((p) => p.address === me);
      recentExpenses.push({ ...expenseDTO(e), groupName: g.name, myShare: mine?.share ?? null });
    }
    for (const s of l.settlements) {
      if ((s.from_address === me || s.to_address === me) && s.status !== "cancelled") mySettlements.push({ ...settlementDTO(s), groupName: g.name });
    }
    const route = g.simplifyDebts ? l.ledger.simplified : l.ledger.pairwise;
    for (const t of route) if (t.from === me) myDebts.push({ groupId: g.id, groupName: g.name, to: t.to, amount: t.amount.toString() });
  }
  recentExpenses.sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)));
  mySettlements.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const requests = (await listRequestsForUser(me)).map(requestDTO);
  const upcoming = (await upcomingForUser(me)).map((r) => ({ ...recurringDTO(r), groupName: r.group_name }));
  const groupList = groups.map(({ _loaded, ...rest }) => {
    void _loaded;
    return rest;
  });
  const profiles = await getProfiles(
    collectAddresses(
      groupList.flatMap((g) => g.members),
      recentExpenses.map((e) => e.payer),
      mySettlements.flatMap((s) => [s.from, s.to]),
      requests.flatMap((r) => [r.requester, r.payer]),
      myDebts.map((d) => d.to),
    ),
  );
  return {
    totals: { owes: owes.toString(), owed: owed.toString(), net: (owed - owes).toString(), activeGroups: groupList.length },
    groups: groupList,
    recentExpenses: recentExpenses.slice(0, 8),
    pendingRequests: requests.filter((r) => r.status === "pending"),
    inFlight: mySettlements.filter((s) => ["created", "submitted", "delayed"].includes(s.status) && s.from === me),
    recentSettlements: mySettlements.filter((s) => s.status === "confirmed").slice(0, 6),
    myDebts,
    upcoming,
    profiles,
  };
}
