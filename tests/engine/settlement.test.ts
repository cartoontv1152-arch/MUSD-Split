import { describe, expect, it } from "vitest";
import {
  CENT,
  SETTLEMENT_TRANSITIONS,
  UNIT,
  canTransition,
  checkSettlementIntent,
  computeNetBalances,
  isInFlight,
  isTerminal,
  maxSettleable,
  pairwiseDebts,
  simplifyDebts,
  splitEqual,
  type LedgerExpense,
  type LedgerSettlement,
  type SettlementStatus,
} from "@/lib/engine";

const M = (n: number) => BigInt(n) * UNIT;
const members = ["alice", "bob", "charlie"];
const dinner: LedgerExpense = {
  id: "dinner",
  payer: "alice",
  total: M(90),
  shares: splitEqual(M(90), members, { payer: "alice" }),
  date: "2026-10-01",
  createdAt: 1,
};

function ctx(settlements: LedgerSettlement[] = [], inFlight: { from: string; to: string; amount: bigint }[] = []) {
  const nets = computeNetBalances({ members, expenses: [dinner], settlements });
  return {
    nets,
    simplified: simplifyDebts(nets),
    pairwise: pairwiseDebts({ expenses: [dinner], settlements }),
    inFlight,
    activeMembers: new Set(members),
  };
}

describe("settlement state machine", () => {
  it("only allows documented transitions", () => {
    expect(canTransition("created", "submitted")).toBe(true);
    expect(canTransition("submitted", "confirmed")).toBe(true);
    expect(canTransition("submitted", "delayed")).toBe(true);
    expect(canTransition("delayed", "confirmed")).toBe(true);
    expect(canTransition("submitted", "cancelled")).toBe(false); // can't cancel once money may be moving
    expect(canTransition("confirmed", "failed")).toBe(false);
    expect(canTransition("failed", "confirmed")).toBe(false);
    expect(canTransition("rejected", "confirmed")).toBe(false);
  });
  it("terminal & in-flight classification", () => {
    const all = Object.keys(SETTLEMENT_TRANSITIONS) as SettlementStatus[];
    expect(all.filter(isTerminal).sort()).toEqual(["cancelled", "confirmed", "failed", "rejected"]);
    expect(all.filter(isInFlight).sort()).toEqual(["delayed", "submitted"]);
  });
});

describe("settlement intent policy", () => {
  it("Bob can pay Alice up to 30", () => {
    const r = checkSettlementIntent({ ...ctx(), from: "bob", to: "alice", amount: M(30) });
    expect(r).toEqual({ ok: true, max: M(30) });
    expect(checkSettlementIntent({ ...ctx(), from: "bob", to: "alice", amount: M(12) }).ok).toBe(true);
  });
  it("rejects over-payment, self-payment, paying a non-creditor, non-members and sub-cent amounts", () => {
    const c = ctx();
    expect(checkSettlementIntent({ ...c, from: "bob", to: "alice", amount: M(31) })).toMatchObject({ ok: false, code: "EXCEEDS_DEBT" });
    expect(checkSettlementIntent({ ...c, from: "bob", to: "bob", amount: M(1) })).toMatchObject({ ok: false, code: "SELF" });
    expect(checkSettlementIntent({ ...c, from: "bob", to: "charlie", amount: M(1) })).toMatchObject({ ok: false, code: "NOTHING_OWED" });
    expect(checkSettlementIntent({ ...c, from: "alice", to: "bob", amount: M(1) })).toMatchObject({ ok: false, code: "NOTHING_OWED" });
    expect(checkSettlementIntent({ ...c, from: "bob", to: "mallory", amount: M(1) })).toMatchObject({
      ok: false,
      code: "RECIPIENT_NOT_MEMBER",
    });
    expect(checkSettlementIntent({ ...c, from: "bob", to: "alice", amount: CENT + 1n })).toMatchObject({
      ok: false,
      code: "NOT_QUANTIZED",
    });
    expect(checkSettlementIntent({ ...c, from: "bob", to: "alice", amount: 0n })).toMatchObject({ ok: false, code: "INVALID_AMOUNT" });
  });
  it("duplicate payment prevention: an in-flight payment blocks paying the same debt again", () => {
    const c = ctx([], [{ from: "bob", to: "alice", amount: M(30) }]);
    expect(maxSettleable({ ...c, from: "bob", to: "alice" })).toBe(0n);
    expect(checkSettlementIntent({ ...c, from: "bob", to: "alice", amount: M(30) })).toMatchObject({
      ok: false,
      code: "PAYMENT_IN_FLIGHT",
    });
    // partial in flight leaves the remainder payable
    const p = ctx([], [{ from: "bob", to: "alice", amount: M(10) }]);
    expect(maxSettleable({ ...p, from: "bob", to: "alice" })).toBe(M(20));
  });
  it("after a confirmed settlement, nothing more is owed", () => {
    const c = ctx([{ id: "s1", from: "bob", to: "alice", amount: M(30), status: "confirmed" }]);
    expect(checkSettlementIntent({ ...c, from: "bob", to: "alice", amount: M(1) })).toMatchObject({ ok: false, code: "NOTHING_OWED" });
    expect(checkSettlementIntent({ ...c, from: "charlie", to: "alice", amount: M(30) }).ok).toBe(true);
  });
  it("allows paying along a simplified route even if the pair has no direct debt", () => {
    // alice owes bob 20 (bob paid), bob owes charlie 20 (charlie paid)
    const e1: LedgerExpense = { id: "e1", payer: "bob", total: M(20), shares: [{ member: "alice", share: M(20) }], date: "2026-10-01", createdAt: 1 };
    const e2: LedgerExpense = { id: "e2", payer: "charlie", total: M(20), shares: [{ member: "bob", share: M(20) }], date: "2026-10-01", createdAt: 2 };
    const nets = computeNetBalances({ members, expenses: [e1, e2], settlements: [] });
    const c = {
      nets,
      simplified: simplifyDebts(nets),
      pairwise: pairwiseDebts({ expenses: [e1, e2], settlements: [] }),
      inFlight: [],
      activeMembers: new Set(members),
    };
    expect(checkSettlementIntent({ ...c, from: "alice", to: "charlie", amount: M(20) }).ok).toBe(true);
    expect(checkSettlementIntent({ ...c, from: "alice", to: "bob", amount: M(20) }).ok).toBe(true);
    // bob's net is 0 -> he owes nothing overall
    expect(checkSettlementIntent({ ...c, from: "bob", to: "charlie", amount: M(20) }).ok).toBe(false);
  });
});
