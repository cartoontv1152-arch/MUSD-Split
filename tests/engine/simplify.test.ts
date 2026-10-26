import { describe, expect, it } from "vitest";
import { LedgerError, UNIT, netsFromTransfers, simplifyDebts, transfersFrom, transfersTo } from "@/lib/engine";

const M = (n: number) => BigInt(n) * UNIT;
const nets = (o: Record<string, number>) => new Map(Object.entries(o).map(([k, v]) => [k, M(v)]));

describe("simplifyDebts", () => {
  it("spec Feature 9: Alice owes Bob 20, Bob owes Charlie 20 -> Alice pays Charlie 20", () => {
    // nets: alice -20, bob 0, charlie +20
    expect(simplifyDebts(nets({ alice: -20, bob: 0, charlie: 20 }))).toEqual([
      { from: "alice", to: "charlie", amount: M(20) },
    ]);
  });

  it("UAT: Bob and Charlie each pay Alice 30", () => {
    expect(simplifyDebts(nets({ alice: 60, bob: -30, charlie: -30 }))).toEqual([
      { from: "bob", to: "alice", amount: M(30) },
      { from: "charlie", to: "alice", amount: M(30) },
    ]);
  });

  it("prefers exact matches", () => {
    // equal debts/credits are paired directly: a(-50) with d(+50), b(-30) with c(+30)
    const t = simplifyDebts(nets({ a: -50, b: -30, c: 30, d: 50 }));
    expect(t).toEqual([
      { from: "a", to: "d", amount: M(50) },
      { from: "b", to: "c", amount: M(30) },
    ]);
  });

  it("uses at most n-1 transfers and never transfers between two debtors or two creditors", () => {
    const n = nets({ a: -10, b: -25, c: -5, d: 7, e: 13, f: 20 });
    const t = simplifyDebts(n);
    expect(t.length).toBeLessThanOrEqual(5);
    for (const x of t) {
      expect((n.get(x.from) ?? 0n) < 0n).toBe(true);
      expect((n.get(x.to) ?? 0n) > 0n).toBe(true);
      expect(x.amount > 0n).toBe(true);
    }
    const implied = netsFromTransfers(t);
    for (const [k, v] of n) expect(implied.get(k) ?? 0n).toBe(v);
  });

  it("returns nothing when everyone is settled", () => {
    expect(simplifyDebts(nets({ a: 0, b: 0 }))).toEqual([]);
    expect(simplifyDebts(new Map())).toEqual([]);
  });

  it("rejects unbalanced input", () => {
    expect(() => simplifyDebts(nets({ a: -10, b: 5 }))).toThrow(LedgerError);
  });

  it("is deterministic regardless of map insertion order", () => {
    const a = simplifyDebts(new Map([["x", -M(5)], ["y", -M(5)], ["z", M(10)]]));
    const b = simplifyDebts(new Map([["z", M(10)], ["y", -M(5)], ["x", -M(5)]]));
    expect(a).toEqual(b);
  });

  it("works with wei-level dust", () => {
    const t = simplifyDebts(new Map([["a", -1n], ["b", -2n], ["c", 3n]]));
    expect(t).toEqual([
      { from: "b", to: "c", amount: 2n },
      { from: "a", to: "c", amount: 1n },
    ]);
  });

  it("transfer helpers", () => {
    const t = simplifyDebts(nets({ a: -10, b: -10, c: 20 }));
    expect(transfersFrom(t, "a")).toEqual([{ from: "a", to: "c", amount: M(10) }]);
    expect(transfersTo(t, "c").length).toBe(2);
  });
});
