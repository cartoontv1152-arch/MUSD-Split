"use client";

import { getAddress, type Hex } from "viem";
import { getBlock, getPublicClient, readContract, signTypedData, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { CHAIN_ID, GAS_FLOORS, gasWithFloor } from "@/config/chains";
import { MEZO_POOLS, MUSD, SWAP_TOKENS, erc20Abi, mezoRouterAbi, musdAbi, type SwapTokenId } from "@/config/contracts";
import {
  MEZO_PROTOCOL,
  TROVE_STATUS,
  WITHDRAW_MUSD_TYPES,
  borrowerOperationsAbi,
  borrowerOperationsSignaturesAbi,
  interestRateManagerAbi,
  priceFeedAbi,
  sortedTrovesAbi,
  troveManagerAbi,
} from "@/config/mezo";
import {
  accruedInterest,
  afterAddCollateral,
  afterBorrow,
  afterRepay,
  collateralRatio,
  liquidationPrice,
  openTroveQuote,
  type TroveParams,
  type TroveState,
} from "@/lib/mezo/trove-math";
import { wagmiConfig } from "./wagmi";

/**
 * Wallet-side Mezo integration: read a user's MUSD trove (BTC collateral → MUSD debt), borrow
 * against it — including straight to a creditor in one transaction — and swap BTC/MEZO for MUSD
 * through Mezo Pools. Every write passes an explicit gas limit (see GAS_FLOORS).
 */

type Addr = `0x${string}`;
const ZERO = "0x0000000000000000000000000000000000000000" as Addr;
const pc = () => getPublicClient(wagmiConfig, { chainId: CHAIN_ID })!;

async function estimate(params: Record<string, unknown>): Promise<bigint | null> {
  try {
    return await pc().estimateContractGas(params as never);
  } catch {
    return null;
  }
}

export interface Trove extends TroveState {
  status: (typeof TROVE_STATUS)[number];
  active: boolean;
  rateBps: number;
  /** principal + stored interest + interest accrued since the last update */
  debt: bigint;
  ratio: bigint | null;
  liquidationPrice: bigint | null;
}

export interface MezoPosition {
  params: TroveParams;
  /** APR (bps) a NEW trove would get */
  newTroveRateBps: number;
  recoveryMode: boolean;
  systemRatio: bigint;
  trove: Trove;
  balances: { btc: bigint; musd: bigint; mezo: bigint };
  readAt: number;
}

export async function readMezoPosition(owner: string): Promise<MezoPosition> {
  const a = getAddress(owner);
  const client = pc();
  const bo = { address: MEZO_PROTOCOL.BorrowerOperations, abi: borrowerOperationsAbi } as const;
  const tm = { address: MEZO_PROTOCOL.TroveManager, abi: troveManagerAbi } as const;
  const price = await client.readContract({ address: MEZO_PROTOCOL.PriceFeed, abi: priceFeedAbi, functionName: "fetchPrice" });
  const [mcr, ccr, minNetDebt, gasCompensation, borrowingRate, newRate, raw, entire, recoveryMode, systemRatio, block, btc, musd, mezo] = await Promise.all([
    client.readContract({ ...bo, functionName: "MCR" }),
    client.readContract({ ...bo, functionName: "CCR" }),
    client.readContract({ ...bo, functionName: "minNetDebt" }),
    client.readContract({ ...bo, functionName: "MUSD_GAS_COMPENSATION" }),
    client.readContract({ ...bo, functionName: "borrowingRate" }),
    client.readContract({ address: MEZO_PROTOCOL.InterestRateManager, abi: interestRateManagerAbi, functionName: "interestRate" }),
    client.readContract({ ...tm, functionName: "Troves", args: [a] }),
    client.readContract({ ...tm, functionName: "getEntireDebtAndColl", args: [a] }),
    client.readContract({ ...tm, functionName: "checkRecoveryMode", args: [price] }),
    client.readContract({ ...tm, functionName: "getTCR", args: [price] }),
    client.getBlock(),
    client.getBalance({ address: a }),
    client.readContract({ address: MUSD.address, abi: musdAbi, functionName: "balanceOf", args: [a] }),
    client.readContract({ address: SWAP_TOKENS.MEZO.address, abi: erc20Abi, functionName: "balanceOf", args: [a] }).catch(() => 0n),
  ]);
  const params: TroveParams = { price, mcr, ccr, minNetDebt, gasCompensation, borrowingRate };
  const [, , , , statusIdx, rateBps, lastUpdate, maxBorrowingCapacity] = raw;
  const [coll, principal, interest, pendingColl, pendingPrincipal, pendingInterest] = entire;
  const status = TROVE_STATUS[statusIdx] ?? "nonExistent";
  const p = principal + pendingPrincipal;
  const i = interest + pendingInterest + accruedInterest(p, Number(rateBps), lastUpdate, block.timestamp);
  const c = coll + pendingColl;
  const debt = p + i;
  return {
    params,
    newTroveRateBps: Number(newRate),
    recoveryMode,
    systemRatio,
    trove: {
      status,
      active: status === "active",
      coll: c,
      principal: p,
      interest: i,
      maxBorrowingCapacity,
      rateBps: Number(rateBps),
      debt,
      ratio: collateralRatio(c, debt, price),
      liquidationPrice: liquidationPrice(c, debt, mcr),
    },
    balances: { btc, musd, mezo },
    readAt: Date.now(),
  };
}

/** Position in SortedTroves for a trove with this nominal ICR (exact hints keep insert gas low). */
async function hintsFor(nicr: bigint): Promise<readonly [Addr, Addr]> {
  try {
    const [upper, lower] = await pc().readContract({
      address: MEZO_PROTOCOL.SortedTroves,
      abi: sortedTrovesAbi,
      functionName: "findInsertPosition",
      args: [nicr, ZERO, ZERO],
    });
    return [upper, lower];
  } catch {
    // the protocol still finds the position on-chain; it just costs more gas
    return [ZERO, ZERO];
  }
}

/** Human-readable reasons for the protocol's revert strings. */
export function mezoErrorMessage(e: unknown): string {
  const m = String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? e);
  if (/User rejected|denied|rejected the request/i.test(m)) return "You cancelled the request in your wallet.";
  if (/ICR < MCR|An operation that would result in ICR < MCR/i.test(m)) return "That would push your collateral ratio below 110%. Borrow less or add BTC first.";
  if (/TCR < CCR|Recovery Mode/i.test(m)) return "Mezo is in recovery mode right now, so borrowing is limited. Try a smaller amount or add collateral.";
  if (/net debt must be greater than minimum|minNetDebt|at least min/i.test(m)) return "A new trove must borrow at least the protocol minimum.";
  if (/borrowing capacity|maxBorrowingCapacity/i.test(m)) return "That's more than this trove's borrowing capacity. Add collateral or borrow less.";
  if (/Trove is active|TroveIsActive/i.test(m)) return "You already have a trove. Borrow from it instead of opening a new one.";
  if (/Trove does not exist|is closed|not active/i.test(m)) return "You don't have an open trove yet.";
  if (/Signature expired/i.test(m)) return "The signature expired. Try again.";
  if (/Invalid signature/i.test(m)) return "The signature didn't match your wallet. Try again with the same account.";
  if (/insufficient funds|exceeds balance/i.test(m)) return "Not enough BTC in your wallet to cover this and the network fee.";
  if (/INSUFFICIENT_OUTPUT_AMOUNT|slippage/i.test(m)) return "The price moved more than your slippage limit. Get a new quote and try again.";
  return m.split("\n")[0].slice(0, 220);
}

/**
 * Borrow `amount` MUSD from the payer's own trove and send it straight to `recipient` — one
 * EIP-712 signature + one transaction through BorrowerOperationsSignatures. No MUSD balance
 * needed: the debt is settled with freshly minted MUSD backed by the payer's BTC.
 */
export async function borrowAndPay(opts: { borrower: string; recipient: string; amount: bigint; position: MezoPosition; onStep?: (s: string) => void }): Promise<Hex> {
  const borrower = getAddress(opts.borrower) as Addr;
  const recipient = getAddress(opts.recipient) as Addr;
  const { amount, position, onStep } = opts;
  if (!position.trove.active) throw new Error("You don't have an open trove yet.");
  const bos = { address: MEZO_PROTOCOL.BorrowerOperationsSignatures, abi: borrowerOperationsSignaturesAbi, chainId: CHAIN_ID } as const;
  const [domain, nonce, block] = await Promise.all([
    readContract(wagmiConfig, { ...bos, functionName: "eip712Domain" }),
    readContract(wagmiConfig, { ...bos, functionName: "getNonce", args: [borrower] }),
    getBlock(wagmiConfig, { chainId: CHAIN_ID }),
  ]);
  const [, name, version, chainId, verifyingContract] = domain;
  const deadline = block.timestamp + 1800n;
  onStep?.("Sign the borrow in your wallet (free, no gas)…");
  const signature = await signTypedData(wagmiConfig, {
    account: borrower,
    domain: { name, version, chainId: Number(chainId), verifyingContract },
    types: WITHDRAW_MUSD_TYPES,
    primaryType: "WithdrawMUSD",
    message: { amount, borrower, recipient, nonce, deadline },
  });
  const [upper, lower] = await hintsFor(afterBorrow(position.trove, position.params, amount).nicr);
  const args = [amount, upper, lower, borrower, recipient, signature, deadline] as const;
  const gas = gasWithFloor(
    await estimate({ ...bos, functionName: "withdrawMUSDWithSignature", args, account: borrower }),
    GAS_FLOORS.troveBorrow,
  );
  onStep?.("Confirm the transaction in your wallet…");
  return writeContract(wagmiConfig, { ...bos, functionName: "withdrawMUSDWithSignature", args, account: borrower, gas });
}

const bo = { address: MEZO_PROTOCOL.BorrowerOperations, abi: borrowerOperationsAbi, chainId: CHAIN_ID } as const;

/** Borrow more MUSD from an open trove into your own wallet. */
export async function borrowToWallet(owner: string, amount: bigint, position: MezoPosition): Promise<Hex> {
  const account = getAddress(owner) as Addr;
  const [upper, lower] = await hintsFor(afterBorrow(position.trove, position.params, amount).nicr);
  const args = [amount, upper, lower] as const;
  const gas = gasWithFloor(await estimate({ ...bo, functionName: "withdrawMUSD", args, account }), GAS_FLOORS.troveAdjust);
  return writeContract(wagmiConfig, { ...bo, functionName: "withdrawMUSD", args, account, gas });
}

/** Add BTC collateral (native value) to an open trove. */
export async function addCollateral(owner: string, value: bigint, position: MezoPosition): Promise<Hex> {
  const account = getAddress(owner) as Addr;
  const [upper, lower] = await hintsFor(afterAddCollateral(position.trove, position.params, value).nicr);
  const args = [upper, lower] as const;
  const gas = gasWithFloor(await estimate({ ...bo, functionName: "addColl", args, account, value }), GAS_FLOORS.troveAdjust);
  return writeContract(wagmiConfig, { ...bo, functionName: "addColl", args, account, value, gas });
}

/** Repay MUSD debt (interest first). */
export async function repayDebt(owner: string, amount: bigint, position: MezoPosition): Promise<Hex> {
  const account = getAddress(owner) as Addr;
  const [upper, lower] = await hintsFor(afterRepay(position.trove, position.params, amount).nicr);
  const args = [amount, upper, lower] as const;
  const gas = gasWithFloor(await estimate({ ...bo, functionName: "repayMUSD", args, account }), GAS_FLOORS.troveAdjust);
  return writeContract(wagmiConfig, { ...bo, functionName: "repayMUSD", args, account, gas });
}

/** Open a trove: lock `collateral` BTC, receive `amount` MUSD. */
export async function openTrove(owner: string, amount: bigint, collateral: bigint, position: MezoPosition): Promise<Hex> {
  const account = getAddress(owner) as Addr;
  const q = openTroveQuote(amount, position.params, position.params.mcr);
  const [upper, lower] = await hintsFor((collateral * 10n ** 20n) / q.totalDebt);
  const args = [amount, upper, lower] as const;
  const gas = gasWithFloor(await estimate({ ...bo, functionName: "openTrove", args, account, value: collateral }), GAS_FLOORS.troveOpen);
  return writeContract(wagmiConfig, { ...bo, functionName: "openTrove", args, account, value: collateral, gas });
}

/* ------------------------------------------------------------------ Mezo Pools swaps */

const route = (token: SwapTokenId) => [{ from: SWAP_TOKENS[token].address, to: MUSD.address, stable: false, factory: MEZO_POOLS.factory }] as const;

/** MUSD out for `amountIn` of BTC/MEZO at the pool's current price (fees included). */
export async function quoteSwap(token: SwapTokenId, amountIn: bigint): Promise<bigint> {
  if (amountIn <= 0n) return 0n;
  const out = await pc().readContract({ address: MEZO_POOLS.router, abi: mezoRouterAbi, functionName: "getAmountsOut", args: [amountIn, [...route(token)]] });
  return out[out.length - 1];
}

/** Smallest input (approximately) that returns at least `musdOut`. */
export async function quoteInputFor(token: SwapTokenId, musdOut: bigint): Promise<bigint> {
  const probe = SWAP_TOKENS[token].isGas ? 10n ** 14n : 10n ** 18n; // 0.0001 BTC / 1 MEZO
  const unitOut = await quoteSwap(token, probe);
  if (unitOut === 0n) throw new Error("No liquidity for this swap right now.");
  let amountIn = (musdOut * probe) / unitOut + 1n;
  for (let i = 0; i < 4; i++) {
    const out = await quoteSwap(token, amountIn);
    if (out >= musdOut) return amountIn;
    // price impact: scale up by the shortfall plus 0.5%
    amountIn = (amountIn * musdOut * 1005n) / (out * 1000n) + 1n;
  }
  return amountIn;
}

/** Swap BTC or MEZO for MUSD: approve the exact amount if needed, then swap. Returns the swap tx. */
export async function swapToMusd(opts: { owner: string; token: SwapTokenId; amountIn: bigint; minOut: bigint; onStep?: (s: string) => void }): Promise<Hex> {
  const account = getAddress(opts.owner) as Addr;
  const t = SWAP_TOKENS[opts.token];
  const allowance = await readContract(wagmiConfig, { address: t.address, abi: erc20Abi, functionName: "allowance", args: [account, MEZO_POOLS.router], chainId: CHAIN_ID });
  if (allowance < opts.amountIn) {
    opts.onStep?.(`Approve ${t.symbol} for Mezo Pools (exact amount)…`);
    const args = [MEZO_POOLS.router, opts.amountIn] as const;
    const gas = gasWithFloor(await estimate({ address: t.address, abi: erc20Abi, functionName: "approve", args, account }), GAS_FLOORS.erc20Approve);
    const hash = await writeContract(wagmiConfig, { address: t.address, abi: erc20Abi, functionName: "approve", args, account, chainId: CHAIN_ID, gas });
    opts.onStep?.("Waiting for the approval to confirm…");
    const rc = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: CHAIN_ID, retryCount: 30, pollingInterval: 2000 });
    if (rc.status !== "success") throw new Error("The approval transaction reverted.");
  }
  const block = await getBlock(wagmiConfig, { chainId: CHAIN_ID });
  const args = [opts.amountIn, opts.minOut, [...route(opts.token)], account, block.timestamp + 1200n] as const;
  const gas = gasWithFloor(
    await estimate({ address: MEZO_POOLS.router, abi: mezoRouterAbi, functionName: "swapExactTokensForTokens", args, account }),
    GAS_FLOORS.swap,
  );
  opts.onStep?.("Confirm the swap in your wallet…");
  return writeContract(wagmiConfig, { address: MEZO_POOLS.router, abi: mezoRouterAbi, functionName: "swapExactTokensForTokens", args, account, chainId: CHAIN_ID, gas });
}

export async function waitForSuccess(hash: Hex) {
  const rc = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: CHAIN_ID, retryCount: 60, pollingInterval: 2000, timeout: 180_000 });
  if (rc.status !== "success") throw new Error("The transaction reverted on-chain. Nothing changed.");
  return rc;
}
