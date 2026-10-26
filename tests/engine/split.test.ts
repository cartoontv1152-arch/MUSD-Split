import { describe, expect, it } from "vitest";
import { CENT, UNIT, sumBig } from "@/lib/engine/money";
import {
  SplitError,
  allocateByWeights,
  computeSplit,
  splitCustom,
  splitEqual,
  splitParticipants,
  splitPercentage,
  splitShares,
} from "@/lib/engine/split";

const M = (n: number) => BigInt(n) * UNIT;
const toObj = (shares: { member: string; share: bigint }[]) =>
  Object.fromEntries(shares.map((s) => [s.member, s.share]));

describe("equal split", () => {
  it("spec example: 120 MUSD among 4 -> 30 each", () => {
    const s = splitEqual(M(120), ["alice", "bob", "charlie", "david"], { payer: "alice" });
    expect(toObj(s)).toEqual({ alice: M(30), bob: M(30), charlie: M(30), david: M(30) });
  });
  it("UAT: 90 MUSD among 3 -> 30 each", () => {
    expect(toObj(splitEqual(M(90), ["alice", "bob", "charlie"]))).toEqual({
      alice: M(30),
      bob: M(30),
      charlie: M(30),
    });
  });
  it("rounding: 100 among 3 -> payer absorbs the extra cent", () => {
    const s = toObj(splitEqual(M(100), ["alice", "bob", "charlie"], { payer: "charlie" }));
    expect(s.charlie).toBe(3334n * CENT);
    expect(s.alice).toBe(3333n * CENT);
    expect(s.bob).toBe(3333n * CENT);
    expect(sumBig(Object.values(s))).toBe(M(100));
  });
  it("rounding when the payer is excluded: leftover cents go by address order", () => {
    const s = toObj(splitEqual(M(1), ["dave", "carol", "bob"], { payer: "zed" })); // 1.00 / 3
    expect(s.bob).toBe(34n * CENT);
    expect(s.carol).toBe(33n * CENT);
    expect(s.dave).toBe(33n * CENT);
  });
  it("two leftover cents among 3", () => {
    // 0.05 / 3 -> 1 cent each + 2 leftover: payer first, then address order
    const s = toObj(splitEqual(5n * CENT, ["a", "b", "c"], { payer: "c" }));
    expect(s).toEqual({ a: 2n * CENT, b: CENT, c: 2n * CENT });
  });
  it("single participant carries the whole expense", () => {
    expect(toObj(splitEqual(M(9), ["bob"]))).toEqual({ bob: M(9) });
  });
  it("is independent of participant input order", () => {
    const a = splitEqual(M(10), ["c", "a", "b"], { payer: "b" });
    const b = splitEqual(M(10), ["b", "c", "a"], { payer: "b" });
    expect(a).toEqual(b);
  });
  it("works at 1-wei quantum", () => {
    const s = splitEqual(10n, ["a", "b", "c"], { quantum: 1n, payer: "a" });
    expect(toObj(s)).toEqual({ a: 4n, b: 3n, c: 3n });
  });
  it("rejects bad input", () => {
    expect(() => splitEqual(M(10), [])).toThrow(SplitError);
    expect(() => splitEqual(M(10), ["a", "a"])).toThrow(/Duplicate/);
    expect(() => splitEqual(0n, ["a"])).toThrow(/greater than zero/);
    expect(() => splitEqual(UNIT + 1n, ["a"])).toThrow(/cents/);
  });
});

describe("custom split", () => {
  it("accepts exact shares", () => {
    const s = splitCustom(M(100), { alice: M(50), bob: M(30), charlie: M(20) });
    expect(toObj(s)).toEqual({ alice: M(50), bob: M(30), charlie: M(20) });
  });
  it("requires the shares to add up to the total", () => {
    expect(() => splitCustom(M(100), { alice: M(50), bob: M(30) })).toThrow(/add up/);
    expect(() => splitCustom(M(100), { alice: M(80), bob: M(30) })).toThrow(/add up/);
  });
  it("rejects zero, negative and sub-cent shares", () => {
    expect(() => splitCustom(M(10), { a: M(10), b: 0n })).toThrow(/greater than zero/);
    expect(() => splitCustom(M(10), { a: M(11), b: -M(1) })).toThrow();
    expect(() => splitCustom(M(10), { a: M(10) - 1n, b: 1n })).toThrow(/whole cents/);
  });
});

describe("percentage split", () => {
  it("splits by percentage", () => {
    const s = splitPercentage(M(200), { alice: 5000, bob: 2500, charlie: 2500 });
    expect(toObj(s)).toEqual({ alice: M(100), bob: M(50), charlie: M(50) });
  });
  it("validates that percentages total 100%", () => {
    expect(() => splitPercentage(M(10), { a: 5000, b: 4000 })).toThrow(/100%/);
    expect(() => splitPercentage(M(10), { a: 6000, b: 5000 })).toThrow(/100%/);
    expect(() => splitPercentage(M(10), { a: 10000, b: 0 })).toThrow();
  });
  it("33.33/33.33/33.34 of 10.00 sums exactly", () => {
    const s = toObj(splitPercentage(M(10), { a: 3333, b: 3333, c: 3334 }, { payer: "a" }));
    expect(sumBig(Object.values(s))).toBe(M(10));
    expect(s).toEqual({ a: 333n * CENT, b: 333n * CENT, c: 334n * CENT });
  });
  it("largest remainder wins the leftover cent", () => {
    const s = toObj(splitPercentage(M(1), { a: 6667, b: 3333 }));
    expect(s).toEqual({ a: 67n * CENT, b: 33n * CENT });
    // 0.10 * 50.5% = 5.05 cents (rem .05) ; 0.10 * 49.5% = 4.95 cents (rem .95) -> b gets the leftover
    const t = toObj(splitPercentage(10n * CENT, { a: 5050, b: 4950 }));
    expect(t).toEqual({ a: 5n * CENT, b: 5n * CENT });
  });
});

describe("share-based split", () => {
  it("one person with two shares, another with one", () => {
    const s = toObj(splitShares(M(90), { alice: 2, bob: 1 }));
    expect(s).toEqual({ alice: M(60), bob: M(30) });
  });
  it("rounds deterministically", () => {
    const s = toObj(splitShares(M(10), { a: 1, b: 1, c: 1 }, { payer: "b" }));
    expect(s).toEqual({ a: 333n * CENT, b: 334n * CENT, c: 333n * CENT });
  });
  it("rejects non-integer, zero or huge weights", () => {
    expect(() => splitShares(M(10), { a: 1.5 })).toThrow(/whole numbers/);
    expect(() => splitShares(M(10), { a: 0 })).toThrow();
    expect(() => splitShares(M(10), { a: 10001 })).toThrow();
  });
});

describe("excluded members", () => {
  it("members not selected are never charged", () => {
    const s = computeSplit(M(60), { method: "equal", participants: ["alice", "charlie"] }, { payer: "bob" });
    expect(s.map((x) => x.member)).toEqual(["alice", "charlie"]);
    expect(toObj(s)).toEqual({ alice: M(30), charlie: M(30) });
  });
});

describe("dispatch & helpers", () => {
  it("computeSplit dispatches each method and always sums to the total", () => {
    const total = M(77) + 77n * CENT;
    for (const input of [
      { method: "equal" as const, participants: ["a", "b", "c"] },
      { method: "custom" as const, amounts: { a: M(70), b: 7n * UNIT + 77n * CENT } },
      { method: "percentage" as const, bps: { a: 1, b: 9999 } },
      { method: "shares" as const, weights: { a: 3, b: 7, c: 11 } },
    ]) {
      expect(sumBig(computeSplit(total, input, { payer: "a" }).map((s) => s.share))).toBe(total);
    }
  });
  it("splitParticipants lists participants", () => {
    expect(splitParticipants({ method: "shares", weights: { a: 1, b: 2 } })).toEqual(["a", "b"]);
    expect(splitParticipants({ method: "equal", participants: ["x"] })).toEqual(["x"]);
  });
  it("allocateByWeights rejects non-positive weights", () => {
    expect(() => allocateByWeights(M(1), [{ member: "a", weight: 0n }])).toThrow();
  });
});
