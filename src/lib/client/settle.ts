"use client";

import { getAddress, parseSignature, type Hex } from "viem";
import { getBlock, getPublicClient, readContract, signTypedData, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { CHAIN_ID, GAS_FLOORS, gasWithFloor } from "@/config/chains";
import { MUSD, SETTLEMENT_CONTRACT, musdAbi } from "@/config/contracts";
import { wagmiConfig } from "./wagmi";
import { post } from "./api";
import type { Settlement } from "./types";

/**
 * Wallet-side execution of a settlement intent. Every write passes an explicit gas limit
 * (Mezo testnet enforces the EIP-7623 floor and the public RPC sometimes under-estimates).
 * Returns the broadcast tx hash immediately — the caller persists it before waiting.
 */

type Addr = `0x${string}`;

/** estimate via the public client (wagmi/actions has no estimateContractGas) */
function estimateContractGas(_cfg: unknown, params: Record<string, unknown>): Promise<bigint> {
  const { chainId: _c, ...rest } = params;
  void _c;
  return getPublicClient(wagmiConfig, { chainId: CHAIN_ID })!.estimateContractGas(rest as never);
}

async function est(fn: () => Promise<bigint>): Promise<bigint | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

async function permitSignature(owner: Addr, value: bigint) {
  const [domain, nonce, block] = await Promise.all([
    readContract(wagmiConfig, { address: MUSD.address, abi: musdAbi, functionName: "eip712Domain", chainId: CHAIN_ID }),
    readContract(wagmiConfig, { address: MUSD.address, abi: musdAbi, functionName: "nonces", args: [owner], chainId: CHAIN_ID }),
    getBlock(wagmiConfig, { chainId: CHAIN_ID }),
  ]);
  const [, name, version, chainId, verifyingContract] = domain;
  // deadline from chain time (not the browser clock) + 30 minutes
  const deadline = block.timestamp + 1800n;
  const signature = await signTypedData(wagmiConfig, {
    account: owner,
    domain: { name, version, chainId: Number(chainId), verifyingContract },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: { owner, spender: SETTLEMENT_CONTRACT.address, value, nonce, deadline },
  });
  const { r, s, v, yParity } = parseSignature(signature);
  return { deadline, r, s, v: Number(v ?? BigInt(yParity + 27)) };
}

async function ensureAllowance(owner: Addr, amount: bigint, onStep?: (s: string) => void) {
  const allowance = await readContract(wagmiConfig, {
    address: MUSD.address,
    abi: musdAbi,
    functionName: "allowance",
    args: [owner, SETTLEMENT_CONTRACT.address],
    chainId: CHAIN_ID,
  });
  if (allowance >= amount) return;
  onStep?.("Approve MUSD for the settlement contract (exact amount)…");
  const gas = gasWithFloor(
    await est(() =>
      estimateContractGas(wagmiConfig, { address: MUSD.address, abi: musdAbi, functionName: "approve", args: [SETTLEMENT_CONTRACT.address, amount], account: owner, chainId: CHAIN_ID }),
    ),
    GAS_FLOORS.erc20Approve,
  );
  const hash = await writeContract(wagmiConfig, {
    address: MUSD.address,
    abi: musdAbi,
    functionName: "approve",
    args: [SETTLEMENT_CONTRACT.address, amount],
    account: owner,
    chainId: CHAIN_ID,
    gas,
  });
  onStep?.("Waiting for the approval to confirm…");
  const rc = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: CHAIN_ID, retryCount: 30, pollingInterval: 2000 });
  if (rc.status !== "success") throw new Error("Approval transaction reverted");
}

export async function sendSettlement(opts: {
  method: "direct" | "contract" | "contract_permit";
  from: string;
  to: string;
  amount: bigint;
  settlementKey: Hex;
  onStep?: (s: string) => void;
}): Promise<Hex> {
  const owner = getAddress(opts.from) as Addr;
  const to = getAddress(opts.to) as Addr;
  const { amount, settlementKey: id, onStep } = opts;

  if (opts.method === "direct") {
    const gas = gasWithFloor(
      await est(() => estimateContractGas(wagmiConfig, { address: MUSD.address, abi: musdAbi, functionName: "transfer", args: [to, amount], account: owner, chainId: CHAIN_ID })),
      GAS_FLOORS.erc20Transfer,
    );
    onStep?.("Confirm the MUSD transfer in your wallet…");
    return writeContract(wagmiConfig, { address: MUSD.address, abi: musdAbi, functionName: "transfer", args: [to, amount], account: owner, chainId: CHAIN_ID, gas });
  }

  const c = SETTLEMENT_CONTRACT;
  if (opts.method === "contract_permit") {
    onStep?.("Sign the MUSD permit (free, no gas)…");
    const p = await permitSignature(owner, amount);
    const args = [id, to, amount, p.deadline, p.v, p.r, p.s] as const;
    const gas = gasWithFloor(
      await est(() => estimateContractGas(wagmiConfig, { address: c.address, abi: c.abi, functionName: "settleWithPermit", args, account: owner, chainId: CHAIN_ID })),
      GAS_FLOORS.settleWithPermit,
    );
    onStep?.("Confirm the settlement transaction in your wallet…");
    return writeContract(wagmiConfig, { address: c.address, abi: c.abi, functionName: "settleWithPermit", args, account: owner, chainId: CHAIN_ID, gas });
  }

  await ensureAllowance(owner, amount, onStep);
  const gas = gasWithFloor(
    await est(() => estimateContractGas(wagmiConfig, { address: c.address, abi: c.abi, functionName: "settle", args: [id, to, amount], account: owner, chainId: CHAIN_ID })),
    GAS_FLOORS.settle,
  );
  onStep?.("Confirm the settlement transaction in your wallet…");
  return writeContract(wagmiConfig, { address: c.address, abi: c.abi, functionName: "settle", args: [id, to, amount], account: owner, chainId: CHAIN_ID, gas });
}

export async function sendBatch(opts: {
  method: "batch" | "batch_permit";
  from: string;
  items: Array<{ settlementKey: Hex; to: string; amount: bigint }>;
  onStep?: (s: string) => void;
}): Promise<Hex> {
  const owner = getAddress(opts.from) as Addr;
  const ids = opts.items.map((i) => i.settlementKey);
  const tos = opts.items.map((i) => getAddress(i.to) as Addr);
  const amounts = opts.items.map((i) => i.amount);
  const total = amounts.reduce((a, b) => a + b, 0n);
  const c = SETTLEMENT_CONTRACT;
  const floor = GAS_FLOORS.settleBatchBase + GAS_FLOORS.settleBatchPerItem * BigInt(opts.items.length);
  if (opts.method === "batch_permit") {
    opts.onStep?.("Sign one MUSD permit for the total (free, no gas)…");
    const p = await permitSignature(owner, total);
    const args = [ids, tos, amounts, p.deadline, p.v, p.r, p.s] as const;
    const gas = gasWithFloor(
      await est(() => estimateContractGas(wagmiConfig, { address: c.address, abi: c.abi, functionName: "settleBatchWithPermit", args, account: owner, chainId: CHAIN_ID })),
      floor,
    );
    opts.onStep?.("Confirm the batch transaction in your wallet…");
    return writeContract(wagmiConfig, { address: c.address, abi: c.abi, functionName: "settleBatchWithPermit", args, account: owner, chainId: CHAIN_ID, gas });
  }
  await ensureAllowance(owner, total, opts.onStep);
  const args = [ids, tos, amounts] as const;
  const gas = gasWithFloor(
    await est(() => estimateContractGas(wagmiConfig, { address: c.address, abi: c.abi, functionName: "settleBatch", args, account: owner, chainId: CHAIN_ID })),
    floor,
  );
  opts.onStep?.("Confirm the batch transaction in your wallet…");
  return writeContract(wagmiConfig, { address: c.address, abi: c.abi, functionName: "settleBatch", args, account: owner, chainId: CHAIN_ID, gas });
}

/** Wait for a receipt, tolerating the flaky public RPC (null receipts) — the server re-verifies anyway. */
export async function waitForReceiptLenient(hash: Hex) {
  try {
    return await waitForTransactionReceipt(wagmiConfig, { hash, chainId: CHAIN_ID, retryCount: 45, pollingInterval: 2000, timeout: 120_000 });
  } catch {
    return null;
  }
}

/** After submit: wait for the receipt locally, then let the SERVER verify (it never trusts the client). */
export async function followVerification(id: string, txHash: Hex | null, onUpdate: (s: Settlement) => void) {
  if (txHash) await waitForReceiptLenient(txHash);
  for (let i = 0; i < 40; i++) {
    try {
      const { settlement } = await post<{ settlement: Settlement }>(`/api/settlements/${id}/verify`);
      onUpdate(settlement);
      if (["confirmed", "failed", "rejected", "cancelled"].includes(settlement.status)) return settlement;
    } catch {
      /* keep trying */
    }
    await new Promise((r) => setTimeout(r, i < 10 ? 3000 : 6000));
  }
  return null;
}
