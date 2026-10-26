import "server-only";
import { createPublicClient, http, type Hex, type PublicClient } from "viem";
import { EXPLORER_API_V2, mezoTestnet, rpcUrl } from "@/config/chains";
import type { ReceiptLike } from "@/lib/chain/verify";

let client: PublicClient | undefined;

export function publicClient(): PublicClient {
  if (!client) {
    client = createPublicClient({
      chain: mezoTestnet,
      transport: http(rpcUrl(), { timeout: 12_000, retryCount: 2, retryDelay: 400 }),
    }) as PublicClient;
  }
  return client;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type ReceiptLookup =
  | { kind: "found"; receipt: ReceiptLike; source: "rpc" | "explorer" }
  | { kind: "pending"; from?: string; to?: string | null } // known tx, not mined yet
  | { kind: "not_found" }
  | { kind: "error"; message: string };

function fromViemReceipt(r: Awaited<ReturnType<PublicClient["getTransactionReceipt"]>>): ReceiptLike {
  return {
    status: r.status,
    transactionHash: r.transactionHash,
    blockNumber: r.blockNumber,
    from: r.from,
    to: r.to,
    logs: r.logs.map((l) => ({ address: l.address, topics: l.topics, data: l.data, logIndex: l.logIndex ?? 0 })),
  };
}

/** Blockscout fallback — the official Mezo testnet explorer indexes receipts + logs. */
async function explorerReceipt(hash: Hex): Promise<ReceiptLike | null> {
  try {
    const [txRes, logsRes] = await Promise.all([
      fetch(`${EXPLORER_API_V2}/transactions/${hash}`, { cache: "no-store", signal: AbortSignal.timeout(8000) }),
      fetch(`${EXPLORER_API_V2}/transactions/${hash}/logs`, { cache: "no-store", signal: AbortSignal.timeout(8000) }),
    ]);
    if (!txRes.ok || !logsRes.ok) return null;
    const tx = (await txRes.json()) as {
      hash: string;
      result?: string;
      status?: string | null;
      block_number?: number | null;
      block?: number | null;
      from?: { hash: string };
      to?: { hash: string } | null;
    };
    const blockNumber = tx.block_number ?? tx.block;
    if (!blockNumber || !tx.from?.hash) return null; // still pending / not indexed
    if (tx.status !== "ok" && tx.status !== "error") return null;
    const logs = (await logsRes.json()) as {
      items: Array<{ address: { hash: string }; topics: Array<string | null>; data: string; index: number }>;
      next_page_params?: unknown;
    };
    if (logs.next_page_params) return null; // unusually large tx — don't trust a partial page
    return {
      status: tx.status === "ok" ? "success" : "reverted",
      transactionHash: tx.hash as Hex,
      blockNumber: BigInt(blockNumber),
      from: tx.from.hash,
      to: tx.to?.hash ?? null,
      logs: logs.items.map((l) => ({
        address: l.address.hash,
        topics: l.topics.filter((t): t is string => !!t) as Hex[],
        data: l.data as Hex,
        logIndex: l.index,
      })),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch a receipt robustly. The public Mezo RPC is load-balanced and some backends briefly
 * return null for mined transactions, so we retry, then fall back to the explorer, before
 * concluding "pending" / "not found". Never trusts anything the client says.
 */
export async function lookupReceipt(hash: Hex, opts: { attempts?: number } = {}): Promise<ReceiptLookup> {
  const attempts = opts.attempts ?? 4;
  const pc = publicClient();
  let lastError: string | null = null;
  let rpcAnswered = false;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await pc.getTransactionReceipt({ hash });
      return { kind: "found", receipt: fromViemReceipt(r), source: "rpc" };
    } catch (e) {
      const name = (e as Error)?.name ?? "";
      if (name === "TransactionReceiptNotFoundError") rpcAnswered = true;
      else lastError = (e as Error)?.message?.split("\n")[0] ?? "RPC error";
    }
    if (i < attempts - 1) await sleep(600 + i * 500);
  }
  const ex = await explorerReceipt(hash);
  if (ex) return { kind: "found", receipt: ex, source: "explorer" };
  try {
    const tx = await pc.getTransaction({ hash });
    return { kind: "pending", from: tx.from, to: tx.to };
  } catch (e) {
    const name = (e as Error)?.name ?? "";
    if (name === "TransactionNotFoundError") rpcAnswered = true;
    else lastError = (e as Error)?.message?.split("\n")[0] ?? lastError;
  }
  if (rpcAnswered) return { kind: "not_found" };
  return { kind: "error", message: lastError ?? "RPC unavailable" };
}

/** Light-weight sender lookup used at submit time (tx may still be pending). */
export async function lookupTxSender(hash: Hex): Promise<{ from: string; to: string | null } | null> {
  const pc = publicClient();
  for (let i = 0; i < 3; i++) {
    try {
      const tx = await pc.getTransaction({ hash });
      return { from: tx.from, to: tx.to };
    } catch {
      if (i < 2) await sleep(500);
    }
  }
  const ex = await explorerReceipt(hash);
  return ex ? { from: ex.from, to: ex.to } : null;
}

export async function currentBlock(): Promise<bigint | null> {
  try {
    return await publicClient().getBlockNumber({ cacheTime: 2_000 });
  } catch {
    return null;
  }
}

export async function blockTime(blockNumber: bigint): Promise<Date | null> {
  try {
    const b = await publicClient().getBlock({ blockNumber });
    return new Date(Number(b.timestamp) * 1000);
  } catch {
    return null;
  }
}
