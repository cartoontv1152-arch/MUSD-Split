"use client";

import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { mezoTestnet } from "@/config/chains";

/**
 * Injected wallets only. EIP-6963 multi-injected discovery is on (default), so MetaMask, Rabby,
 * OKX, Brave… each appear as their own connector automatically — no WalletConnect project id.
 */
export const wagmiConfig = createConfig({
  chains: [mezoTestnet],
  connectors: [injected({ shimDisconnect: true })],
  multiInjectedProviderDiscovery: true,
  transports: { [mezoTestnet.id]: http(mezoTestnet.rpcUrls.default.http[0], { retryCount: 2 }) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
