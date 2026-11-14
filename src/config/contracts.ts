import { parseAbi } from "viem";
import { MUSD_SPLIT_SETTLEMENT_DEPLOYMENT, musdSplitSettlementAbi } from "./abis/musdSplitSettlement";

/**
 * Contract registry. Every address in the app comes from here.
 *
 * MUSD (Mezo USD) on Mezo testnet: verified against the official mezo-org/musd repo
 * (solidity/deployments/matsnet/MUSD.json) and https://mezo.org/docs/users/resources/contracts-reference.
 * Name "Mezo USD", symbol MUSD, 18 decimals, EIP-2612 permit.
 */
export const MUSD = {
  address: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503" as const,
  symbol: "MUSD",
  name: "Mezo USD",
  decimals: 18,
  /** Mainnet MUSD — shown for reference only; this app runs on testnet. */
  mainnetAddress: "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186" as const,
};

/** Minimal MUSD ABI (subset of the official ABI: ERC-20 + EIP-2612 + EIP-5267). */
export const musdAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address recipient, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transferFrom(address sender, address recipient, uint256 amount) returns (bool)",
  "function nonces(address owner) view returns (uint256)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
  "function permit(address owner, address spender, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
]);

/**
 * MUSDSplitSettlement — our minimal, non-custodial settlement rail (no owner, holds no funds).
 * settle / settleWithPermit / settleBatch / settleBatchWithPermit pull MUSD straight from the
 * payer to the creditor and emit Settled(settlementId, from, to, amount); a payer-scoped
 * settlement id can only ever be used once on-chain.
 */
export const SETTLEMENT_CONTRACT = {
  address: MUSD_SPLIT_SETTLEMENT_DEPLOYMENT.address,
  deployTx: MUSD_SPLIT_SETTLEMENT_DEPLOYMENT.txHash,
  deployBlock: MUSD_SPLIT_SETTLEMENT_DEPLOYMENT.blockNumber,
  abi: musdSplitSettlementAbi,
  maxBatch: 32,
};

/**
 * Mezo Pools (Aerodrome/Velodrome-style AMM) on Mezo testnet. Verified on-chain 2026-11-14:
 * router.defaultFactory() == factory; volatile BTC/MUSD pool 0xd16A…6AA9 and MEZO/MUSD pool
 * 0x8eb8…B342 exist with liquidity; there are no stable pools for these pairs.
 *
 * BTC is Mezo's native gas token *and* an ERC-20 precompile at 0x7b7C…0000 — swapping it needs
 * a normal `approve` to the router, and the wallet must keep some BTC back to pay gas.
 */
export const MEZO_POOLS = {
  router: "0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9" as const,
  factory: "0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A" as const,
};

export type SwapTokenId = "BTC" | "MEZO";
export const SWAP_TOKENS: Record<SwapTokenId, { id: SwapTokenId; address: `0x${string}`; symbol: string; name: string; decimals: number; isGas: boolean }> = {
  BTC: { id: "BTC", address: "0x7b7C000000000000000000000000000000000000", symbol: "BTC", name: "Bitcoin", decimals: 18, isGas: true },
  MEZO: { id: "MEZO", address: "0x7B7c000000000000000000000000000000000001", symbol: "MEZO", name: "Mezo", decimals: 18, isGas: false },
};

/** BTC kept back for gas when a user swaps "max" BTC. */
export const BTC_GAS_RESERVE = 20_000_000_000_000n; // 0.00002 BTC

export const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export const mezoRouterAbi = parseAbi([
  "struct Route { address from; address to; bool stable; address factory; }",
  "function defaultFactory() view returns (address)",
  "function getAmountsOut(uint256 amountIn, Route[] routes) view returns (uint256[] amounts)",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, Route[] routes, address to, uint256 deadline) returns (uint256[] amounts)",
]);

/** Reference addresses of the MUSD protocol on testnet (shown on the Help page). */
export const MEZO_PROTOCOL_TESTNET = {
  BorrowerOperations: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5",
  TroveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
  PriceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
  StabilityPool: "0x1CCA7E410eE41739792eA0A24e00349Dd247680e",
} as const;
