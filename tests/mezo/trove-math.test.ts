import { describe, expect, it } from "vitest";
import {
  ONE,
  accruedInterest,
  afterAddCollateral,
  afterBorrow,
  afterRepay,
  collateralRatio,
  healthBand,
  liquidationPrice,
  maxAdditionalBorrow,
  nominalICR,
  openTroveQuote,
  type TroveParams,
  type TroveState,
} from "@/lib/mezo/trove-math";

const U = (n: string) => {
  const [i, f = ""] = n.split(".");
  return BigInt(i) * ONE + BigInt((f + "0".repeat(18)).slice(0, 18));
};

// Live Mezo testnet parameters and the deployer's real trove, read on 2026-11-14.
const P: TroveParams = {
  price: U("67158.89087"),
  mcr: U("1.1"),
  ccr: U("1.5"),
  minNetDebt: U("1800"),
  gasCompensation: U("200"),
  borrowingRate: U("0.001"),
};
const T: TroveState = {
  coll: U("0.04501"),
  principal: U("2297.130712221509859380"),
  interest: U("1.183835396170657256"),
  maxBorrowingCapacity: U("3262.310476772727272727"),
};

describe("trove maths (matches the on-chain values)", () => {
  it("collateral ratio with accrued interest matches TroveManager.getCurrentICR (131.51%)", () => {
    // stored interest only -> slightly optimistic
    const stored = collateralRatio(T.coll, T.principal + T.interest, P.price)!;
    expect(Number(stored) / 1e18).toBeCloseTo(1.31523, 4);
    // on-chain getCurrentICR (1.3150990572996138e18) also counts interest accrued since the last
    // update: 1% APR on the principal for ~3.75 days explains the 0.0103% gap
    const lastUpdate = 1_793_023_055n;
    const now = lastUpdate + 324_000n; // 3.75 days
    const debt = T.principal + T.interest + accruedInterest(T.principal, 100, lastUpdate, now);
    expect(Number(collateralRatio(T.coll, debt, P.price)!) / 1e18).toBeCloseTo(1.3150990572996138, 5);
    expect(accruedInterest(U("1000"), 100, 0n, 365n * 86400n)).toBe(U("10"));
  });
  it("nominal ICR uses principal only, like SortedTroves (1959400906554060)", () => {
    expect(nominalICR(T.coll, T.principal)).toBe(1959400906554060n);
  });
  it("liquidation price is where the ratio hits the MCR", () => {
    const lp = liquidationPrice(T.coll, T.principal + T.interest, P.mcr)!;
    const r = collateralRatio(T.coll, T.principal + T.interest, lp)!;
    expect(r <= P.mcr && P.mcr - r < 10n ** 6n).toBe(true);
    expect(Number(lp) / 1e18).toBeCloseTo(56168.54, 1); // (2297.13 + 1.18) × 1.1 / 0.04501
  });
  it("max extra borrow keeps the target ratio and respects the fee", () => {
    const max = maxAdditionalBorrow(T, P, U("1.2"));
    const after = afterBorrow(T, P, max);
    expect(after.ratio! >= U("1.2")).toBe(true);
    // one more cent would break it
    expect(afterBorrow(T, P, max + U("0.02")).ratio! < U("1.2")).toBe(true);
    expect(max % 10n ** 16n).toBe(0n);
  });
  it("never allows borrowing below the MCR, even if a lower target is asked", () => {
    const max = maxAdditionalBorrow(T, P, U("1.0"));
    expect(afterBorrow(T, P, max).ratio! >= P.mcr).toBe(true);
  });
  it("is capped by the trove's borrowing capacity", () => {
    const rich = { ...T, coll: U("10") };
    const max = maxAdditionalBorrow(rich, P, U("1.5"));
    expect(afterBorrow(rich, P, max).debt <= rich.maxBorrowingCapacity).toBe(true);
  });
  it("borrowing 30 MUSD adds 30.03 of debt (0.1% fee)", () => {
    expect(afterBorrow(T, P, U("30")).principal - T.principal).toBe(U("30.03"));
  });
  it("adding collateral raises the ratio; repaying pays interest first", () => {
    expect(afterAddCollateral(T, P, U("0.01")).ratio! > collateralRatio(T.coll, T.principal + T.interest, P.price)!).toBe(true);
    const r = afterRepay(T, P, U("10"));
    expect(r.principal).toBe(T.principal - (U("10") - T.interest));
  });
  it("open-trove quote: min debt, gas compensation and collateral needed", () => {
    const q = openTroveQuote(U("1800"), P, U("1.5"));
    expect(q.totalDebt).toBe(U("1800") + U("1.8") + U("200"));
    expect(q.meetsMinDebt).toBe(true);
    expect((q.collNeeded * P.price) / q.totalDebt >= U("1.5")).toBe(true);
    expect(openTroveQuote(U("100"), P, U("1.5")).meetsMinDebt).toBe(false);
    const m = q.minAmount;
    expect(m + (m * P.borrowingRate) / ONE >= P.minNetDebt).toBe(true);
  });
  it("health bands read in plain words", () => {
    expect(healthBand(null, P)).toBe("none");
    expect(healthBand(U("2.5"), P)).toBe("healthy");
    expect(healthBand(U("1.6"), P)).toBe("watch");
    expect(healthBand(U("1.3"), P)).toBe("risk");
  });
});
