/**
 * Settlement lifecycle and payment policy (pure).
 *
 *   created ──► submitted ──► confirmed
 *      │            │  ▲
 *      │            ▼  │
 *      │         delayed ───► confirmed / failed / rejected
 *      │            │
 *      ├─► cancelled└──► failed (tx reverted) / rejected (tx doesn't match the intent)
 *
 * - created:   intent recorded, waiting for the wallet signature (no money has moved)
 * - submitted: a tx hash was broadcast and recorded; waiting for the receipt
 * - delayed:   verification couldn't complete (RPC error/timeout) — retried automatically
 * - confirmed: receipt verified on-chain (success, right token, from, to, amount) — counts in balances
 * - failed:    the transaction reverted on-chain — no money moved
 * - rejected:  the tx exists but doesn't prove this payment (wrong sender/recipient/amount/token,
 *              already claimed, or older than the intent) — it does not count
 * - cancelled: abandoned before any tx was recorded
 * Only "confirmed" settlements change balances.
 */

import type { SettlementStatus, Transfer } from "./balances";
import { DEFAULT_QUANTUM } from "./money";

export const SETTLEMENT_TRANSITIONS: Record<SettlementStatus, SettlementStatus[]> = {
  created: ["submitted", "cancelled", "confirmed", "failed", "rejected", "delayed"],
  submitted: ["submitted", "delayed", "confirmed", "failed", "rejected"],
  delayed: ["delayed", "submitted", "confirmed", "failed", "rejected"],
  confirmed: [],
  failed: [],
  rejected: [],
  cancelled: [],
};

export function canTransition(from: SettlementStatus, to: SettlementStatus): boolean {
  return SETTLEMENT_TRANSITIONS[from].includes(to);
}

export function isTerminal(s: SettlementStatus): boolean {
  return SETTLEMENT_TRANSITIONS[s].length === 0;
}

/** Statuses that represent money that may be moving right now. */
export function isInFlight(s: SettlementStatus): boolean {
  return s === "submitted" || s === "delayed";
}

export type PolicyResult = { ok: true; max: bigint } | { ok: false; code: string; message: string; max: bigint };

export interface IntentPolicyInput {
  from: string;
  to: string;
  amount: bigint;
  nets: Map<string, bigint>;
  simplified: Transfer[];
  pairwise: Transfer[];
  /** settlements currently submitted/delayed (not yet confirmed) in this group */
  inFlight: Array<{ from: string; to: string; amount: bigint }>;
  activeMembers: Set<string>;
  quantum?: bigint;
}

/**
 * Maximum the payer may settle to a recipient right now: the larger of the simplified and the
 * direct (pairwise) suggestion for that pair, capped by the payer's total debt, minus anything
 * already in flight. Prevents accidental overpayment and duplicate payments.
 */
export function maxSettleable(input: Omit<IntentPolicyInput, "amount">): bigint {
  const { from, to, nets, simplified, pairwise, inFlight } = input;
  const debt = -(nets.get(from) ?? 0n);
  if (debt <= 0n) return 0n;
  const s = simplified.find((t) => t.from === from && t.to === to)?.amount ?? 0n;
  const p = pairwise.find((t) => t.from === from && t.to === to)?.amount ?? 0n;
  const pairCap = s > p ? s : p;
  const flyingPair = inFlight.filter((f) => f.from === from && f.to === to).reduce((a, f) => a + f.amount, 0n);
  const flyingAll = inFlight.filter((f) => f.from === from).reduce((a, f) => a + f.amount, 0n);
  const a = pairCap - flyingPair;
  const b = debt - flyingAll;
  const m = a < b ? a : b;
  return m > 0n ? m : 0n;
}

export function checkSettlementIntent(input: IntentPolicyInput): PolicyResult {
  const quantum = input.quantum ?? DEFAULT_QUANTUM;
  const max = maxSettleable(input);
  if (input.from === input.to) return { ok: false, code: "SELF", message: "You can't pay yourself", max };
  if (!input.activeMembers.has(input.to)) {
    return { ok: false, code: "RECIPIENT_NOT_MEMBER", message: "Recipient is not an active group member", max };
  }
  if (!input.activeMembers.has(input.from)) {
    return { ok: false, code: "PAYER_NOT_MEMBER", message: "You are not an active group member", max };
  }
  if (input.amount <= 0n) return { ok: false, code: "INVALID_AMOUNT", message: "Amount must be positive", max };
  if (input.amount % quantum !== 0n) {
    return { ok: false, code: "NOT_QUANTIZED", message: "Amount must be whole cents", max };
  }
  if (max === 0n) {
    const pending = input.inFlight.some((f) => f.from === input.from);
    return {
      ok: false,
      code: pending ? "PAYMENT_IN_FLIGHT" : "NOTHING_OWED",
      message: pending
        ? "A payment to this member is still being confirmed. Wait for it before paying again."
        : "You don't owe this member anything right now",
      max,
    };
  }
  if (input.amount > max) {
    return { ok: false, code: "EXCEEDS_DEBT", message: "Amount is more than you currently owe this member", max };
  }
  return { ok: true, max };
}
