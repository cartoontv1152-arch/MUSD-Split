/**
 * Property-style tests with a seeded PRNG (reproducible): thousands of random groups with random
 * expenses (all four split methods), random confirmed/unconfirmed settlements, edits and deletes.
 */
import { describe, expect, it } from "vitest";
import {
  CENT,
  computeCoverage,
  computeNetBalances,
  computeSplit,
  diffExpenseEffects,
  netsFromTransfers,
  pairwiseDebts,
  simplifyDebts,
  sumBig,
  type LedgerExpense,
  type LedgerSettlement,
  type SplitInput,
} from "@/lib/engine";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed: number) {
  const r = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = <T,>(xs: T[]) => xs[int(0, xs.length - 1)];
  const subset = <T,>(xs: T[]) => {
    const s = xs.filter(() => r() < 0.6);
    return s.length ? s : [pick(xs)];
  };
  return { r, int, pick, subset };
}

function randomSplitInput(rng: ReturnType<typeof makeRng>, total: bigint, members: string[]): SplitInput {
  const parts = rng.subset(members);
  const kind = rng.int(0, 3);
  if (kind === 0) return { method: "equal", participants: parts };
  if (kind === 1) {
    const weights: Record<string, number> = {};
    for (const p of parts) weights[p] = rng.int(1, 9);
    return { method: "shares", weights };
  }
  if (kind === 2) {
    // random bps summing to 10000
    const bps: Record<string, number> = {};
    let left = 10_000;
    parts.forEach((p, i) => {
      const v = i === parts.length - 1 ? left : rng.int(1, Math.max(1, left - (parts.length - i - 1)));
      bps[p] = v;
      left -= v;
    });
    if (Object.values(bps).some((v) => v <= 0)) return { method: "equal", participants: parts };
    return { method: "percentage", bps };
  }
  // custom: random cents summing to total
  const totalQ = total / CENT;
  if (totalQ < BigInt(parts.length)) return { method: "equal", participants: parts };
  const amounts: Record<string, bigint> = {};
  let left = totalQ;
  parts.forEach((p, i) => {
    const remainingParts = BigInt(parts.length - i - 1);
    const maxHere = left - remainingParts;
    const v = i === parts.length - 1 ? left : 1n + BigInt(Math.floor(rng.r() * Number(maxHere > 1n ? maxHere - 1n : 0n)));
    amounts[p] = v * CENT;
    left -= v;
  });
  return { method: "custom", amounts };
}

function randomGroup(seed: number) {
  const rng = makeRng(seed);
  const n = rng.int(2, 8);
  const members = Array.from({ length: n }, (_, i) => `0x${(i + 1).toString(16).padStart(40, "0")}`);
  const expenses: LedgerExpense[] = [];
  const count = rng.int(1, 25);
  for (let i = 0; i < count; i++) {
    const total = BigInt(rng.int(1, 500_000)) * CENT;
    const payer = rng.pick(members);
    const input = randomSplitInput(rng, total, members);
    expenses.push({
      id: `e${i}`,
      payer,
      total,
      shares: computeSplit(total, input, { payer }),
      date: `2026-${String(rng.int(1, 12)).padStart(2, "0")}-${String(rng.int(1, 28)).padStart(2, "0")}`,
      createdAt: i,
    });
  }
  const settlements: LedgerSettlement[] = [];
  const sc = rng.int(0, 10);
  const statuses: LedgerSettlement["status"][] = ["confirmed", "confirmed", "confirmed", "submitted", "failed", "rejected", "delayed"];
  for (let i = 0; i < sc; i++) {
    const from = rng.pick(members);
    let to = rng.pick(members);
    if (to === from) to = members[(members.indexOf(from) + 1) % members.length];
    settlements.push({ id: `s${i}`, from, to, amount: BigInt(rng.int(1, 100_000)) * CENT, status: rng.pick(statuses) });
  }
  return { rng, members, expenses, settlements };
}

const SEEDS = Array.from({ length: 1500 }, (_, i) => 1000 + i * 7919);

describe("property: random ledgers", () => {
  it("every split sums exactly to its total and is cent-quantized", () => {
    for (const seed of SEEDS) {
      const { expenses } = randomGroup(seed);
      for (const e of expenses) {
        expect(sumBig(e.shares.map((s) => s.share)), `seed ${seed}`).toBe(e.total);
        for (const s of e.shares) expect(s.share % CENT).toBe(0n);
      }
    }
  });

  it("net balances always sum to exactly zero", () => {
    for (const seed of SEEDS) {
      const g = randomGroup(seed);
      const nets = computeNetBalances(g);
      expect(sumBig(nets.values()), `seed ${seed}`).toBe(0n);
    }
  });

  it("simplification preserves every member's net balance with <= n-1 transfers", () => {
    for (const seed of SEEDS) {
      const g = randomGroup(seed);
      const nets = computeNetBalances(g);
      const t = simplifyDebts(nets);
      const nonZero = [...nets.values()].filter((v) => v !== 0n).length;
      expect(t.length, `seed ${seed}`).toBeLessThanOrEqual(Math.max(0, nonZero - 1));
      const implied = netsFromTransfers(t);
      for (const [m, v] of nets) expect(implied.get(m) ?? 0n, `seed ${seed} ${m}`).toBe(v);
      for (const x of t) {
        expect(x.amount > 0n).toBe(true);
        expect(x.from).not.toBe(x.to);
      }
    }
  });

  it("simplified never needs more transfers than the pairwise graph", () => {
    for (const seed of SEEDS) {
      const g = randomGroup(seed);
      const nets = computeNetBalances(g);
      const pw = pairwiseDebts(g);
      expect(simplifyDebts(nets).length, `seed ${seed}`).toBeLessThanOrEqual(Math.max(pw.length, 0) || 0);
      const implied = netsFromTransfers(pw);
      for (const [m, v] of nets) expect(implied.get(m) ?? 0n).toBe(v);
    }
  });

  it("executing the suggested transfers as confirmed settlements zeroes every balance", () => {
    for (const seed of SEEDS.slice(0, 500)) {
      const g = randomGroup(seed);
      const nets = computeNetBalances(g);
      const extra = simplifyDebts(nets).map((t, i) => ({ id: `x${i}`, ...t, status: "confirmed" as const }));
      const after = computeNetBalances({ ...g, settlements: [...g.settlements, ...extra] });
      for (const v of after.values()) expect(v, `seed ${seed}`).toBe(0n);
    }
  });

  it("is deterministic: the same ledger in shuffled order yields identical results", () => {
    for (const seed of SEEDS.slice(0, 300)) {
      const g = randomGroup(seed);
      const shuffled = {
        ...g,
        expenses: [...g.expenses].reverse(),
        settlements: [...g.settlements].reverse(),
        members: [...g.members].reverse(),
      };
      expect(simplifyDebts(computeNetBalances(shuffled))).toEqual(simplifyDebts(computeNetBalances(g)));
      expect(pairwiseDebts(shuffled)).toEqual(pairwiseDebts(g));
    }
  });

  it("edits/deletes: old nets + adjustment delta = new nets", () => {
    for (const seed of SEEDS.slice(0, 500)) {
      const g = randomGroup(seed);
      const idx = g.rng.int(0, g.expenses.length - 1);
      const before = g.expenses[idx];
      const total = BigInt(g.rng.int(1, 300_000)) * CENT;
      const payer = g.rng.pick(g.members);
      const after: LedgerExpense = {
        ...before,
        total,
        payer,
        shares: computeSplit(total, randomSplitInput(g.rng, total, g.members), { payer }),
      };
      const doDelete = g.rng.r() < 0.3;
      const newExpenses = doDelete
        ? g.expenses.filter((_, i) => i !== idx)
        : g.expenses.map((e, i) => (i === idx ? after : e));
      const oldNets = computeNetBalances(g);
      const newNets = computeNetBalances({ ...g, expenses: newExpenses });
      const delta = diffExpenseEffects(before, doDelete ? null : after);
      for (const m of new Set([...oldNets.keys(), ...newNets.keys()])) {
        expect((oldNets.get(m) ?? 0n) + (delta.get(m) ?? 0n), `seed ${seed}`).toBe(newNets.get(m) ?? 0n);
      }
    }
  });

  it("coverage: outstanding per member equals their debt and never exceeds a share", () => {
    for (const seed of SEEDS.slice(0, 500)) {
      const g = randomGroup(seed);
      const nets = computeNetBalances(g);
      const cov = computeCoverage(g.expenses, nets);
      const outstandingBy = new Map<string, bigint>();
      const obligationsBy = new Map<string, bigint>();
      for (const c of cov.values()) {
        for (const p of c.participants) {
          expect(p.outstanding <= p.share).toBe(true);
          expect(p.outstanding >= 0n).toBe(true);
          if (p.isPayer) expect(p.outstanding).toBe(0n);
          else obligationsBy.set(p.member, (obligationsBy.get(p.member) ?? 0n) + p.share);
          outstandingBy.set(p.member, (outstandingBy.get(p.member) ?? 0n) + p.outstanding);
        }
      }
      for (const [m, v] of nets) {
        // a debtor's debt is attributed to their expense shares, up to the total of those shares
        // (debt beyond that can only come from settlements/edits, e.g. an expense reduced after payment)
        const obligations = obligationsBy.get(m) ?? 0n;
        const debt = v < 0n ? -v : 0n;
        expect(outstandingBy.get(m) ?? 0n, `seed ${seed} ${m}`).toBe(debt < obligations ? debt : obligations);
      }
    }
  });
});
