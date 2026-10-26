/**
 * Auditable expense adjustments.
 *
 * Settlement records are immutable. When an expense is edited or deleted, balances are
 * recalculated from the current expense set, and the change is recorded as an adjustment:
 * the exact per-member balance delta (after effects − before effects). The deltas of every
 * revision of an expense always add up to that expense's current effect, so the audit trail
 * fully explains the current balances.
 */

import { expenseEffects, type LedgerExpense } from "./balances";

export function diffExpenseEffects(
  before: LedgerExpense | null,
  after: LedgerExpense | null,
): Map<string, bigint> {
  const out = new Map<string, bigint>();
  if (before) for (const [k, v] of expenseEffects(before)) out.set(k, (out.get(k) ?? 0n) - v);
  if (after) for (const [k, v] of expenseEffects(after)) out.set(k, (out.get(k) ?? 0n) + v);
  for (const [k, v] of [...out]) if (v === 0n) out.delete(k);
  return out;
}

/** Serialize a delta map for storage (decimal strings, sorted by member). */
export function serializeDeltas(d: Map<string, bigint>): Record<string, string> {
  return Object.fromEntries([...d.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, v.toString()]));
}

export function deserializeDeltas(d: Record<string, string>): Map<string, bigint> {
  return new Map(Object.entries(d).map(([k, v]) => [k, BigInt(v)]));
}
