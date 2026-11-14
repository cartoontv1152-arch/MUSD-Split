import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import {
  SETTLED_EVENT,
  TROVE_UPDATED_EVENT,
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

describe("Mezo trove borrow-and-pay verification (withdrawMUSDWithSignature → creditor)", () => {
  const BO = "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5";
  const BOS = "0xD757e3646AF370b15f32EB557F0F8380Df7D639e";
  const ZERO = "0x0000000000000000000000000000000000000000";
  const PCV = "0x0000000000000000000000000000000000000abc";
  const tctx = { ...ctx, borrowerOperations: BO, borrowerOperationsSignatures: BOS };
  const trove = { method: "trove" as const, from: BOB, to: ALICE, amount: M(30), minBlock: 90n };
  function troveUpdatedLog(borrower: string, logIndex = 5, emitter = BO): ReceiptLog {
    return {
      address: emitter,
      topics: encodeEventTopics({ abi: [TROVE_UPDATED_EVENT], eventName: "TroveUpdated", args: { _borrower: borrower as Hex } }) as Hex[],
      data: encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint16" }, { type: "uint256" }, { type: "uint8" }],
        [M(2030), 0n, M(1), M(1), 100, 1_700_000_000n, 1],
      ),
      logIndex,
    };
  }
  const troveReceipt = (over: Partial<ReceiptLike> = {}) =>
    receipt({
      to: BOS,
      // fee mint to the protocol, then the borrowed MUSD minted straight to the creditor
      logs: [transferLog(MUSD, ZERO, PCV, M(30) / 1000n, 1), transferLog(MUSD, ZERO, ALICE, M(30), 2), troveUpdatedLog(BOB)],
      ...over,
    });

  it("confirms MUSD minted from the payer's own trove straight to the creditor", () => {
    expect(verifyPaymentReceipt(troveReceipt(), trove, tctx)).toEqual({ outcome: "confirmed", logIndex: 2, blockNumber: 100n });
  });
  it("requires the tx to go through BorrowerOperationsSignatures", () => {
    expect(verifyPaymentReceipt(troveReceipt({ to: BO }), trove, tctx)).toMatchObject({ outcome: "rejected", code: "NOT_TROVE_BORROW" });
  });
  it("rejects borrowing from someone else's trove", () => {
    const logs = [transferLog(MUSD, ZERO, ALICE, M(30), 2), troveUpdatedLog(CHARLIE)];
    expect(verifyPaymentReceipt(troveReceipt({ logs }), trove, tctx)).toMatchObject({ outcome: "rejected", code: "NOT_PAYERS_TROVE" });
  });
  it("ignores TroveUpdated events from a contract that isn't BorrowerOperations", () => {
    const logs = [transferLog(MUSD, ZERO, ALICE, M(30), 2), troveUpdatedLog(BOB, 5, FAKE_TOKEN)];
    expect(verifyPaymentReceipt(troveReceipt({ logs }), trove, tctx)).toMatchObject({ outcome: "rejected", code: "NOT_PAYERS_TROVE" });
  });
  it("rejects a borrow minted to the payer instead of the creditor", () => {
    const logs = [transferLog(MUSD, ZERO, BOB, M(30), 2), troveUpdatedLog(BOB)];
    expect(verifyPaymentReceipt(troveReceipt({ logs }), trove, tctx)).toMatchObject({ outcome: "rejected", code: "RECIPIENT_MISMATCH" });
  });
  it("rejects a smaller borrow than the debt being settled", () => {
    const logs = [transferLog(MUSD, ZERO, ALICE, M(29), 2), troveUpdatedLog(BOB)];
    expect(verifyPaymentReceipt(troveReceipt({ logs }), trove, tctx)).toMatchObject({ outcome: "rejected", code: "AMOUNT_MISMATCH" });
  });
  it("rejects a mint from a look-alike token", () => {
    const logs = [transferLog(FAKE_TOKEN, ZERO, ALICE, M(30), 2), troveUpdatedLog(BOB)];
    expect(verifyPaymentReceipt(troveReceipt({ logs }), trove, tctx)).toMatchObject({ outcome: "rejected", code: "NO_TRANSFER" });
  });
  it("rejects a borrow sent by another wallet, or older than the intent", () => {
    expect(verifyPaymentReceipt(troveReceipt({ from: CHARLIE }), trove, tctx)).toMatchObject({ code: "SENDER_MISMATCH" });
    expect(verifyPaymentReceipt(troveReceipt({ blockNumber: 50n }), trove, tctx)).toMatchObject({ code: "TX_TOO_OLD" });
  });
  it("marks a reverted borrow as failed and refuses when Mezo contracts aren't configured", () => {
    expect(verifyPaymentReceipt(troveReceipt({ status: "reverted", logs: [] }), trove, tctx)).toMatchObject({ outcome: "failed" });
    expect(verifyPaymentReceipt(troveReceipt(), trove, ctx)).toMatchObject({ code: "CONTRACT_NOT_CONFIGURED" });
  });
});
