export * from "./money";
export * from "./split";
export * from "./balances";
export * from "./simplify";
export * from "./coverage";
export * from "./adjustments";
export * from "./settlement";

import { computeNetBalances, pairwiseDebts, totalOutstanding, type LedgerExpense, type LedgerSettlement, type Transfer } from "./balances";
import { computeCoverage, type ExpenseCoverage } from "./coverage";
import { simplifyDebts } from "./simplify";

export interface GroupLedger {
  nets: Map<string, bigint>;
  pairwise: Transfer[];
  simplified: Transfer[];
  coverage: Map<string, ExpenseCoverage>;
  totalSpent: bigint;
  totalSettled: bigint;
  outstanding: bigint;
}

/** One-shot computation of everything a group page needs. Deterministic for a given input. */
export function computeGroupLedger(input: {
  members: string[];
  expenses: LedgerExpense[];
  settlements: LedgerSettlement[];
}): GroupLedger {
  const nets = computeNetBalances(input);
  const pairwise = pairwiseDebts(input);
  const simplified = simplifyDebts(nets);
  const coverage = computeCoverage(input.expenses, nets);
  let totalSpent = 0n;
  for (const e of input.expenses) totalSpent += e.total;
  let totalSettled = 0n;
  for (const s of input.settlements) if (s.status === "confirmed") totalSettled += s.amount;
  return { nets, pairwise, simplified, coverage, totalSpent, totalSettled, outstanding: totalOutstanding(nets) };
}
