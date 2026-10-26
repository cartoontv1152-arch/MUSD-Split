import { describe, expect, it } from "vitest";
import {
  CENT,
  UNIT,
  computeCoverage,
  computeNetBalances,
  deserializeDeltas,
  diffExpenseEffects,
  serializeDeltas,
  splitEqual,
  type LedgerExpense,
  type LedgerSettlement,
} from "@/lib/engine";

const M = (n: number) => BigInt(n) * UNIT;
function exp(id: string, payer: string, total: bigint, participants: string[], date: string, createdAt = 0): LedgerExpense {
  return { id, payer, total, shares: splitEqual(total, participants, { payer }), date, createdAt };
}
const conf = (id: string, from: string, to: string, amount: bigint): LedgerSettlement => ({
  id,
  from,
  to,
  amount,
  status: "confirmed",
});

describe("expense settlement status (FIFO coverage)", () => {
  const members = ["alice", "bob", "charlie"];
  const dinner = exp("dinner", "alice", M(90), members, "2026-10-01");

  it("open before any payment, partial after Bob pays, settled after both pay", () => {
    let nets = computeNetBalances({ members, expenses: [dinner], settlements: [] });
    let cov = computeCoverage([dinner], nets).get("dinner")!;
    expect(cov.status).toBe("open");
    expect(cov.outstanding).toBe(M(60));

    nets = computeNetBalances({ members, expenses: [dinner], settlements: [conf("s1", "bob", "alice", M(30))] });
    cov = computeCoverage([dinner], nets).get("dinner")!;
    expect(cov.status).toBe("partial");
    expect(cov.participants.find((p) => p.member === "bob")!.outstanding).toBe(0n);
    expect(cov.participants.find((p) => p.member === "charlie")!.outstanding).toBe(M(30));
    expect(cov.participants.find((p) => p.member === "alice")!.isPayer).toBe(true);

    nets = computeNetBalances({
      members,
      expenses: [dinner],
      settlements: [conf("s1", "bob", "alice", M(30)), conf("s2", "charlie", "alice", M(30))],
    });
    expect(computeCoverage([dinner], nets).get("dinner")!.status).toBe("settled");
  });

  it("older expenses are covered first", () => {
    const e1 = exp("e1", "alice", M(20), ["alice", "bob"], "2026-10-01"); // bob owes 10
    const e2 = exp("e2", "alice", M(40), ["alice", "bob"], "2026-10-05"); // bob owes 20
    const nets = computeNetBalances({ expenses: [e1, e2], settlements: [conf("s", "bob", "alice", M(15))] });
    const cov = computeCoverage([e2, e1], nets);
    expect(cov.get("e1")!.status).toBe("settled");
    expect(cov.get("e2")!.status).toBe("partial");
    expect(cov.get("e2")!.outstanding).toBe(M(15));
  });

  it("offsetting expenses count as settled", () => {
    const e1 = exp("e1", "alice", M(20), ["alice", "bob"], "2026-10-01");
    const e2 = exp("e2", "bob", M(20), ["alice", "bob"], "2026-10-02");
    const nets = computeNetBalances({ expenses: [e1, e2], settlements: [] });
    const cov = computeCoverage([e1, e2], nets);
    expect(cov.get("e1")!.status).toBe("settled");
    expect(cov.get("e2")!.status).toBe("settled");
  });

  it("an expense the payer only paid for themselves is settled", () => {
    const solo = exp("solo", "alice", M(5), ["alice"], "2026-10-01");
    const nets = computeNetBalances({ expenses: [solo], settlements: [] });
    expect(computeCoverage([solo], nets).get("solo")!.status).toBe("settled");
  });
});

describe("expense adjustments (edit/delete after settlement)", () => {
  const members = ["alice", "bob", "charlie"];
  const before = exp("dinner", "alice", M(90), members, "2026-10-01");
  const after = exp("dinner", "alice", M(60), members, "2026-10-01");

  it("delta of an edit equals new effects minus old effects and sums to zero", () => {
    const d = diffExpenseEffects(before, after);
    expect(Object.fromEntries(d)).toEqual({ alice: -M(20), bob: M(10), charlie: M(10) });
    expect([...d.values()].reduce((a, b) => a + b, 0n)).toBe(0n);
  });

  it("editing after a confirmed settlement never rewrites the settlement — it creates a credit", () => {
    const s = [conf("s1", "bob", "alice", M(30))];
    const netsBefore = computeNetBalances({ members, expenses: [before], settlements: s });
    expect(netsBefore.get("bob")).toBe(0n);
    const netsAfter = computeNetBalances({ members, expenses: [after], settlements: s });
    // Bob paid 30 but now only owed 20 -> Alice owes Bob 10
    expect(netsAfter.get("bob")).toBe(M(10));
    expect(netsAfter.get("alice")).toBe(M(10));
    expect(netsAfter.get("charlie")).toBe(-M(20));
    // the adjustment explains the change exactly
    const d = diffExpenseEffects(before, after);
    for (const m of members) expect((netsBefore.get(m) ?? 0n) + (d.get(m) ?? 0n)).toBe(netsAfter.get(m));
  });

  it("create and delete deltas", () => {
    expect(Object.fromEntries(diffExpenseEffects(null, before))).toEqual({ alice: M(60), bob: -M(30), charlie: -M(30) });
    expect(Object.fromEntries(diffExpenseEffects(before, null))).toEqual({ alice: -M(60), bob: M(30), charlie: M(30) });
    expect(diffExpenseEffects(before, before).size).toBe(0);
  });

  it("changing the payer moves the receivable", () => {
    const changed = { ...before, payer: "bob", shares: splitEqual(M(90), members, { payer: "bob" }) };
    const d = diffExpenseEffects(before, changed);
    expect(Object.fromEntries(d)).toEqual({ alice: -M(90), bob: M(90) });
  });

  it("revision chain: sum of all deltas = current effect", () => {
    const v2 = exp("dinner", "alice", M(75) + 50n * CENT, ["alice", "bob"], "2026-10-01");
    const deltas = [diffExpenseEffects(null, before), diffExpenseEffects(before, after), diffExpenseEffects(after, v2)];
    const total = new Map<string, bigint>();
    for (const d of deltas) for (const [k, v] of d) total.set(k, (total.get(k) ?? 0n) + v);
    const direct = diffExpenseEffects(null, v2);
    for (const k of new Set([...total.keys(), ...direct.keys()])) expect(total.get(k) ?? 0n).toBe(direct.get(k) ?? 0n);
  });

  it("serializes deltas losslessly", () => {
    const d = diffExpenseEffects(before, after);
    expect(deserializeDeltas(serializeDeltas(d))).toEqual(d);
  });
});
