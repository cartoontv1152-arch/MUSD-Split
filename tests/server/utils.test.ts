import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";
import { addDays, daysBetween, daysInMonth, dueRuns, nextOccurrence, todayUTC } from "@/lib/recurrence";
import { bodyToEngine, computeSharesFromBody, storedToBody, storedToEngine } from "@/lib/split-input";
import { CENT, UNIT, sumBig } from "@/lib/engine";
import { gasWithFloor } from "@/config/chains";
import { expenseCreateSchema, settlementCreateSchema, txHashSchema } from "@/lib/validation";

const A = "0x242097EC010825a937cE0644c1DeF52bda2FcC5e";
const B = "0x8Cd4e1907EF6eE35E0404c6f3a3753e487F99677";
const C = "0xeC053F89b27517B245fF200332cfFf91e144ACFA";

describe("recurrence", () => {
  it("weekly and multi-week", () => {
    expect(nextOccurrence("2026-10-26", "weekly")).toBe("2026-11-02");
    expect(nextOccurrence("2026-12-28", "weekly", 2)).toBe("2027-01-11");
  });
  it("monthly keeps the anchor day and clamps to month end", () => {
    expect(nextOccurrence("2026-01-31", "monthly", 1, 31)).toBe("2026-02-28");
    expect(nextOccurrence("2026-02-28", "monthly", 1, 31)).toBe("2026-03-31");
    expect(nextOccurrence("2028-01-31", "monthly", 1, 31)).toBe("2028-02-29"); // leap year
    expect(nextOccurrence("2026-11-15", "monthly", 3)).toBe("2027-02-15");
    expect(daysInMonth(2026, 2)).toBe(28);
  });
  it("dueRuns catches up (capped) and respects the end date", () => {
    expect(dueRuns("2026-10-01", "2026-10-20", "weekly")).toEqual({
      runs: ["2026-10-01", "2026-10-08", "2026-10-15"],
      next: "2026-10-22",
      finished: false,
    });
    expect(dueRuns("2026-10-01", "2026-10-20", "weekly", 1, null, "2026-10-09")).toEqual({
      runs: ["2026-10-01", "2026-10-08"],
      next: "2026-10-15",
      finished: true,
    });
    expect(dueRuns("2026-11-01", "2026-10-20", "monthly").runs).toEqual([]);
  });
  it("date helpers", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-10-26", "2026-11-01")).toBe(6);
    expect(todayUTC(new Date("2026-10-26T23:59:00Z"))).toBe("2026-10-26");
  });
});

describe("csv export", () => {
  it("escapes quotes, commas and newlines", () => {
    expect(toCsv([["a,b", 'say "hi"', "line\nbreak"]])).toBe('"a,b","say ""hi""","line\nbreak"\r\n');
  });
  it("neutralises spreadsheet formulas in text cells but not in numeric cells", () => {
    expect(toCsv([["=HYPERLINK(1)", "+1", "@x", { raw: "-30.00" }, 5n]])).toBe("'=HYPERLINK(1),'+1,'@x,-30.00,5\r\n");
  });
});

describe("split form <-> engine", () => {
  it("round-trips every method and lowercases addresses", () => {
    const bodies = [
      { method: "equal" as const, participants: [A, B] },
      { method: "custom" as const, amounts: { [A]: "10.50", [B]: "4.50" } },
      { method: "percentage" as const, percentages: { [A]: "33.33", [B]: "66.67" } },
      { method: "shares" as const, shares: { [A]: 2, [C]: 1 } },
    ];
    for (const b of bodies) {
      const { stored } = bodyToEngine(b);
      const back = storedToBody(stored);
      expect(bodyToEngine(back).stored).toEqual(stored);
      expect(JSON.stringify(stored)).not.toMatch(/[A-F]/);
      expect(storedToEngine(stored)).toEqual(bodyToEngine(b).input);
    }
  });
  it("preview shares equal what the server computes, and sum to the total", () => {
    const shares = computeSharesFromBody("100", { method: "equal", participants: [A, B, C] }, C);
    expect(sumBig(shares.map((s) => s.share))).toBe(100n * UNIT);
    expect(shares.find((s) => s.member === C.toLowerCase())!.share).toBe(3334n * CENT);
  });
});

describe("validation & gas policy", () => {
  it("expense schema rejects floats-as-numbers, bad addresses and >2 decimals", () => {
    const base = {
      title: "Dinner",
      amount: "90",
      payer: A,
      category: "food",
      date: "2026-10-26",
      split: { method: "equal", participants: [A, B, C] },
    };
    expect(expenseCreateSchema.safeParse(base).success).toBe(true);
    expect(expenseCreateSchema.safeParse({ ...base, amount: 90 }).success).toBe(false);
    expect(expenseCreateSchema.safeParse({ ...base, amount: "90.001" }).success).toBe(false);
    expect(expenseCreateSchema.safeParse({ ...base, payer: "0x123" }).success).toBe(false);
    expect(expenseCreateSchema.safeParse({ ...base, category: "crypto" }).success).toBe(false);
  });
  it("settlement and tx hash schemas", () => {
    expect(settlementCreateSchema.parse({ to: A, amount: "30" }).method).toBe("direct");
    expect(txHashSchema.safeParse("0x" + "a".repeat(63)).success).toBe(false);
    expect(txHashSchema.parse("0x" + "A".repeat(64))).toBe("0x" + "a".repeat(64));
  });
  it("explicit gas = max(estimate * 1.3, floor) and ignores bogus estimates", () => {
    expect(gasWithFloor(21_644n, 90_000n)).toBe(90_000n);
    expect(gasWithFloor(100_000n, 90_000n)).toBe(130_000n);
    expect(gasWithFloor(undefined, 250_000n)).toBe(250_000n);
    expect(gasWithFloor(10_000n, 250_000n)).toBe(250_000n);
  });
});
