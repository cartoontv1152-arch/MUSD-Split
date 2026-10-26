/**
 * Converts the user-facing split form (decimal strings / percentages / share counts) into the
 * engine's SplitInput (bigint base units, basis points, integer weights) and back.
 * Used by both the Add-Expense preview (client) and the API (server), so the breakdown the user
 * sees before saving is computed by exactly the same code that the server persists.
 */
import {
  computeSplit,
  formatBps,
  parseAmount,
  parsePercentToBps,
  toDecimalString,
  type Share,
  type SplitInput,
} from "@/lib/engine";
import type { SplitBody } from "@/lib/validation";

export interface StoredSplit {
  method: SplitInput["method"];
  participants?: string[];
  amounts?: Record<string, string>; // base units
  bps?: Record<string, number>;
  weights?: Record<string, number>;
}

const lower = <T,>(rec: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(rec).map(([k, v]) => [k.toLowerCase(), v]));

export function bodyToEngine(body: SplitBody): { input: SplitInput; stored: StoredSplit; labels: Record<string, string> } {
  switch (body.method) {
    case "equal": {
      const participants = body.participants.map((p) => p.toLowerCase());
      return {
        input: { method: "equal", participants },
        stored: { method: "equal", participants },
        labels: Object.fromEntries(participants.map((p) => [p, "equal"])),
      };
    }
    case "custom": {
      const amounts: Record<string, bigint> = {};
      for (const [k, v] of Object.entries(lower(body.amounts))) amounts[k] = parseAmount(v);
      return {
        input: { method: "custom", amounts },
        stored: { method: "custom", amounts: Object.fromEntries(Object.entries(amounts).map(([k, v]) => [k, v.toString()])) },
        labels: Object.fromEntries(Object.entries(amounts).map(([k, v]) => [k, toDecimalString(v)])),
      };
    }
    case "percentage": {
      const bps: Record<string, number> = {};
      for (const [k, v] of Object.entries(lower(body.percentages))) bps[k] = parsePercentToBps(v);
      return {
        input: { method: "percentage", bps },
        stored: { method: "percentage", bps },
        labels: Object.fromEntries(Object.entries(bps).map(([k, v]) => [k, `${formatBps(v)}%`])),
      };
    }
    case "shares": {
      const weights = lower(body.shares);
      return {
        input: { method: "shares", weights },
        stored: { method: "shares", weights },
        labels: Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, `${v} share${v === 1 ? "" : "s"}`])),
      };
    }
  }
}

export function storedToEngine(s: StoredSplit): SplitInput {
  switch (s.method) {
    case "equal":
      return { method: "equal", participants: s.participants ?? [] };
    case "custom":
      return {
        method: "custom",
        amounts: Object.fromEntries(Object.entries(s.amounts ?? {}).map(([k, v]) => [k, BigInt(v)])),
      };
    case "percentage":
      return { method: "percentage", bps: s.bps ?? {} };
    case "shares":
      return { method: "shares", weights: s.weights ?? {} };
  }
}

/** Back to the form representation (for the edit screen). */
export function storedToBody(s: StoredSplit): SplitBody {
  switch (s.method) {
    case "equal":
      return { method: "equal", participants: s.participants ?? [] };
    case "custom":
      return {
        method: "custom",
        amounts: Object.fromEntries(Object.entries(s.amounts ?? {}).map(([k, v]) => [k, toDecimalString(BigInt(v))])),
      };
    case "percentage":
      return {
        method: "percentage",
        percentages: Object.fromEntries(Object.entries(s.bps ?? {}).map(([k, v]) => [k, formatBps(v)])),
      };
    case "shares":
      return { method: "shares", shares: s.weights ?? {} };
  }
}

export function computeSharesFromBody(totalDecimal: string, body: SplitBody, payer: string): Share[] {
  const total = parseAmount(totalDecimal);
  return computeSplit(total, bodyToEngine(body).input, { payer: payer.toLowerCase() });
}
