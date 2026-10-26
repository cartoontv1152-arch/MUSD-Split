/**
 * Expense splitting.
 *
 * ROUNDING RULE (deterministic, documented in README):
 *   Every share is a whole multiple of the ledger quantum (0.01 MUSD in the app).
 *   1. Each participant first receives floor(total * weight / totalWeight) quanta.
 *   2. The leftover quanta (always fewer than the number of participants) are handed out one
 *      at a time, to the participants with the largest fractional remainder first.
 *   3. Ties are broken by: the payer first (the person who fronted the money absorbs the
 *      rounding, so debtors never owe more than their exact fair share), then by wallet
 *      address ascending.
 *   Shares therefore always sum to exactly the expense total — nothing is lost or invented.
 *
 * Custom splits must already be quantized and sum exactly to the total.
 */

import { DEFAULT_QUANTUM, sumBig } from "./money";

export type SplitMethod = "equal" | "custom" | "percentage" | "shares";

export type SplitInput =
  | { method: "equal"; participants: string[] }
  | { method: "custom"; amounts: Record<string, bigint> }
  | { method: "percentage"; bps: Record<string, number> }
  | { method: "shares"; weights: Record<string, number> };

export interface Share {
  member: string;
  share: bigint;
}

export class SplitError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "SplitError";
  }
}

export const MAX_PARTICIPANTS = 100;
export const MAX_WEIGHT = 10_000;

function assertUnique(members: string[]) {
  const seen = new Set<string>();
  for (const m of members) {
    if (seen.has(m)) throw new SplitError(`Duplicate participant ${m}`, "DUPLICATE_PARTICIPANT");
    seen.add(m);
  }
}

function assertParticipantCount(n: number) {
  if (n === 0) throw new SplitError("Select at least one participant", "NO_PARTICIPANTS");
  if (n > MAX_PARTICIPANTS) throw new SplitError("Too many participants", "TOO_MANY_PARTICIPANTS");
}

/**
 * Largest-remainder (Hamilton) allocation of `total` across integer weights, in quanta.
 * Returns shares in base units, ordered by member address ascending.
 */
export function allocateByWeights(
  total: bigint,
  weights: Array<{ member: string; weight: bigint }>,
  opts: { payer?: string; quantum?: bigint } = {},
): Share[] {
  const quantum = opts.quantum ?? DEFAULT_QUANTUM;
  if (total <= 0n) throw new SplitError("Total must be greater than zero", "INVALID_TOTAL");
  if (total % quantum !== 0n) {
    throw new SplitError("Total must be a whole number of cents", "TOTAL_NOT_QUANTIZED");
  }
  assertParticipantCount(weights.length);
  assertUnique(weights.map((w) => w.member));
  for (const w of weights) {
    if (w.weight <= 0n) throw new SplitError("Every weight must be positive", "INVALID_WEIGHT");
  }

  const totalQ = total / quantum;
  const W = sumBig(weights.map((w) => w.weight));
  const rows = weights.map((w) => {
    const product = totalQ * w.weight;
    return { member: w.member, base: product / W, rem: product % W };
  });
  let leftover = totalQ - sumBig(rows.map((r) => r.base));

  const order = [...rows].sort((a, b) => {
    if (a.rem !== b.rem) return a.rem > b.rem ? -1 : 1;
    if (opts.payer) {
      if (a.member === opts.payer && b.member !== opts.payer) return -1;
      if (b.member === opts.payer && a.member !== opts.payer) return 1;
    }
    return a.member < b.member ? -1 : a.member > b.member ? 1 : 0;
  });
  const extra = new Map<string, bigint>();
  for (const r of order) {
    if (leftover <= 0n) break;
    extra.set(r.member, 1n);
    leftover -= 1n;
  }

  return rows
    .map((r) => ({ member: r.member, share: (r.base + (extra.get(r.member) ?? 0n)) * quantum }))
    .sort((a, b) => (a.member < b.member ? -1 : a.member > b.member ? 1 : 0));
}

export function splitEqual(
  total: bigint,
  participants: string[],
  opts: { payer?: string; quantum?: bigint } = {},
): Share[] {
  return allocateByWeights(
    total,
    participants.map((member) => ({ member, weight: 1n })),
    opts,
  );
}

export function splitShares(
  total: bigint,
  weights: Record<string, number>,
  opts: { payer?: string; quantum?: bigint } = {},
): Share[] {
  const entries = Object.entries(weights);
  for (const [, w] of entries) {
    if (!Number.isInteger(w) || w <= 0 || w > MAX_WEIGHT) {
      throw new SplitError(`Shares must be whole numbers between 1 and ${MAX_WEIGHT}`, "INVALID_WEIGHT");
    }
  }
  return allocateByWeights(
    total,
    entries.map(([member, w]) => ({ member, weight: BigInt(w) })),
    opts,
  );
}

export function splitPercentage(
  total: bigint,
  bps: Record<string, number>,
  opts: { payer?: string; quantum?: bigint } = {},
): Share[] {
  const entries = Object.entries(bps);
  let sum = 0;
  for (const [, b] of entries) {
    if (!Number.isInteger(b) || b <= 0 || b > 10_000) {
      throw new SplitError("Each percentage must be between 0.01% and 100%", "INVALID_PERCENTAGE");
    }
    sum += b;
  }
  if (sum !== 10_000) {
    throw new SplitError(
      `Percentages must add up to 100% (currently ${(sum / 100).toFixed(2)}%)`,
      "PERCENTAGES_NOT_100",
    );
  }
  return allocateByWeights(
    total,
    entries.map(([member, b]) => ({ member, weight: BigInt(b) })),
    opts,
  );
}

export function splitCustom(
  total: bigint,
  amounts: Record<string, bigint>,
  opts: { quantum?: bigint } = {},
): Share[] {
  const quantum = opts.quantum ?? DEFAULT_QUANTUM;
  if (total <= 0n) throw new SplitError("Total must be greater than zero", "INVALID_TOTAL");
  if (total % quantum !== 0n) {
    throw new SplitError("Total must be a whole number of cents", "TOTAL_NOT_QUANTIZED");
  }
  const entries = Object.entries(amounts);
  assertParticipantCount(entries.length);
  for (const [, a] of entries) {
    if (a <= 0n) throw new SplitError("Every custom share must be greater than zero", "INVALID_SHARE");
    if (a % quantum !== 0n) throw new SplitError("Custom shares must be whole cents", "SHARE_NOT_QUANTIZED");
  }
  const sum = sumBig(entries.map(([, a]) => a));
  if (sum !== total) {
    throw new SplitError("Custom shares must add up to the expense total", "CUSTOM_SUM_MISMATCH");
  }
  return entries
    .map(([member, share]) => ({ member, share }))
    .sort((a, b) => (a.member < b.member ? -1 : a.member > b.member ? 1 : 0));
}

/** Dispatch on split method. */
export function computeSplit(
  total: bigint,
  input: SplitInput,
  opts: { payer?: string; quantum?: bigint } = {},
): Share[] {
  switch (input.method) {
    case "equal":
      return splitEqual(total, input.participants, opts);
    case "custom":
      return splitCustom(total, input.amounts, opts);
    case "percentage":
      return splitPercentage(total, input.bps, opts);
    case "shares":
      return splitShares(total, input.weights, opts);
  }
}

/** Participants of a split input (for validation against group membership). */
export function splitParticipants(input: SplitInput): string[] {
  switch (input.method) {
    case "equal":
      return [...input.participants];
    case "custom":
      return Object.keys(input.amounts);
    case "percentage":
      return Object.keys(input.bps);
    case "shares":
      return Object.keys(input.weights);
  }
}
