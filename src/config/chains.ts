import { defineChain } from "viem";

/**
 * Mezo testnet — verified live on 2026-10-26 (chain id 31611 / 0x7b7b).
 * Source: https://mezo.org/docs/developers/getting-started/
 */
export const mezoTestnet = defineChain({
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://rpc.test.mezo.org"],
      webSocket: ["wss://rpc-ws.test.mezo.org"],
    },
  },
  blockExplorers: {
    default: {
      name: "Mezo Explorer",
      url: "https://explorer.test.mezo.org",
      apiUrl: "https://api.explorer.test.mezo.org/api",
    },
  },
  testnet: true,
});

export const SUPPORTED_CHAIN = mezoTestnet;
export const CHAIN_ID = mezoTestnet.id;
export const EXPLORER_URL = "https://explorer.test.mezo.org";
export const EXPLORER_API_V2 = "https://api.explorer.test.mezo.org/api/v2";
export const FAUCET_URL = "https://faucet.test.mezo.org/";
export const MEZO_DOCS_URL = "https://mezo.org/docs/developers/getting-started/";
export const MEZO_TESTNET_APP_URL = "https://testnet.mezo.org";

/** Server may override the RPC (e.g. a private endpoint); the browser always uses the public one. */
export function rpcUrl(): string {
  return (typeof process !== "undefined" && process.env.MEZO_RPC_URL) || mezoTestnet.rpcUrls.default.http[0];
}

export const explorerTxUrl = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const explorerAddressUrl = (address: string) => `${EXPLORER_URL}/address/${address}`;
export const explorerTokenUrl = (address: string) => `${EXPLORER_URL}/token/${address}`;

/**
 * Gas policy. Mezo testnet enforces the EIP-7623 calldata floor and the public RPC sometimes
 * returns bogus low estimates, so every write passes an explicit gas limit:
 *   gas = max(estimate * 13 / 10, floor), and estimates < 30k for contract calls are discarded.
 * Gas price is ~146 wei, so generous limits cost effectively nothing.
 */
export const GAS_FLOORS = {
  erc20Transfer: 90_000n,
  erc20Approve: 90_000n,
  settle: 250_000n,
  settleWithPermit: 300_000n,
  settleBatchBase: 250_000n,
  settleBatchPerItem: 90_000n,
} as const;

export function gasWithFloor(estimate: bigint | undefined | null, floor: bigint): bigint {
  if (!estimate || estimate < 30_000n) return floor;
  const padded = (estimate * 13n) / 10n;
  return padded > floor ? padded : floor;
}
