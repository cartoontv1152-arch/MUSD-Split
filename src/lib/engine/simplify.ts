/**
 * Debt simplification (Feature 9).
 *
 * Input: net balances (must sum to zero). Output: a list of suggested transfers that, if all
 * executed, bring every member to exactly zero — i.e. they preserve the net balances.
 *
 * Algorithm (deterministic greedy min-cash-flow):
 *   1. Exact-match pass: a debtor whose debt equals a creditor's credit settles in one transfer
 *      (largest amounts first, ties by address). This removes the most common redundant chains.
 *   2. Greedy pass: repeatedly match the largest remaining debtor with the largest remaining
 *      creditor, transferring min(debt, credit). Ties are broken by address ascending.
 * The result has at most (non-zero members - 1) transfers, never a transfer between two
 * members who are both debtors or both creditors, and never a zero/negative amount.
 *
 * Suggestions are recommendations only — no funds move without the payer approving each one.
 */

import { LedgerError, compareTransfers, type Transfer } from "./balances";

export function simplifyDebts(nets: Map<string, bigint>): Transfer[] {
  let sum = 0n;
  const debtors: Array<{ member: string; amount: bigint }> = [];
  const creditors: Array<{ member: string; amount: bigint }> = [];
  for (const [member, v] of nets) {
    sum += v;
    if (v < 0n) debtors.push({ member, amount: -v });
    else if (v > 0n) creditors.push({ member, amount: v });
  }
  if (sum !== 0n) {
    throw new LedgerError(`Net balances must sum to zero (got ${sum})`, "UNBALANCED");
  }

  const byAmountThenAddr = (a: { member: string; amount: bigint }, b: { member: string; amount: bigint }) => {
    if (a.amount !== b.amount) return a.amount > b.amount ? -1 : 1;
    return a.member < b.member ? -1 : a.member > b.member ? 1 : 0;
  };
  debtors.sort(byAmountThenAddr);
  creditors.sort(byAmountThenAddr);

  const out: Transfer[] = [];

  // 1. Exact matches
  const usedCreditor = new Set<number>();
  for (const d of debtors) {
    const idx = creditors.findIndex((c, i) => !usedCreditor.has(i) && c.amount === d.amount);
    if (idx >= 0) {
      usedCreditor.add(idx);
      out.push({ from: d.member, to: creditors[idx].member, amount: d.amount });
      d.amount = 0n;
      creditors[idx].amount = 0n;
    }
  }

  // 2. Greedy largest-first
  const D = debtors.filter((d) => d.amount > 0n);
  const C = creditors.filter((c) => c.amount > 0n);
  while (D.length && C.length) {
    D.sort(byAmountThenAddr);
    C.sort(byAmountThenAddr);
    const d = D[0];
    const c = C[0];
    const amt = d.amount < c.amount ? d.amount : c.amount;
    out.push({ from: d.member, to: c.member, amount: amt });
    d.amount -= amt;
    c.amount -= amt;
    if (d.amount === 0n) D.shift();
    if (c.amount === 0n) C.shift();
  }
  return out.sort(compareTransfers);
}

/** Transfers that `member` needs to pay (from simplified suggestions). */
export function transfersFrom(transfers: Transfer[], member: string): Transfer[] {
  return transfers.filter((t) => t.from === member);
}

/** Transfers that `member` should receive. */
export function transfersTo(transfers: Transfer[], member: string): Transfer[] {
  return transfers.filter((t) => t.to === member);
}
