/**
 * Balance engine: net balances and pairwise debts.
 *
 * Sign convention: a POSITIVE net balance means the member should RECEIVE money,
 * a NEGATIVE net balance means the member OWES money.
 *
 * An expense records what participants agreed they spent (payer +total, each participant -share).
 * A settlement records MUSD that actually moved on-chain (from +amount, to -amount).
 * Only settlements in status "confirmed" (server-verified on-chain) affect balances.
 */

import { sumBig } from "./money";
import type { Share } from "./split";

export interface LedgerExpense {
  id: string;
  payer: string;
  total: bigint;
  shares: Share[];
  /** ISO date (YYYY-MM-DD) of the expense; used for deterministic ordering. */
  date: string;
  /** Creation timestamp (ms) used as tiebreaker. */
  createdAt: number;
}

export type SettlementStatus =
  | "created"
  | "submitted"
  | "delayed"
  | "confirmed"
  | "failed"
  | "rejected"
  | "cancelled";

export interface LedgerSettlement {
  id: string;
  from: string;
  to: string;
  amount: bigint;
  status: SettlementStatus;
}

export class LedgerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

/** Throws if an expense's shares don't add up exactly to its total. */
export function assertExpenseConsistent(e: LedgerExpense): void {
  if (e.total <= 0n) throw new LedgerError(`Expense ${e.id} has a non-positive total`, "INVALID_TOTAL");
  if (e.shares.length === 0) throw new LedgerError(`Expense ${e.id} has no participants`, "NO_PARTICIPANTS");
  const seen = new Set<string>();
  for (const s of e.shares) {
    if (s.share < 0n) throw new LedgerError(`Expense ${e.id} has a negative share`, "NEGATIVE_SHARE");
    if (seen.has(s.member)) throw new LedgerError(`Expense ${e.id} lists ${s.member} twice`, "DUPLICATE");
    seen.add(s.member);
  }
  const sum = sumBig(e.shares.map((s) => s.share));
  if (sum !== e.total) {
    throw new LedgerError(`Expense ${e.id} shares sum to ${sum}, expected ${e.total}`, "SHARES_MISMATCH");
  }
}

/** Effect of a single expense on member balances (sums to zero). */
export function expenseEffects(e: LedgerExpense): Map<string, bigint> {
  assertExpenseConsistent(e);
  const m = new Map<string, bigint>();
  m.set(e.payer, (m.get(e.payer) ?? 0n) + e.total);
  for (const s of e.shares) m.set(s.member, (m.get(s.member) ?? 0n) - s.share);
  return m;
}

export function isCountedSettlement(s: LedgerSettlement): boolean {
  return s.status === "confirmed";
}

/**
 * Net balance per member. Every listed member gets an entry (zero if untouched).
 * Members who appear only in history (e.g. left the group) are included too.
 */
export function computeNetBalances(input: {
  members?: string[];
  expenses: LedgerExpense[];
  settlements: LedgerSettlement[];
}): Map<string, bigint> {
  const nets = new Map<string, bigint>();
  for (const m of input.members ?? []) nets.set(m, 0n);
  const add = (k: string, v: bigint) => nets.set(k, (nets.get(k) ?? 0n) + v);

  const seenExpense = new Set<string>();
  for (const e of input.expenses) {
    if (seenExpense.has(e.id)) throw new LedgerError(`Expense ${e.id} counted twice`, "DUPLICATE_EXPENSE");
    seenExpense.add(e.id);
    for (const [k, v] of expenseEffects(e)) add(k, v);
  }

  const seenSettlement = new Set<string>();
  for (const s of input.settlements) {
    if (!isCountedSettlement(s)) continue;
    if (seenSettlement.has(s.id)) {
      throw new LedgerError(`Settlement ${s.id} counted twice`, "DUPLICATE_SETTLEMENT");
    }
    seenSettlement.add(s.id);
    if (s.amount <= 0n) throw new LedgerError(`Settlement ${s.id} has a non-positive amount`, "INVALID_AMOUNT");
    if (s.from === s.to) throw new LedgerError(`Settlement ${s.id} pays itself`, "SELF_SETTLEMENT");
    add(s.from, s.amount);
    add(s.to, -s.amount);
  }
  return nets;
}

export interface Transfer {
  from: string;
  to: string;
  amount: bigint;
}

/**
 * Raw "who owes whom" graph without simplification: every expense share creates a debt from
 * the participant to the payer; confirmed settlements pay down the debt from payer to payee.
 * Each unordered pair is netted to a single directed edge. Node sums equal the net balances.
 */
export function pairwiseDebts(input: {
  expenses: LedgerExpense[];
  settlements: LedgerSettlement[];
}): Transfer[] {
  // owed[a|b] = amount a owes b (may be negative before netting)
  const owed = new Map<string, bigint>();
  const key = (a: string, b: string) => `${a}|${b}`;
  const addDebt = (debtor: string, creditor: string, v: bigint) => {
    if (debtor === creditor || v === 0n) return;
    owed.set(key(debtor, creditor), (owed.get(key(debtor, creditor)) ?? 0n) + v);
  };
  for (const e of input.expenses) {
    assertExpenseConsistent(e);
    for (const s of e.shares) addDebt(s.member, e.payer, s.share);
  }
  for (const s of input.settlements) {
    if (!isCountedSettlement(s)) continue;
    addDebt(s.from, s.to, -s.amount);
  }
  const pairs = new Map<string, bigint>(); // canonical a<b: positive => a owes b
  for (const [k, v] of owed) {
    const [a, b] = k.split("|") as [string, string];
    if (a < b) pairs.set(key(a, b), (pairs.get(key(a, b)) ?? 0n) + v);
    else pairs.set(key(b, a), (pairs.get(key(b, a)) ?? 0n) - v);
  }
  const out: Transfer[] = [];
  for (const [k, v] of pairs) {
    if (v === 0n) continue;
    const [a, b] = k.split("|") as [string, string];
    out.push(v > 0n ? { from: a, to: b, amount: v } : { from: b, to: a, amount: -v });
  }
  return out.sort(compareTransfers);
}

export function compareTransfers(x: Transfer, y: Transfer): number {
  if (x.amount !== y.amount) return x.amount > y.amount ? -1 : 1;
  if (x.from !== y.from) return x.from < y.from ? -1 : 1;
  if (x.to !== y.to) return x.to < y.to ? -1 : 1;
  return 0;
}

/** Net balance per member implied by a list of transfers-owed (debtor -> creditor). */
export function netsFromTransfers(transfers: Transfer[]): Map<string, bigint> {
  const nets = new Map<string, bigint>();
  for (const t of transfers) {
    nets.set(t.from, (nets.get(t.from) ?? 0n) - t.amount);
    nets.set(t.to, (nets.get(t.to) ?? 0n) + t.amount);
  }
  return nets;
}

/** Totals for a single member: what they owe and what they're owed (both >= 0). */
export function memberPosition(net: bigint): { owes: bigint; owed: bigint } {
  return net < 0n ? { owes: -net, owed: 0n } : { owes: 0n, owed: net };
}

/** Sum of all positive balances = total outstanding in the group. */
export function totalOutstanding(nets: Map<string, bigint>): bigint {
  let s = 0n;
  for (const v of nets.values()) if (v > 0n) s += v;
  return s;
}
