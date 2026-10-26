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

/** Reference addresses of the MUSD protocol on testnet (shown on the Help page). */
export const MEZO_PROTOCOL_TESTNET = {
  BorrowerOperations: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5",
  TroveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
  PriceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
  StabilityPool: "0x1CCA7E410eE41739792eA0A24e00349Dd247680e",
} as const;
