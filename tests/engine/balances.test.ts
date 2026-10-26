import { describe, expect, it } from "vitest";
import {
  LedgerError,
  computeGroupLedger,
  computeNetBalances,
  expenseEffects,
  memberPosition,
  netsFromTransfers,
  pairwiseDebts,
  splitEqual,
  totalOutstanding,
  UNIT,
  type LedgerExpense,
  type LedgerSettlement,
} from "@/lib/engine";

const M = (n: number) => BigInt(n) * UNIT;
let seq = 0;
function expense(payer: string, total: bigint, participants: string[], date = "2026-10-01"): LedgerExpense {
  seq++;
  return {
    id: `e${seq}`,
    payer,
    total,
    shares: splitEqual(total, participants, { payer }),
    date,
    createdAt: seq,
  };
}
function settlement(from: string, to: string, amount: bigint, status: LedgerSettlement["status"] = "confirmed"): LedgerSettlement {
  seq++;
  return { id: `s${seq}`, from, to, amount, status };
}
const obj = (m: Map<string, bigint>) => Object.fromEntries([...m.entries()].sort());

describe("payer share & expense effects", () => {
  it("spec Feature 6: Alice pays 120 for 4 -> Alice +90, others -30", () => {
    const e = expense("alice", M(120), ["alice", "bob", "charlie", "david"]);
    expect(obj(expenseEffects(e))).toEqual({ alice: M(90), bob: -M(30), charlie: -M(30), david: -M(30) });
  });
  it("payer not participating is owed the full amount", () => {
    const e = expense("alice", M(60), ["bob", "charlie"]);
    expect(obj(expenseEffects(e))).toEqual({ alice: M(60), bob: -M(30), charlie: -M(30) });
  });
  it("rejects inconsistent expenses", () => {
    const e = expense("alice", M(60), ["bob", "charlie"]);
    expect(() => expenseEffects({ ...e, total: M(61) })).toThrow(LedgerError);
    expect(() => expenseEffects({ ...e, shares: [] })).toThrow(/no participants/);
    expect(() => expenseEffects({ ...e, shares: [...e.shares, e.shares[0]] })).toThrow();
  });
});

describe("net balances", () => {
  it("UAT scenario end to end", () => {
    const members = ["alice", "bob", "charlie"];
    const e = expense("alice", M(90), members);
    let nets = computeNetBalances({ members, expenses: [e], settlements: [] });
    expect(obj(nets)).toEqual({ alice: M(60), bob: -M(30), charlie: -M(30) });

    // Bob's settlement is pending -> no effect
    const pending = settlement("bob", "alice", M(30), "submitted");
    nets = computeNetBalances({ members, expenses: [e], settlements: [pending] });
    expect(nets.get("bob")).toBe(-M(30));

    // Confirmed -> Bob cleared, Alice receivable reduced, Charlie unchanged
    const confirmed = { ...pending, status: "confirmed" as const };
    nets = computeNetBalances({ members, expenses: [e], settlements: [confirmed] });
    expect(obj(nets)).toEqual({ alice: M(30), bob: 0n, charlie: -M(30) });
  });

  it("failed / rejected / cancelled / delayed settlements never count", () => {
    const e = expense("alice", M(20), ["alice", "bob"]);
    for (const status of ["created", "submitted", "delayed", "failed", "rejected", "cancelled"] as const) {
      const nets = computeNetBalances({ expenses: [e], settlements: [settlement("bob", "alice", M(10), status)] });
      expect(nets.get("bob"), status).toBe(-M(10));
    }
  });

  it("duplicate settlement prevention: the same settlement can't be counted twice", () => {
    const e = expense("alice", M(20), ["alice", "bob"]);
    const s = settlement("bob", "alice", M(10));
    expect(() => computeNetBalances({ expenses: [e], settlements: [s, s] })).toThrow(/counted twice/);
    expect(() => computeNetBalances({ expenses: [e, e], settlements: [] })).toThrow(/counted twice/);
  });

  it("rejects self or non-positive settlements", () => {
    expect(() => computeNetBalances({ expenses: [], settlements: [settlement("a", "a", M(1))] })).toThrow();
    expect(() => computeNetBalances({ expenses: [], settlements: [settlement("a", "b", 0n)] })).toThrow();
  });

  it("combines multiple expenses without losing history", () => {
    const members = ["alice", "bob", "charlie"];
    const exps = [
      expense("alice", M(90), members),
      expense("bob", M(30), ["alice", "bob", "charlie"]),
      expense("charlie", M(12), ["alice", "charlie"]),
    ];
    const nets = computeNetBalances({ members, expenses: exps, settlements: [] });
    // alice: +90-30 -10 -6 = 44 ; bob: -30 +30 -10 = -10 ; charlie: -30 -10 +12 -6 = -34
    expect(obj(nets)).toEqual({ alice: M(44), bob: -M(10), charlie: -M(34) });
    expect([...nets.values()].reduce((a, b) => a + b, 0n)).toBe(0n);
  });

  it("includes listed members with zero balance", () => {
    const nets = computeNetBalances({ members: ["zoe"], expenses: [], settlements: [] });
    expect(nets.get("zoe")).toBe(0n);
  });

  it("memberPosition & totalOutstanding", () => {
    expect(memberPosition(-M(5))).toEqual({ owes: M(5), owed: 0n });
    expect(memberPosition(M(5))).toEqual({ owes: 0n, owed: M(5) });
    expect(totalOutstanding(new Map([["a", M(5)], ["b", -M(3)], ["c", -M(2)]]))).toBe(M(5));
  });
});

describe("pairwise debts", () => {
  it("nets each pair to a single directed edge", () => {
    const exps = [expense("alice", M(20), ["alice", "bob"]), expense("bob", M(8), ["alice", "bob"])];
    // bob owes alice 10, alice owes bob 4 -> bob owes alice 6
    expect(pairwiseDebts({ expenses: exps, settlements: [] })).toEqual([{ from: "bob", to: "alice", amount: M(6) }]);
  });
  it("settlements pay down pairwise debts and node sums equal net balances", () => {
    const members = ["a", "b", "c", "d"];
    const exps = [expense("a", M(40), members), expense("b", M(20), ["c", "d"]), expense("c", M(9), ["a", "b", "c"])];
    const sets = [settlement("d", "a", M(10)), settlement("c", "b", M(4))];
    const edges = pairwiseDebts({ expenses: exps, settlements: sets });
    const nets = computeNetBalances({ members, expenses: exps, settlements: sets });
    const implied = netsFromTransfers(edges);
    for (const m of members) expect(implied.get(m) ?? 0n, m).toBe(nets.get(m));
    for (const e of edges) expect(e.amount > 0n).toBe(true);
  });
  it("an over-payment flips the pair direction", () => {
    const exps = [expense("alice", M(20), ["alice", "bob"])];
    const edges = pairwiseDebts({ expenses: exps, settlements: [settlement("bob", "alice", M(15))] });
    expect(edges).toEqual([{ from: "alice", to: "bob", amount: M(5) }]);
  });
});

describe("computeGroupLedger", () => {
  it("returns consistent aggregates", () => {
    const members = ["alice", "bob", "charlie"];
    const exps = [expense("alice", M(90), members)];
    const sets = [settlement("bob", "alice", M(30)), settlement("charlie", "alice", M(5), "failed")];
    const l = computeGroupLedger({ members, expenses: exps, settlements: sets });
    expect(l.totalSpent).toBe(M(90));
    expect(l.totalSettled).toBe(M(30));
    expect(l.outstanding).toBe(M(30));
    expect(l.simplified).toEqual([{ from: "charlie", to: "alice", amount: M(30) }]);
    expect(l.coverage.get(exps[0].id)?.status).toBe("partial");
  });
});
