import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import {
  SETTLED_EVENT,
  TRANSFER_EVENT,
  decodeMusdTransfers,
  verifyPaymentReceipt,
  type ReceiptLike,
  type ReceiptLog,
} from "@/lib/chain/verify";

const MUSD = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503";
const CONTRACT = "0x2d2F57887fA5a970344CeA9f1176BB761aFc2602";
const BOB = "0x8Cd4e1907EF6eE35E0404c6f3a3753e487F99677";
const ALICE = "0x242097EC010825a937cE0644c1DeF52bda2FcC5e";
const CHARLIE = "0xeC053F89b27517B245fF200332cfFf91e144ACFA";
const FAKE_TOKEN = "0x000000000000000000000000000000000000dEaD";
const KEY = ("0x" + "ab".repeat(32)) as Hex;
const OTHER_KEY = ("0x" + "cd".repeat(32)) as Hex;
const M = (n: number) => BigInt(n) * 10n ** 18n;

function transferLog(token: string, from: string, to: string, value: bigint, logIndex = 0): ReceiptLog {
  return {
    address: token,
    topics: encodeEventTopics({ abi: [TRANSFER_EVENT], eventName: "Transfer", args: { from: from as Hex, to: to as Hex } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
    logIndex,
  };
}
function settledLog(id: Hex, from: string, to: string, amount: bigint, logIndex = 1, contract = CONTRACT): ReceiptLog {
  return {
    address: contract,
    topics: encodeEventTopics({
      abi: [SETTLED_EVENT],
      eventName: "Settled",
      args: { settlementId: id, from: from as Hex, to: to as Hex },
    }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
    logIndex,
  };
}
function receipt(over: Partial<ReceiptLike> = {}): ReceiptLike {
  return {
    status: "success",
    transactionHash: ("0x" + "11".repeat(32)) as Hex,
    blockNumber: 100n,
    from: BOB,
    to: MUSD,
    logs: [transferLog(MUSD, BOB, ALICE, M(30))],
    ...over,
  };
}
const ctx = { musd: MUSD, settlementContract: CONTRACT };
const direct = { method: "direct" as const, from: BOB, to: ALICE, amount: M(30), minBlock: 90n };

describe("direct MUSD transfer verification", () => {
  it("confirms a matching transfer (case-insensitive addresses)", () => {
    const r = verifyPaymentReceipt(receipt(), { ...direct, from: BOB.toLowerCase(), to: ALICE.toLowerCase() }, ctx);
    expect(r).toEqual({ outcome: "confirmed", logIndex: 0, blockNumber: 100n });
  });
  it("marks a reverted transaction as failed", () => {
    expect(verifyPaymentReceipt(receipt({ status: "reverted", logs: [] }), direct, ctx)).toMatchObject({
      outcome: "failed",
      code: "REVERTED",
    });
  });
  it("rejects someone else's transaction (Charlie submitting Bob's tx hash)", () => {
    expect(verifyPaymentReceipt(receipt(), { ...direct, from: CHARLIE }, ctx)).toMatchObject({
      outcome: "rejected",
      code: "SENDER_MISMATCH",
    });
  });
  it("rejects a wrong amount", () => {
    const r = verifyPaymentReceipt(receipt({ logs: [transferLog(MUSD, BOB, ALICE, M(1))] }), direct, ctx);
    expect(r).toMatchObject({ outcome: "rejected", code: "AMOUNT_MISMATCH" });
  });
  it("rejects a wrong recipient", () => {
    const r = verifyPaymentReceipt(receipt({ logs: [transferLog(MUSD, BOB, CHARLIE, M(30))] }), direct, ctx);
    expect(r).toMatchObject({ outcome: "rejected", code: "RECIPIENT_MISMATCH" });
  });
  it("rejects a look-alike token emitting a Transfer event", () => {
    const r = verifyPaymentReceipt(
      receipt({ to: FAKE_TOKEN, logs: [transferLog(FAKE_TOKEN, BOB, ALICE, M(30))] }),
      direct,
      ctx,
    );
    expect(r).toMatchObject({ outcome: "rejected", code: "NOT_MUSD_TRANSFER" });
    // even if the tx target were MUSD, logs from another token never count
    const r2 = verifyPaymentReceipt(receipt({ logs: [transferLog(FAKE_TOKEN, BOB, ALICE, M(30))] }), direct, ctx);
    expect(r2).toMatchObject({ outcome: "rejected", code: "NO_TRANSFER" });
  });
  it("rejects a transfer that predates the payment intent", () => {
    expect(verifyPaymentReceipt(receipt({ blockNumber: 50n }), direct, ctx)).toMatchObject({
      outcome: "rejected",
      code: "TX_TOO_OLD",
    });
  });
  it("rejects a contract-routed tx claimed as a direct transfer (prevents double counting batch logs)", () => {
    const r = verifyPaymentReceipt(
      receipt({ to: CONTRACT, logs: [transferLog(MUSD, BOB, ALICE, M(30)), settledLog(KEY, BOB, ALICE, M(30))] }),
      direct,
      ctx,
    );
    expect(r).toMatchObject({ outcome: "rejected", code: "NOT_MUSD_TRANSFER" });
  });
  it("picks the exact matching log among several", () => {
    const r = verifyPaymentReceipt(
      receipt({ logs: [transferLog(MUSD, BOB, ALICE, M(1), 3), transferLog(MUSD, BOB, ALICE, M(30), 4)] }),
      direct,
      ctx,
    );
    expect(r).toEqual({ outcome: "confirmed", logIndex: 4, blockNumber: 100n });
  });
  it("ignores malformed logs", () => {
    const bad: ReceiptLog = { address: MUSD, topics: [transferLog(MUSD, BOB, ALICE, 1n).topics[0]], data: "0x", logIndex: 9 };
    expect(decodeMusdTransfers(receipt({ logs: [bad] }), MUSD)).toEqual([]);
  });
});

describe("settlement contract verification", () => {
  const exp = { method: "contract" as const, from: BOB, to: ALICE, amount: M(30), settlementKey: KEY };
  const good = receipt({ to: CONTRACT, logs: [transferLog(MUSD, BOB, ALICE, M(30), 0), settledLog(KEY, BOB, ALICE, M(30), 1)] });

  it("confirms a matching Settled event + MUSD transfer", () => {
    expect(verifyPaymentReceipt(good, exp, ctx)).toEqual({ outcome: "confirmed", logIndex: 1, blockNumber: 100n });
  });
  it("requires the tx to target the settlement contract", () => {
    expect(verifyPaymentReceipt({ ...good, to: MUSD }, exp, ctx)).toMatchObject({ code: "NOT_SETTLEMENT_CONTRACT" });
  });
  it("requires a Settled event for this settlement id", () => {
    expect(verifyPaymentReceipt(good, { ...exp, settlementKey: OTHER_KEY }, ctx)).toMatchObject({ code: "NO_SETTLED_EVENT" });
  });
  it("rejects Settled events from a different contract", () => {
    const spoof = receipt({ to: CONTRACT, logs: [transferLog(MUSD, BOB, ALICE, M(30)), settledLog(KEY, BOB, ALICE, M(30), 1, FAKE_TOKEN)] });
    expect(verifyPaymentReceipt(spoof, exp, ctx)).toMatchObject({ code: "NO_SETTLED_EVENT" });
  });
  it("rejects mismatched event fields", () => {
    const wrong = receipt({ to: CONTRACT, logs: [transferLog(MUSD, BOB, ALICE, M(5)), settledLog(KEY, BOB, ALICE, M(5))] });
    expect(verifyPaymentReceipt(wrong, exp, ctx)).toMatchObject({ code: "SETTLED_MISMATCH" });
  });
  it("verifies each item of a batch independently", () => {
    const batch = receipt({
      to: CONTRACT,
      logs: [
        transferLog(MUSD, BOB, ALICE, M(2), 0),
        settledLog(KEY, BOB, ALICE, M(2), 1),
        transferLog(MUSD, BOB, CHARLIE, M(3), 2),
        settledLog(OTHER_KEY, BOB, CHARLIE, M(3), 3),
      ],
    });
    expect(verifyPaymentReceipt(batch, { ...exp, amount: M(2) }, ctx)).toMatchObject({ outcome: "confirmed", logIndex: 1 });
    expect(
      verifyPaymentReceipt(batch, { ...exp, to: CHARLIE, amount: M(3), settlementKey: OTHER_KEY }, ctx),
    ).toMatchObject({ outcome: "confirmed", logIndex: 3 });
  });
  it("is rejected when no contract is configured", () => {
    expect(verifyPaymentReceipt(good, exp, { musd: MUSD })).toMatchObject({ code: "CONTRACT_NOT_CONFIGURED" });
  });
});
