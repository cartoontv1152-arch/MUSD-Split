/**
 * Illustrative example group for the landing hero (clearly labelled as an example in the UI).
 * The tangled and simplified graphs are computed by the real balance engine, not hand-drawn.
 */
import { computeNetBalances, pairwiseDebts, simplifyDebts, splitEqual, UNIT, type LedgerExpense } from "@/lib/engine";

export const EXAMPLE_MEMBERS = ["Ana", "Ben", "Chloé", "Dev", "Eli", "Farah"] as const;
const M = (n: number) => BigInt(n) * UNIT;
const e = (id: string, payer: string, total: number, parts: string[]): LedgerExpense => ({
  id,
  payer,
  total: M(total),
  shares: splitEqual(M(total), parts, { payer }),
  date: "2026-10-01",
  createdAt: 0,
});
const all = [...EXAMPLE_MEMBERS];
const expenses = [
  e("villa", "Ana", 240, all),
  e("dinner", "Ben", 90, ["Ben", "Chloé", "Dev"]),
  e("scooters", "Chloé", 120, ["Ana", "Chloé", "Eli", "Farah"]),
  e("groceries", "Dev", 60, ["Ben", "Dev", "Farah"]),
  e("boat", "Eli", 150, all),
  e("coffee", "Farah", 36, ["Ana", "Ben", "Farah"]),
  e("tickets", "Ben", 48, ["Eli", "Farah", "Ben"]),
];

export const EXAMPLE_PAIRWISE = pairwiseDebts({ expenses, settlements: [] });
export const EXAMPLE_SIMPLIFIED = simplifyDebts(computeNetBalances({ members: all, expenses, settlements: [] }));

export const EXAMPLE_STATS = {
  members: EXAMPLE_MEMBERS.length,
  pairwise: EXAMPLE_PAIRWISE.length,
  simplified: EXAMPLE_SIMPLIFIED.length,
  total: expenses.reduce((a, x) => a + x.total, 0n),
};
