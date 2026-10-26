import { defineChain } from "viem";

/** Mezo testnet (matsnet). Verified 2026-10-26: chainId 31611 (0x7b7b). */
export const mezoTestnet = defineChain({
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.test.mezo.org"] } },
  blockExplorers: { default: { name: "Mezo Explorer", url: "https://explorer.test.mezo.org" } },
  testnet: true,
});

/** Official MUSD on Mezo testnet (mezo-org/musd deployments/matsnet/MUSD.json). */
export const MUSD_ADDRESS = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503" as const;
