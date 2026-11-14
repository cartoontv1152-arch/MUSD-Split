import { describe, expect, it } from "vitest";
import { isoDate, settlementMethodSchema } from "@/lib/validation";

describe("input validation regressions (audit 2026-11-14)", () => {
  it("rejects impossible calendar dates instead of letting Postgres throw a 500", () => {
    // JS Date.parse rolls these over (Feb 30 -> Mar 2); Postgres ::date rejects them
    for (const bad of ["2025-02-30", "2025-04-31", "2026-13-01", "0000-01-01", "1969-12-31"]) {
      expect(isoDate.safeParse(bad).success, bad).toBe(false);
    }
    for (const ok of ["2024-02-29", "2026-11-14", "1970-01-01"]) {
      expect(isoDate.safeParse(ok).success, ok).toBe(true);
    }
  });
  it("accepts the Mezo trove settlement method", () => {
    expect(settlementMethodSchema.parse("trove")).toBe("trove");
    expect(settlementMethodSchema.safeParse("batch").success).toBe(false);
  });
});
