/**
 * Verify the deployed MUSDSplitSettlement on Mezo testnet Blockscout.
 *   npm run verify:testnet
 * Uses no keys: the mezoTestnet network in hardhat.config.ts has accounts: [].
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import hre from "hardhat";

async function main() {
  const d = JSON.parse(readFileSync(path.resolve(__dirname, "../deployments/mezo-testnet.json"), "utf8"));
  await hre.run("verify:verify", {
    address: d.address,
    constructorArguments: [d.musd],
    contract: "contracts/MUSDSplitSettlement.sol:MUSDSplitSettlement",
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
