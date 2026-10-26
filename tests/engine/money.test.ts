import { describe, expect, it } from "vitest";
import {
  AmountError,
  CENT,
  UNIT,
  formatAmount,
  formatBps,
  isQuantized,
  parseAmount,
  parsePercentToBps,
  toDecimalString,
} from "@/lib/engine/money";

describe("parseAmount", () => {
  it("parses whole and fractional amounts into base units", () => {
    expect(parseAmount("30")).toBe(30n * UNIT);
    expect(parseAmount("12.5")).toBe(125n * 10n ** 17n);
    expect(parseAmount("12.50")).toBe(1250n * CENT);
    expect(parseAmount("0.01")).toBe(CENT);
    expect(parseAmount(" 7 ")).toBe(7n * UNIT);
  });
  it("never uses floating point (0.1 + 0.2 style inputs are exact)", () => {
    expect(parseAmount("0.1") + parseAmount("0.2")).toBe(parseAmount("0.3"));
  });
  it("rejects invalid input", () => {
    for (const bad of ["", "-1", "1e3", "1,000", "abc", "1.", ".5", "0x10", "NaN", "Infinity"]) {
      expect(() => parseAmount(bad), bad).toThrow(AmountError);
    }
  });
  it("rejects more than 2 decimals by default and zero", () => {
    expect(() => parseAmount("1.001")).toThrow(/decimal/);
    expect(() => parseAmount("0")).toThrow(/greater than zero/);
    expect(parseAmount("0", { allowZero: true })).toBe(0n);
    expect(parseAmount("1.000000000000000001", { maxDecimals: 18 })).toBe(UNIT + 1n);
  });
  it("rejects absurdly large amounts", () => {
    expect(() => parseAmount("999999999999")).toThrow(/too large/);
  });
});

describe("formatting", () => {
  it("formats with grouping and 2 decimals, rounding half-up", () => {
    expect(formatAmount(1234567n * CENT)).toBe("12,345.67");
    expect(formatAmount(30n * UNIT)).toBe("30.00");
    expect(formatAmount(5n * 10n ** 15n)).toBe("0.01"); // 0.005 rounds up
    expect(formatAmount(4n * 10n ** 15n)).toBe("0.00");
    expect(formatAmount(-30n * UNIT)).toBe("-30.00");
    expect(formatAmount(30n * UNIT, { signed: true })).toBe("+30.00");
    expect(formatAmount(-4n * 10n ** 15n)).toBe("0.00"); // never "-0.00"
  });
  it("formats exact on-chain amounts", () => {
    expect(formatAmount(UNIT + 1n, { exact: true })).toBe("1.000000000000000001");
    expect(formatAmount(30n * UNIT, { exact: true })).toBe("30.00");
    expect(toDecimalString(3n * UNIT + 5n * 10n ** 17n)).toBe("3.5");
    expect(toDecimalString(-CENT)).toBe("-0.01");
  });
  it("quantization", () => {
    expect(isQuantized(30n * UNIT)).toBe(true);
    expect(isQuantized(UNIT + 1n)).toBe(false);
  });
  it("percent <-> bps", () => {
    expect(parsePercentToBps("33.33")).toBe(3333);
    expect(parsePercentToBps("100")).toBe(10000);
    expect(parsePercentToBps("0.5")).toBe(50);
    expect(() => parsePercentToBps("0")).toThrow();
    expect(() => parsePercentToBps("100.01")).toThrow();
    expect(() => parsePercentToBps("12.345")).toThrow();
    expect(formatBps(3333)).toBe("33.33");
    expect(formatBps(5000)).toBe("50");
    expect(formatBps(50)).toBe("0.5");
  });
});
