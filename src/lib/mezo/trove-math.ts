/**
 * Pure maths for Mezo MUSD troves (Liquity-style CDP). All values are 18-decimal bigints:
 * collateral in BTC wei, debt in MUSD base units, price in USD per BTC × 1e18, ratios × 1e18
 * (1.1e18 = 110%). Mirrors the protocol's own formulas so the UI can show the exact outcome
 * before the user signs anything.
 */

export const ONE = 10n ** 18n;
/** SortedTroves orders by nominal ICR = coll × 1e20 / principal */
const NICR_PRECISION = 10n ** 20n;

export interface TroveParams {
  price: bigint; // USD per BTC × 1e18 (PriceFeed.fetchPrice)
  mcr: bigint; // minimum collateral ratio (110%)
  ccr: bigint; // system critical ratio (150%) — recovery mode threshold
  minNetDebt: bigint; // smallest trove (amount borrowed + fee)
  gasCompensation: bigint; // MUSD reserved per trove for liquidators
  borrowingRate: bigint; // fee on new debt × 1e18 (0.001e18 = 0.1%)
}

export interface TroveState {
  coll: bigint;
  principal: bigint;
  interest: bigint;
  maxBorrowingCapacity: bigint;
}

const YEAR = 365n * 24n * 60n * 60n;

/**
 * Simple interest accrued since the trove's last update (rate in basis points, APR) — what
 * TroveManager adds on the fly in getCurrentICR, but getEntireDebtAndColl doesn't report yet.
 */
export function accruedInterest(principal: bigint, rateBps: number, lastUpdate: bigint, now: bigint): bigint {
  if (now <= lastUpdate || rateBps <= 0) return 0n;
  return (principal * BigInt(rateBps) * (now - lastUpdate)) / (10_000n * YEAR);
}

export const troveDebt = (t: Pick<TroveState, "principal" | "interest">) => t.principal + t.interest;

/** collateral ratio: coll × price / debt (∞ when there's no debt) */
export function collateralRatio(coll: bigint, debt: bigint, price: bigint): bigint | null {
  if (debt <= 0n) return null;
  return (coll * price) / debt;
}

/** BTC price at which this trove hits the minimum collateral ratio and can be liquidated */
export function liquidationPrice(coll: bigint, debt: bigint, mcr: bigint): bigint | null {
  if (coll <= 0n || debt <= 0n) return null;
  return (debt * mcr) / coll;
}

export const nominalICR = (coll: bigint, principal: bigint) => (principal > 0n ? (coll * NICR_PRECISION) / principal : 2n ** 256n - 1n);

export const borrowingFee = (amount: bigint, rate: bigint) => (amount * rate) / ONE;

/**
 * Most MUSD that can be borrowed from an existing trove while keeping the collateral ratio at or
 * above `targetRatio` (never below the protocol MCR) and within the trove's borrowing capacity.
 * Borrowing `x` adds `x + fee(x)` of debt.
 */
export function maxAdditionalBorrow(t: TroveState, p: TroveParams, targetRatio: bigint): bigint {
  const ratio = targetRatio > p.mcr ? targetRatio : p.mcr;
  const debt = troveDebt(t);
  const debtCeiling = (t.coll * p.price) / ratio;
  const caps = [debtCeiling];
  if (t.maxBorrowingCapacity > 0n) caps.push(t.maxBorrowingCapacity);
  const ceiling = caps.reduce((a, b) => (a < b ? a : b));
  if (ceiling <= debt) return 0n;
  // x × (1 + rate) <= ceiling - debt
  const room = ((ceiling - debt) * ONE) / (ONE + p.borrowingRate);
  // keep whole cents, round down
  const cent = 10n ** 16n;
  return (room / cent) * cent;
}

/** The trove after borrowing `amount` more (fee added to principal). */
export function afterBorrow(t: TroveState, p: TroveParams, amount: bigint) {
  const principal = t.principal + amount + borrowingFee(amount, p.borrowingRate);
  const debt = principal + t.interest;
  return {
    principal,
    debt,
    ratio: collateralRatio(t.coll, debt, p.price),
    liquidationPrice: liquidationPrice(t.coll, debt, p.mcr),
    nicr: nominalICR(t.coll, principal),
  };
}

/** The trove after adding `collAdded` BTC. */
export function afterAddCollateral(t: TroveState, p: TroveParams, collAdded: bigint) {
  const coll = t.coll + collAdded;
  const debt = troveDebt(t);
  return { coll, ratio: collateralRatio(coll, debt, p.price), liquidationPrice: liquidationPrice(coll, debt, p.mcr), nicr: nominalICR(coll, t.principal) };
}

/** The trove after repaying `amount` (interest is paid first, then principal). */
export function afterRepay(t: TroveState, p: TroveParams, amount: bigint) {
  const toInterest = amount < t.interest ? amount : t.interest;
  const principal = t.principal - (amount - toInterest);
  const debt = principal + (t.interest - toInterest);
  return { principal, debt, ratio: collateralRatio(t.coll, debt, p.price), liquidationPrice: liquidationPrice(t.coll, debt, p.mcr), nicr: nominalICR(t.coll, principal) };
}

/**
 * Opening a trove: the borrower receives `amount`; the trove's debt is amount + fee + gas
 * compensation. Returns the BTC needed for `targetRatio` and whether the size is allowed.
 */
export function openTroveQuote(amount: bigint, p: TroveParams, targetRatio: bigint) {
  const ratio = targetRatio > p.mcr ? targetRatio : p.mcr;
  const fee = borrowingFee(amount, p.borrowingRate);
  const netDebt = amount + fee;
  const totalDebt = netDebt + p.gasCompensation;
  // ceil so the ratio is met after integer division on-chain
  const collNeeded = p.price > 0n ? (totalDebt * ratio + p.price - 1n) / p.price : 0n;
  return {
    fee,
    netDebt,
    totalDebt,
    collNeeded,
    meetsMinDebt: netDebt >= p.minNetDebt,
    /** smallest `amount` that satisfies min net debt */
    minAmount: ((p.minNetDebt * ONE + (ONE + p.borrowingRate) - 1n) / (ONE + p.borrowingRate)),
    nicr: nominalICR(collNeeded, totalDebt),
  };
}

/** "Healthy" / "Watch" / "At risk" — plain words for the UI, by distance from the MCR. */
export function healthBand(ratio: bigint | null, p: Pick<TroveParams, "mcr" | "ccr">): "none" | "healthy" | "watch" | "risk" {
  if (ratio === null) return "none";
  if (ratio >= p.ccr + ONE / 2n) return "healthy"; // ≥ 200% with a 150% CCR
  if (ratio >= p.ccr) return "watch";
  return "risk";
}
