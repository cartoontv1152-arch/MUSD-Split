import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

/**
 * Hardhat config for MUSDSplitSettlement.
 *
 * NOTE: no private keys live here. Deployment is done by `scripts/deploy.ts`
 * (viem), which reads the deployer key at runtime from DEPLOYER_ENV_FILE.
 * The `mezoTestnet` network entry exists only for Blockscout verification
 * and intentionally has `accounts: []`.
 */
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "london",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    mezoTestnet: {
      url: "https://rpc.test.mezo.org",
      chainId: 31611,
      accounts: [],
    },
  },
  etherscan: {
    apiKey: { mezoTestnet: "empty" },
    customChains: [
      {
        network: "mezoTestnet",
        chainId: 31611,
        urls: {
          apiURL: "https://api.explorer.test.mezo.org/api",
          browserURL: "https://explorer.test.mezo.org",
        },
      },
    ],
  },
  sourcify: { enabled: false },
};

export default config;
