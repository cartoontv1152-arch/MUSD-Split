/**
 * Pure on-chain payment verification. Given a transaction receipt (fetched server-side from the
 * Mezo testnet RPC — never trusted from the client) and the settlement intent, decide whether the
 * receipt proves that exact payment.
 *
 * Checks: execution success, sender, tx target (MUSD token for direct transfers, the
 * MUSDSplitSettlement contract for contract settlements), the MUSD `Transfer` log
 * (token address, from, to, value), the contract `Settled` event (settlement id, from, to,
 * amount) and that the tx is not older than the intent.
 */

import { decodeEventLog, getAddress, isAddressEqual, parseAbiItem, toEventSelector, type Hex } from "viem";

export const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
export const SETTLED_EVENT = parseAbiItem(
  "event Settled(bytes32 indexed settlementId, address indexed from, address indexed to, uint256 amount)",
);
export const TRANSFER_TOPIC = toEventSelector(TRANSFER_EVENT);
export const SETTLED_TOPIC = toEventSelector(SETTLED_EVENT);

export interface ReceiptLog {
  address: string;
  topics: readonly Hex[];
  data: Hex;
  logIndex: number;
}

export interface ReceiptLike {
  status: "success" | "reverted";
  transactionHash: Hex;
  blockNumber: bigint;
  from: string;
  to: string | null;
  logs: readonly ReceiptLog[];
}

export type SettlementMethod = "direct" | "contract";

export interface ExpectedPayment {
  method: SettlementMethod;
  from: string;
  to: string;
  amount: bigint;
  /** bytes32 settlement id (contract path) */
  settlementKey?: Hex;
  /** the tx must be in this block or later (block at intent creation, minus tolerance) */
  minBlock?: bigint;
}

export interface VerifyContext {
  musd: string;
  settlementContract?: string;
}

export type VerifyResult =
  | { outcome: "confirmed"; logIndex: number; blockNumber: bigint }
  | { outcome: "failed"; code: "REVERTED"; reason: string }
  | { outcome: "rejected"; code: RejectCode; reason: string };

export type RejectCode =
  | "SENDER_MISMATCH"
  | "TX_TOO_OLD"
  | "NOT_MUSD_TRANSFER"
  | "NOT_SETTLEMENT_CONTRACT"
  | "NO_TRANSFER"
  | "RECIPIENT_MISMATCH"
  | "AMOUNT_MISMATCH"
  | "NO_SETTLED_EVENT"
  | "SETTLED_MISMATCH"
  | "CONTRACT_NOT_CONFIGURED";

const eq = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && isAddressEqual(getAddress(a), getAddress(b));

interface DecodedTransfer {
  from: string;
  to: string;
  value: bigint;
  logIndex: number;
}

export function decodeMusdTransfers(receipt: ReceiptLike, musd: string): DecodedTransfer[] {
  const out: DecodedTransfer[] = [];
  for (const log of receipt.logs) {
    if (!eq(log.address, musd) || log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC.toLowerCase()) continue;
    try {
      const d = decodeEventLog({ abi: [TRANSFER_EVENT], data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      out.push({ from: d.args.from, to: d.args.to, value: d.args.value, logIndex: log.logIndex });
    } catch {
      // malformed log — ignore
    }
  }
  return out;
}

export function decodeSettledEvents(receipt: ReceiptLike, contract: string) {
  const out: Array<{ settlementId: Hex; from: string; to: string; amount: bigint; logIndex: number }> = [];
  for (const log of receipt.logs) {
    if (!eq(log.address, contract) || log.topics[0]?.toLowerCase() !== SETTLED_TOPIC.toLowerCase()) continue;
    try {
      const d = decodeEventLog({ abi: [SETTLED_EVENT], data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      out.push({ ...d.args, logIndex: log.logIndex });
    } catch {
      // ignore
    }
  }
  return out;
}

function findTransfer(transfers: DecodedTransfer[], exp: ExpectedPayment): VerifyResult | DecodedTransfer {
  const fromPayer = transfers.filter((t) => eq(t.from, exp.from));
  if (fromPayer.length === 0) {
    return { outcome: "rejected", code: "NO_TRANSFER", reason: "No MUSD transfer from the payer in this transaction" };
  }
  const toRecipient = fromPayer.filter((t) => eq(t.to, exp.to));
  if (toRecipient.length === 0) {
    return { outcome: "rejected", code: "RECIPIENT_MISMATCH", reason: "MUSD was sent to a different address" };
  }
  const exact = toRecipient.find((t) => t.value === exp.amount);
  if (!exact) {
    return {
      outcome: "rejected",
      code: "AMOUNT_MISMATCH",
      reason: `Transferred amount (${toRecipient[0].value} base units) does not match the expected ${exp.amount}`,
    };
  }
  return exact;
}

export function verifyPaymentReceipt(receipt: ReceiptLike, exp: ExpectedPayment, ctx: VerifyContext): VerifyResult {
  if (receipt.status !== "success") {
    return { outcome: "failed", code: "REVERTED", reason: "The transaction reverted on-chain. No MUSD moved." };
  }
  if (!eq(receipt.from, exp.from)) {
    return { outcome: "rejected", code: "SENDER_MISMATCH", reason: "This transaction was sent from a different wallet" };
  }
  if (exp.minBlock !== undefined && receipt.blockNumber < exp.minBlock) {
    return {
      outcome: "rejected",
      code: "TX_TOO_OLD",
      reason: "This transaction happened before the payment was started, so it can't be used for it",
    };
  }

  const transfers = decodeMusdTransfers(receipt, ctx.musd);

  if (exp.method === "direct") {
    if (!eq(receipt.to, ctx.musd)) {
      return { outcome: "rejected", code: "NOT_MUSD_TRANSFER", reason: "This is not a direct MUSD transfer" };
    }
    const t = findTransfer(transfers, exp);
    if ("outcome" in t) return t;
    return { outcome: "confirmed", logIndex: t.logIndex, blockNumber: receipt.blockNumber };
  }

  // contract path
  if (!ctx.settlementContract) {
    return { outcome: "rejected", code: "CONTRACT_NOT_CONFIGURED", reason: "Settlement contract is not configured" };
  }
  if (!eq(receipt.to, ctx.settlementContract)) {
    return {
      outcome: "rejected",
      code: "NOT_SETTLEMENT_CONTRACT",
      reason: "This transaction did not call the MUSD Split settlement contract",
    };
  }
  const key = exp.settlementKey?.toLowerCase();
  const ev = decodeSettledEvents(receipt, ctx.settlementContract).find((e) => e.settlementId.toLowerCase() === key);
  if (!ev) {
    return { outcome: "rejected", code: "NO_SETTLED_EVENT", reason: "No Settled event for this settlement id" };
  }
  if (!eq(ev.from, exp.from) || !eq(ev.to, exp.to) || ev.amount !== exp.amount) {
    return {
      outcome: "rejected",
      code: "SETTLED_MISMATCH",
      reason: "The on-chain settlement doesn't match the payer, recipient or amount",
    };
  }
  const t = findTransfer(transfers, exp);
  if ("outcome" in t) return t;
  return { outcome: "confirmed", logIndex: ev.logIndex, blockNumber: receipt.blockNumber };
}
