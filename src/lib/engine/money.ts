/**
 * Money primitives for MUSD (18 decimals).
 *
 * All token amounts are bigint base units ("wei" of MUSD). Decimal strings appear only at the
 * edges (user input, display). No JavaScript floating point is ever used for amounts.
 */

export const MUSD_DECIMALS = 18;
export const UNIT = 10n ** 18n;

/**
 * The ledger quantum: the smallest denomination the app splits to.
 * MUSD is a dollar stablecoin, so expenses are entered and split to the cent (0.01 MUSD).
 * The engine itself is quantum-agnostic (tests also run with quantum = 1 wei).
 */
export const CENT = 10n ** 16n;
export const DEFAULT_QUANTUM = CENT;

/** Maximum fractional digits accepted for user-entered amounts (cent precision). */
export const INPUT_DECIMALS = 2;

/** Upper bound for a single expense/settlement (1 billion MUSD) — guards against fat-finger input. */
export const MAX_AMOUNT = 1_000_000_000n * UNIT;

export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmountError";
  }
}

const AMOUNT_RE = /^(\d{1,12})(?:\.(\d+))?$/;

/**
 * Parse a user-entered decimal string ("12", "12.5", "12.50") into base units.
 * Rejects negatives, exponents, separators, more than `maxDecimals` fraction digits and zero
 * (unless allowZero).
 */
export function parseAmount(
  input: string,
  opts: { maxDecimals?: number; allowZero?: boolean } = {},
): bigint {
  const maxDecimals = opts.maxDecimals ?? INPUT_DECIMALS;
  const s = String(input ?? "").trim();
  const m = AMOUNT_RE.exec(s);
  if (!m) throw new AmountError("Enter an amount like 12.50");
  const whole = m[1];
  const frac = m[2] ?? "";
  if (frac.length > maxDecimals) {
    throw new AmountError(`Use at most ${maxDecimals} decimal places`);
  }
  const value = BigInt(whole) * UNIT + (frac ? BigInt(frac.padEnd(MUSD_DECIMALS, "0")) : 0n);
  if (value === 0n && !opts.allowZero) throw new AmountError("Amount must be greater than zero");
  if (value > MAX_AMOUNT) throw new AmountError("Amount is too large");
  return value;
}

/** Exact decimal representation (no rounding), trailing zeros trimmed, e.g. 30000000000000000000n -> "30". */
export function toDecimalString(value: bigint): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const whole = abs / UNIT;
  const frac = (abs % UNIT).toString().padStart(MUSD_DECIMALS, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toString()}${frac ? "." + frac : ""}`;
}

/**
 * Display formatting with grouping. Rounds half away from zero to `fractionDigits`.
 * Use `exact: true` on confirmation screens where the precise on-chain amount matters.
 */
export function formatAmount(
  value: bigint,
  opts: { fractionDigits?: number; exact?: boolean; signed?: boolean } = {},
): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  let wholePart: bigint;
  let fracStr: string;
  if (opts.exact) {
    wholePart = abs / UNIT;
    const raw = (abs % UNIT).toString().padStart(MUSD_DECIMALS, "0").replace(/0+$/, "");
    fracStr = raw.length < 2 ? raw.padEnd(2, "0") : raw;
  } else {
    const digits = opts.fractionDigits ?? 2;
    const scale = 10n ** BigInt(MUSD_DECIMALS - digits);
    const rounded = (abs + scale / 2n) / scale; // half-up on magnitude
    const factor = 10n ** BigInt(digits);
    wholePart = rounded / factor;
    fracStr = digits > 0 ? (rounded % factor).toString().padStart(digits, "0") : "";
  }
  const grouped = wholePart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = neg && (wholePart !== 0n || /[1-9]/.test(fracStr)) ? "-" : opts.signed && !neg && abs > 0n ? "+" : "";
  return `${sign}${grouped}${fracStr ? "." + fracStr : ""}`;
}

export function isQuantized(value: bigint, quantum: bigint = DEFAULT_QUANTUM): boolean {
  return value % quantum === 0n;
}

export function absBig(v: bigint): bigint {
  return v < 0n ? -v : v;
}

export function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

export function maxBig(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export function sumBig(values: Iterable<bigint>): bigint {
  let s = 0n;
  for (const v of values) s += v;
  return s;
}

/**
 * Parse a percentage string with up to 2 decimals into basis points (1% = 100 bps, 100% = 10000).
 */
export function parsePercentToBps(input: string): number {
  const s = String(input ?? "").trim();
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new AmountError("Enter a percentage like 33.33");
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (bps <= 0 || bps > 10_000) throw new AmountError("Percentage must be between 0.01 and 100");
  return bps;
}

export function formatBps(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const frac = bps % 100;
  return frac === 0 ? `${whole}` : `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}
