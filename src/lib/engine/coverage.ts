/**
 * Expense settlement status (derived, never stored).
 *
 * Rule — FIFO repayment: a member's outstanding debt (max(0, -net)) is attributed to their most
 * recent expense shares; older shares are considered covered first. Coverage can come from real
 * confirmed MUSD settlements or from offsets (money others owe that member in the same group).
 *
 * Per expense:
 *   - "settled"  every non-payer participant's share is fully covered
 *   - "open"     no non-payer share is covered at all
 *   - "partial"  anything in between
 * The payer's own share is always covered (they fronted the money).
 */

import type { LedgerExpense } from "./balances";

export type ExpenseSettlementStatus = "settled" | "partial" | "open";

export interface ParticipantCoverage {
  member: string;
  share: bigint;
  outstanding: bigint;
  isPayer: boolean;
}

export interface ExpenseCoverage {
  expenseId: string;
  status: ExpenseSettlementStatus;
  participants: ParticipantCoverage[];
  outstanding: bigint;
}

function compareExpenseAsc(a: LedgerExpense, b: LedgerExpense): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function computeCoverage(
  expenses: LedgerExpense[],
  nets: Map<string, bigint>,
): Map<string, ExpenseCoverage> {
  const sorted = [...expenses].sort(compareExpenseAsc);
  // outstanding per (expenseId|member)
  const outstanding = new Map<string, bigint>();
  const remainingDebt = new Map<string, bigint>();
  for (const [m, v] of nets) remainingDebt.set(m, v < 0n ? -v : 0n);

  // newest first
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i];
    for (const s of e.shares) {
      if (s.member === e.payer || s.share === 0n) continue;
      const rem = remainingDebt.get(s.member) ?? 0n;
      const take = rem < s.share ? rem : s.share;
      if (take > 0n) {
        outstanding.set(`${e.id}|${s.member}`, take);
        remainingDebt.set(s.member, rem - take);
      }
    }
  }

  const result = new Map<string, ExpenseCoverage>();
  for (const e of sorted) {
    const participants: ParticipantCoverage[] = e.shares.map((s) => ({
      member: s.member,
      share: s.share,
      isPayer: s.member === e.payer,
      outstanding: outstanding.get(`${e.id}|${s.member}`) ?? 0n,
    }));
    const debtors = participants.filter((p) => !p.isPayer && p.share > 0n);
    const totalOut = debtors.reduce((acc, p) => acc + p.outstanding, 0n);
    const totalOwed = debtors.reduce((acc, p) => acc + p.share, 0n);
    let status: ExpenseSettlementStatus;
    if (totalOut === 0n) status = "settled";
    else if (totalOut === totalOwed) status = "open";
    else status = "partial";
    result.set(e.id, { expenseId: e.id, status, participants, outstanding: totalOut });
  }
  return result;
}
