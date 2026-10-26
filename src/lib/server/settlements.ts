import "server-only";
import { getAddress, parseAbiItem, toHex, type Hex } from "viem";
import { LIMITS } from "@/config/app";
import { MUSD, SETTLEMENT_CONTRACT } from "@/config/contracts";
import { verifyPaymentReceipt, type ExpectedPayment, type VerifyResult } from "@/lib/chain/verify";
import {
  checkSettlementIntent,
  formatAmount,
  isInFlight,
  parseAmount,
  type SettlementStatus,
} from "@/lib/engine";
import { blockTime, currentBlock, lookupReceipt, lookupTxSender, publicClient } from "./chain";
import { getPool, isUniqueViolation, q, q1, withTx, type Queryable } from "./db";
import { notify, recordActivity } from "./events";
import { SETTLEMENT_SELECT, loadLedger, requireMember, type SettlementRow } from "./groups";
import { ApiError, badRequest, conflict, forbidden, notFound } from "./http";
import { getProfiles } from "./users";

export type IntentMethod = "direct" | "contract" | "contract_permit";

const name = (p: { displayName: string | null; username: string | null } | undefined, a: string) =>
  p?.displayName || (p?.username ? `@${p.username}` : `${a.slice(0, 6)}…${a.slice(-4)}`);

function randomKey(): Hex {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return toHex(b);
}

export async function getSettlement(id: string, client?: Queryable): Promise<SettlementRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return q1<SettlementRow>(`${SETTLEMENT_SELECT} WHERE s.id = $1`, [id], client);
}

async function logEvent(
  c: Queryable,
  e: { settlementId?: string | null; batchId?: string | null; from: string | null; to: string; txHash?: string | null; detail?: string; actor?: string | null },
) {
  await q(
    `INSERT INTO split.settlement_events (settlement_id, batch_id, from_status, to_status, tx_hash, detail, actor)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [e.settlementId ?? null, e.batchId ?? null, e.from, e.to, e.txHash ?? null, e.detail ?? null, e.actor ?? null],
    c,
  );
}

function expectedFor(s: SettlementRow): ExpectedPayment {
  const viaContract = s.method !== "direct";
  return {
    method: viaContract ? "contract" : "direct",
    from: s.from_address,
    to: s.to_address,
    amount: BigInt(s.amount),
    settlementKey: s.settlement_key as Hex,
    // direct transfers carry no on-chain id, so bind them to blocks after the intent was created
    minBlock: !viaContract && s.created_block ? BigInt(s.created_block) : undefined,
  };
}

const VERIFY_CTX = { musd: MUSD.address, settlementContract: SETTLEMENT_CONTRACT.address };

/* ------------------------------------------------------------------ intents */

export async function createSettlementIntent(
  groupId: string,
  actor: string,
  input: { to: string; amount: string; method: IntentMethod; paymentRequestId?: string | null; expenseIds?: string[]; note?: string | null },
) {
  const { group } = await requireMember(groupId, actor);
  const amount = parseAmount(input.amount);
  const to = input.to.toLowerCase();

  // Recovery first: if an earlier unfinished attempt for this pair was actually paid on-chain,
  // attach it instead of letting the user pay twice.
  const stale = await q<SettlementRow>(
    `${SETTLEMENT_SELECT} WHERE s.group_id = $1 AND s.from_address = $2 AND s.to_address = $3 AND s.status = 'created' AND s.batch_id IS NULL`,
    [groupId, actor, to],
  );
  for (const s of stale) {
    const found = await recoverSettlement(s.id, actor, { quiet: true }).catch(() => null);
    if (found && found.status !== "created" && found.status !== "cancelled") {
      throw conflict(
        "We found an earlier payment for this debt on-chain — it's being verified now, so you don't pay twice.",
        "EARLIER_PAYMENT_FOUND",
        { settlementId: s.id },
      );
    }
  }

  const head = await currentBlock();
  return withTx(async (c) => {
    await q(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`settle:${groupId}:${actor}`], c);
    // supersede abandoned attempts (no tx recorded) for the same pair
    for (const s of stale) {
      const r = await q1(
        `UPDATE split.settlements SET status = 'cancelled', failure_code = 'SUPERSEDED',
           failure_reason = 'Replaced by a newer payment attempt', updated_at = now()
         WHERE id = $1 AND status = 'created' RETURNING id`,
        [s.id],
        c,
      );
      if (r) await logEvent(c, { settlementId: s.id, from: "created", to: "cancelled", detail: "superseded", actor });
    }

    let request: { id: string; requester: string; payer: string; amount: string; status: string; expense_ids: string[] } | null = null;
    if (input.paymentRequestId) {
      request = await q1(
        `SELECT id, requester, payer, amount::text AS amount, status, expense_ids FROM split.payment_requests
         WHERE id = $1 AND group_id = $2 FOR UPDATE`,
        [input.paymentRequestId, groupId],
        c,
      );
      if (!request) throw notFound("Payment request not found");
      if (request.payer !== actor) throw forbidden("This request isn't addressed to you");
      if (request.status !== "pending") throw conflict(`This request is already ${request.status}`, "REQUEST_CLOSED");
      if (request.requester !== to) throw badRequest("Pay the member who sent the request", "REQUEST_RECIPIENT_MISMATCH");
      if (BigInt(request.amount) !== amount) throw badRequest("Pay the exact requested amount", "REQUEST_AMOUNT_MISMATCH");
    }

    const loaded = await loadLedger(group, c);
    const inFlight = loaded.settlements
      .filter((s) => isInFlight(s.status))
      .map((s) => ({ from: s.from_address, to: s.to_address, amount: BigInt(s.amount) }));
    const policy = checkSettlementIntent({
      from: actor,
      to,
      amount,
      nets: loaded.ledger.nets,
      simplified: loaded.ledger.simplified,
      pairwise: loaded.ledger.pairwise,
      inFlight,
      activeMembers: loaded.activeMembers,
    });
    if (!policy.ok) throw conflict(policy.message, policy.code, { max: policy.max.toString() });

    const expenseIds = [...new Set([...(input.expenseIds ?? []), ...(request?.expense_ids ?? [])])];
    if (expenseIds.length) {
      const known = new Set(loaded.expenses.map((e) => e.id));
      if (expenseIds.some((e) => !known.has(e))) throw badRequest("Unknown expense in this group", "UNKNOWN_EXPENSE");
    }

    const id = crypto.randomUUID();
    const createdBlock = head !== null && head > LIMITS.intentBlockTolerance ? head - LIMITS.intentBlockTolerance : null;
    await q(
      `INSERT INTO split.settlements (id, group_id, from_address, to_address, amount, method, settlement_key, status,
         created_block, payment_request_id, expense_ids, note)
       VALUES ($1,$2,$3,$4,$5::numeric,$6,$7,'created',$8,$9,$10::uuid[],$11)`,
      [id, groupId, actor, to, amount.toString(), input.method, randomKey(), createdBlock?.toString() ?? null, request?.id ?? null, expenseIds, input.note || null],
      c,
    );
    await logEvent(c, { settlementId: id, from: null, to: "created", actor, detail: `${input.method} ${amount}` });
    return (await getSettlement(id, c))!;
  });
}

export async function cancelSettlement(id: string, actor: string) {
  const s = await getSettlement(id);
  if (!s) throw notFound("Payment not found");
  if (s.from_address !== actor) throw forbidden("Only the payer can cancel this payment");
  if (s.status !== "created") {
    throw conflict("A transaction was already recorded for this payment, so it can't be cancelled — it will be verified instead.", "NOT_CANCELLABLE");
  }
  // last check: was it paid on-chain after all?
  const recovered = await recoverSettlement(id, actor, { quiet: true }).catch(() => null);
  if (recovered && recovered.status !== "created") return recovered;
  return withTx(async (c) => {
    const r = await q1(
      `UPDATE split.settlements SET status='cancelled', failure_code='CANCELLED', failure_reason='Cancelled before sending', updated_at=now()
       WHERE id=$1 AND status='created' RETURNING id`,
      [id],
      c,
    );
    if (r) await logEvent(c, { settlementId: id, from: "created", to: "cancelled", actor });
    return (await getSettlement(id, c))!;
  });
}

/* ------------------------------------------------------------------ submit */

function targetFor(method: SettlementRow["method"]) {
  return method === "direct" ? MUSD.address : SETTLEMENT_CONTRACT.address;
}

export async function submitSettlementTx(id: string, actor: string, txHash: Hex) {
  const s = await getSettlement(id);
  if (!s) throw notFound("Payment not found");
  if (s.from_address !== actor) throw forbidden("Only the payer can submit a transaction for this payment");
  if (s.batch_id) throw badRequest("This payment is part of a batch — submit the batch transaction", "USE_BATCH");
  if (s.tx_hash === txHash && s.status !== "created") return verifySettlement(id);
  if (s.status !== "created") throw conflict(`This payment is already ${s.status}`, "ALREADY_SUBMITTED");

  // Cheap pre-checks so nobody can squat someone else's tx hash.
  const sender = await lookupTxSender(txHash);
  if (sender) {
    let reject: { code: string; message: string } | null = null;
    if (sender.from.toLowerCase() !== actor) {
      reject = { code: "SENDER_MISMATCH", message: "This transaction was sent from a different wallet, so it can't settle your debt." };
    } else if (!sender.to || getAddress(sender.to) !== getAddress(targetFor(s.method))) {
      reject = {
        code: s.method === "direct" ? "NOT_MUSD_TRANSFER" : "NOT_SETTLEMENT_CONTRACT",
        message: s.method === "direct" ? "This transaction is not a direct MUSD transfer." : "This transaction did not call the settlement contract.",
      };
    }
    if (reject) {
      await logEvent(getPool(), { settlementId: id, from: s.status, to: s.status, txHash, actor, detail: `submit rejected: ${reject.code}` });
      throw new ApiError(422, reject.code, reject.message);
    }
  }
  const used = await q1(
    `SELECT 1 FROM split.settlements WHERE tx_hash = $1 OR rejected_tx_hash = $1
     UNION ALL SELECT 1 FROM split.settlement_batches WHERE tx_hash = $1 LIMIT 1`,
    [txHash],
  );
  if (used) throw conflict("This transaction has already been used for a payment.", "TX_ALREADY_USED");

  try {
    await withTx(async (c) => {
      const r = await q1(
        `UPDATE split.settlements SET tx_hash=$2, status='submitted', submitted_at=now(), updated_at=now()
         WHERE id=$1 AND status='created' RETURNING id`,
        [id, txHash],
        c,
      );
      if (!r) throw conflict("This payment changed in the meantime. Reload and try again.", "STATE_CHANGED");
      await logEvent(c, { settlementId: id, from: "created", to: "submitted", txHash, actor });
      await recordActivity(c, s.group_id, actor, "settlement_initiated", {
        settlementId: id,
        from: s.from_address,
        to: s.to_address,
        amount: s.amount,
        txHash,
        method: s.method,
      });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("This transaction has already been used for a payment.", "TX_ALREADY_USED");
    throw e;
  }
  return verifySettlement(id, { attempts: 3 });
}

/* ------------------------------------------------------------------ verify */

export async function verifySettlement(id: string, opts: { attempts?: number } = {}): Promise<SettlementRow> {
  const s = await getSettlement(id);
  if (!s) throw notFound("Payment not found");
  if (!s.tx_hash || !["submitted", "delayed"].includes(s.status)) return s;
  if (s.batch_id) {
    await verifyBatch(s.batch_id, opts);
    return (await getSettlement(id))!;
  }
  const lookup = await lookupReceipt(s.tx_hash as Hex, { attempts: opts.attempts ?? 3 });
  if (lookup.kind === "found") {
    const result = verifyPaymentReceipt(lookup.receipt, expectedFor(s), VERIFY_CTX);
    await applyResult(s, result, lookup.receipt.blockNumber);
  } else {
    await applyPending(s, lookup);
  }
  return (await getSettlement(id))!;
}

async function applyPending(s: SettlementRow, lookup: Awaited<ReturnType<typeof lookupReceipt>>) {
  const age = Date.now() - (s.submitted_at?.getTime() ?? Date.now());
  if (lookup.kind === "not_found" && age > LIMITS.txNotFoundTimeoutMs) {
    await applyResult(s, {
      outcome: "rejected",
      code: "TX_NOT_FOUND" as never,
      reason: "This transaction was never found on Mezo testnet. If you paid, use “Check chain for my payment”.",
    });
    return;
  }
  const next: SettlementStatus = lookup.kind === "error" ? "delayed" : "submitted";
  await withTx(async (c) => {
    const r = await q1(
      `UPDATE split.settlements SET status=$2, verify_attempts = verify_attempts + 1, last_checked_at = now(),
         failure_reason = $3, updated_at = now() WHERE id=$1 AND status IN ('submitted','delayed') RETURNING id`,
      [s.id, next, lookup.kind === "error" ? `Verification delayed: ${lookup.message}` : null],
      c,
    );
    if (r && next !== s.status) await logEvent(c, { settlementId: s.id, from: s.status, to: next, txHash: s.tx_hash, detail: lookup.kind });
  });
}

async function applyResult(s: SettlementRow, result: VerifyResult | { outcome: "rejected"; code: string; reason: string }, blockNumber?: bigint) {
  const profiles = await getProfiles([s.from_address, s.to_address]);
  const fromName = name(profiles[s.from_address], s.from_address);
  const toName = name(profiles[s.to_address], s.to_address);
  const amountStr = formatAmount(BigInt(s.amount));
  const ts = blockNumber ? await blockTime(blockNumber) : null;

  await withTx(async (c) => {
    if (result.outcome === "confirmed") {
      let ok: unknown = null;
      try {
        ok = await q1(
          `UPDATE split.settlements SET status='confirmed', log_index=$2, block_number=$3, block_time=$4, confirmed_at=now(),
             verify_attempts = verify_attempts + 1, last_checked_at = now(), failure_code = NULL, failure_reason = NULL, updated_at = now()
           WHERE id=$1 AND status IN ('submitted','delayed') RETURNING id`,
          [s.id, result.logIndex, result.blockNumber.toString(), ts ?? new Date()],
          c,
        );
      } catch (e) {
        if (isUniqueViolation(e)) {
          throw new DuplicateLog();
        }
        throw e;
      }
      if (!ok) return;
      await logEvent(c, { settlementId: s.id, from: s.status, to: "confirmed", txHash: s.tx_hash, detail: `block ${result.blockNumber} log ${result.logIndex}` });
      if (s.payment_request_id) {
        await q(
          `UPDATE split.payment_requests SET status='paid', paid_settlement_id=$2, closed_at=now(), updated_at=now()
           WHERE id=$1 AND status IN ('pending','expired')`,
          [s.payment_request_id, s.id],
          c,
        );
      }
      await recordActivity(c, s.group_id, s.from_address, "settlement_confirmed", {
        settlementId: s.id,
        from: s.from_address,
        to: s.to_address,
        amount: s.amount,
        txHash: s.tx_hash,
        blockNumber: result.blockNumber.toString(),
        method: s.method,
        paymentRequestId: s.payment_request_id,
      });
      await notify(c, [s.from_address], {
        groupId: s.group_id,
        type: "settlement_confirmed",
        title: `Payment confirmed: ${amountStr} MUSD to ${toName}`,
        body: "Verified on Mezo testnet.",
        href: `/settlements/${s.id}`,
        data: { settlementId: s.id, txHash: s.tx_hash },
      });
      await notify(c, [s.to_address], {
        groupId: s.group_id,
        type: "settlement_received",
        title: `${fromName} paid you ${amountStr} MUSD`,
        body: "Verified on Mezo testnet.",
        href: `/settlements/${s.id}`,
        data: { settlementId: s.id, txHash: s.tx_hash },
      });
      return;
    }
    const failed = result.outcome === "failed";
    const r = await q1(
      failed
        ? `UPDATE split.settlements SET status='failed', failure_code=$2, failure_reason=$3, verify_attempts = verify_attempts + 1,
             last_checked_at = now(), updated_at = now() WHERE id=$1 AND status IN ('submitted','delayed') RETURNING id`
        : `UPDATE split.settlements SET status='rejected', failure_code=$2, failure_reason=$3, rejected_tx_hash = tx_hash, tx_hash = NULL,
             verify_attempts = verify_attempts + 1, last_checked_at = now(), updated_at = now()
           WHERE id=$1 AND status IN ('submitted','delayed') RETURNING id`,
      [s.id, result.code, result.reason],
      c,
    );
    if (!r) return;
    await logEvent(c, { settlementId: s.id, from: s.status, to: failed ? "failed" : "rejected", txHash: s.tx_hash, detail: `${result.code}: ${result.reason}` });
    await recordActivity(c, s.group_id, s.from_address, failed ? "settlement_failed" : "settlement_rejected", {
      settlementId: s.id,
      from: s.from_address,
      to: s.to_address,
      amount: s.amount,
      txHash: s.tx_hash,
      code: result.code,
      reason: result.reason,
    });
    await notify(c, [s.from_address], {
      groupId: s.group_id,
      type: "settlement_failed",
      title: failed ? `Payment to ${toName} failed` : `Payment to ${toName} couldn't be verified`,
      body: result.reason,
      href: `/settlements/${s.id}`,
      data: { settlementId: s.id, code: result.code },
    });
  }).catch(async (e) => {
    if (e instanceof DuplicateLog) {
      await applyResult(s, { outcome: "rejected", code: "TX_ALREADY_USED", reason: "This transaction already backs another payment." });
      return;
    }
    throw e;
  });
}

class DuplicateLog extends Error {}

/* ------------------------------------------------------------------ recovery */

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const SETTLED = parseAbiItem("event Settled(bytes32 indexed settlementId, address indexed from, address indexed to, uint256 amount)");

/**
 * "Check chain for my payment": finds a transaction that pays this intent even if the browser
 * never reported its hash (tab closed, wallet glitch). Contract payments are found exactly by
 * their settlement id; direct transfers by (from, to, amount) after the intent's creation block.
 */
export async function recoverSettlement(id: string, actor: string, opts: { quiet?: boolean } = {}) {
  const s = await getSettlement(id);
  if (!s) throw notFound("Payment not found");
  if (s.from_address !== actor) throw forbidden("Only the payer can do this");
  if (s.status !== "created") return s;
  const pc = publicClient();
  const head = await pc.getBlockNumber();
  const start = s.created_block ? BigInt(s.created_block) : head - 5000n;
  const maxSpan = 60_000n;
  const from = head - start > maxSpan ? head - maxSpan : start;
  const step = 10_000n;
  let candidate: Hex | null = null;
  for (let lo = from; lo <= head && !candidate; lo += step) {
    const hi = lo + step - 1n > head ? head : lo + step - 1n;
    if (s.method === "direct") {
      const logs = await pc.getLogs({
        address: MUSD.address,
        event: TRANSFER,
        args: { from: getAddress(s.from_address), to: getAddress(s.to_address) },
        fromBlock: lo,
        toBlock: hi,
      });
      for (const l of logs) {
        if (l.args.value !== BigInt(s.amount) || !l.transactionHash) continue;
        const used = await q1(
          `SELECT 1 FROM split.settlements WHERE tx_hash = $1 OR rejected_tx_hash = $1 UNION ALL SELECT 1 FROM split.settlement_batches WHERE tx_hash = $1 LIMIT 1`,
          [l.transactionHash.toLowerCase()],
        );
        if (!used) {
          candidate = l.transactionHash;
          break;
        }
      }
    } else {
      const logs = await pc.getLogs({
        address: SETTLEMENT_CONTRACT.address,
        event: SETTLED,
        args: { settlementId: s.settlement_key as Hex, from: getAddress(s.from_address) },
        fromBlock: lo,
        toBlock: hi,
      });
      if (logs[0]?.transactionHash) candidate = logs[0].transactionHash;
    }
  }
  if (!candidate) return s;
  try {
    return await submitSettlementTx(id, actor, candidate.toLowerCase() as Hex);
  } catch (e) {
    if (opts.quiet) return s;
    throw e;
  }
}

/* ------------------------------------------------------------------ batches */

export interface BatchRow {
  id: string;
  group_id: string;
  payer: string;
  method: "batch" | "batch_permit";
  total: string;
  status: SettlementStatus;
  tx_hash: string | null;
  block_number: string | null;
  created_block: string | null;
  failure_reason: string | null;
  created_at: Date;
  submitted_at: Date | null;
  confirmed_at: Date | null;
}

export async function getBatch(id: string, client?: Queryable) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const batch = await q1<BatchRow>(
    `SELECT *, total::text AS total, block_number::text AS block_number FROM split.settlement_batches WHERE id = $1`,
    [id],
    client,
  );
  if (!batch) return null;
  const items = await q<SettlementRow>(`${SETTLEMENT_SELECT} WHERE s.batch_id = $1 ORDER BY s.created_at, s.id`, [id], client);
  return { batch, items };
}

/** "Settle everything I owe in this group in one transaction" via settleBatch / settleBatchWithPermit. */
export async function createBatch(groupId: string, actor: string, method: "batch" | "batch_permit") {
  const { group } = await requireMember(groupId, actor);
  const head = await currentBlock();
  return withTx(async (c) => {
    await q(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`settle:${groupId}:${actor}`], c);
    // abandon older unsent attempts by this payer in this group
    await q(
      `UPDATE split.settlements SET status='cancelled', failure_code='SUPERSEDED', failure_reason='Replaced by a batch payment', updated_at=now()
       WHERE group_id=$1 AND from_address=$2 AND status='created'`,
      [groupId, actor],
      c,
    );
    await q(
      `UPDATE split.settlement_batches SET status='cancelled', updated_at=now() WHERE group_id=$1 AND payer=$2 AND status='created'`,
      [groupId, actor],
      c,
    );
    const loaded = await loadLedger(group, c);
    const inFlight = loaded.settlements.filter((s) => isInFlight(s.status));
    if (inFlight.some((s) => s.from_address === actor)) {
      throw conflict("You have a payment that's still being confirmed. Wait for it before settling everything.", "PAYMENT_IN_FLIGHT");
    }
    const route = group.simplify_debts ? loaded.ledger.simplified : loaded.ledger.pairwise;
    const items = route.filter((t) => t.from === actor);
    if (items.length === 0) throw conflict("You don't owe anyone in this group right now.", "NOTHING_OWED");
    if (items.length > SETTLEMENT_CONTRACT.maxBatch) throw badRequest("Too many payees for one batch", "BATCH_TOO_LARGE");
    for (const t of items) {
      if (!loaded.activeMembers.has(t.to)) throw conflict("One of your creditors has left the group", "RECIPIENT_NOT_MEMBER");
    }
    const id = crypto.randomUUID();
    const total = items.reduce((a, t) => a + t.amount, 0n);
    const createdBlock = head !== null ? head - LIMITS.intentBlockTolerance : null;
    await q(
      `INSERT INTO split.settlement_batches (id, group_id, payer, method, total, status, created_block)
       VALUES ($1,$2,$3,$4,$5::numeric,'created',$6)`,
      [id, groupId, actor, method, total.toString(), createdBlock?.toString() ?? null],
      c,
    );
    for (const t of items) {
      const sid = crypto.randomUUID();
      await q(
        `INSERT INTO split.settlements (id, group_id, from_address, to_address, amount, method, settlement_key, status, created_block, batch_id)
         VALUES ($1,$2,$3,$4,$5::numeric,$6,$7,'created',$8,$9)`,
        [sid, groupId, actor, t.to, t.amount.toString(), method, randomKey(), createdBlock?.toString() ?? null, id],
        c,
      );
      await logEvent(c, { settlementId: sid, batchId: id, from: null, to: "created", actor, detail: `${method} item` });
    }
    return (await getBatch(id, c))!;
  });
}

export async function submitBatchTx(batchId: string, actor: string, txHash: Hex) {
  const b = await getBatch(batchId);
  if (!b) throw notFound("Batch not found");
  if (b.batch.payer !== actor) throw forbidden("Only the payer can submit this batch");
  if (b.batch.tx_hash === txHash && b.batch.status !== "created") return verifyBatch(batchId);
  if (b.batch.status !== "created") throw conflict(`This batch is already ${b.batch.status}`, "ALREADY_SUBMITTED");
  const sender = await lookupTxSender(txHash);
  if (sender && sender.from.toLowerCase() !== actor) {
    throw new ApiError(422, "SENDER_MISMATCH", "This transaction was sent from a different wallet.");
  }
  if (sender && (!sender.to || getAddress(sender.to) !== getAddress(SETTLEMENT_CONTRACT.address))) {
    throw new ApiError(422, "NOT_SETTLEMENT_CONTRACT", "This transaction did not call the settlement contract.");
  }
  const used = await q1(
    `SELECT 1 FROM split.settlements WHERE tx_hash = $1 OR rejected_tx_hash = $1 UNION ALL SELECT 1 FROM split.settlement_batches WHERE tx_hash = $1 LIMIT 1`,
    [txHash],
  );
  if (used) throw conflict("This transaction has already been used for a payment.", "TX_ALREADY_USED");
  try {
    await withTx(async (c) => {
      const r = await q1(
        `UPDATE split.settlement_batches SET tx_hash=$2, status='submitted', submitted_at=now(), updated_at=now()
         WHERE id=$1 AND status='created' RETURNING id`,
        [batchId, txHash],
        c,
      );
      if (!r) throw conflict("This batch changed in the meantime.", "STATE_CHANGED");
      await q(
        `UPDATE split.settlements SET tx_hash=$2, status='submitted', submitted_at=now(), updated_at=now() WHERE batch_id=$1 AND status='created'`,
        [batchId, txHash],
        c,
      );
      await logEvent(c, { batchId, from: "created", to: "submitted", txHash, actor });
      await recordActivity(c, b.batch.group_id, actor, "settlement_initiated", {
        batchId,
        from: actor,
        amount: b.batch.total,
        txHash,
        method: b.batch.method,
        items: b.items.map((i) => ({ settlementId: i.id, to: i.to_address, amount: i.amount })),
      });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("This transaction has already been used for a payment.", "TX_ALREADY_USED");
    throw e;
  }
  return verifyBatch(batchId, { attempts: 3 });
}

export async function verifyBatch(batchId: string, opts: { attempts?: number } = {}) {
  const b = await getBatch(batchId);
  if (!b) throw notFound("Batch not found");
  if (!b.batch.tx_hash || !["submitted", "delayed"].includes(b.batch.status)) return b;
  const lookup = await lookupReceipt(b.batch.tx_hash as Hex, { attempts: opts.attempts ?? 3 });
  if (lookup.kind !== "found") {
    for (const item of b.items) if (["submitted", "delayed"].includes(item.status)) await applyPending(item, lookup);
    const age = Date.now() - (b.batch.submitted_at?.getTime() ?? Date.now());
    const next =
      lookup.kind === "error" ? "delayed" : lookup.kind === "not_found" && age > LIMITS.txNotFoundTimeoutMs ? "rejected" : "submitted";
    await q(`UPDATE split.settlement_batches SET status=$2, updated_at=now() WHERE id=$1 AND status IN ('submitted','delayed')`, [batchId, next]);
    return (await getBatch(batchId))!;
  }
  for (const item of b.items) {
    if (!["submitted", "delayed"].includes(item.status)) continue;
    const result = verifyPaymentReceipt(lookup.receipt, expectedFor(item), VERIFY_CTX);
    await applyResult(item, result, lookup.receipt.blockNumber);
  }
  const after = (await getBatch(batchId))!;
  const statuses = after.items.map((i) => i.status);
  const status: SettlementStatus = statuses.every((s) => s === "confirmed")
    ? "confirmed"
    : statuses.some((s) => s === "failed")
      ? "failed"
      : statuses.some((s) => s === "rejected")
        ? "rejected"
        : "submitted";
  await q(
    `UPDATE split.settlement_batches SET status=$2, block_number=$3, confirmed_at = CASE WHEN $2 = 'confirmed' THEN now() ELSE confirmed_at END,
       failure_reason = $4, updated_at = now() WHERE id=$1`,
    [batchId, status, lookup.receipt.blockNumber.toString(), after.items.find((i) => i.failure_reason)?.failure_reason ?? null],
  );
  return (await getBatch(batchId))!;
}

/** Re-verify everything still pending (cron + "check now"). */
export async function reverifyPending(limit = 25) {
  const rows = await q<{ id: string; batch_id: string | null }>(
    `SELECT id, batch_id FROM split.settlements WHERE status IN ('submitted','delayed') AND tx_hash IS NOT NULL
     ORDER BY last_checked_at NULLS FIRST LIMIT $1`,
    [limit],
  );
  const doneBatches = new Set<string>();
  let checked = 0;
  for (const r of rows) {
    try {
      if (r.batch_id) {
        if (doneBatches.has(r.batch_id)) continue;
        doneBatches.add(r.batch_id);
        await verifyBatch(r.batch_id);
      } else {
        await verifySettlement(r.id);
      }
      checked++;
    } catch (e) {
      console.error("[reverify]", r.id, (e as Error).message);
    }
  }
  return { checked };
}

