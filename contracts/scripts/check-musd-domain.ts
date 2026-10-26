/**
 * Read-only check of the live MUSD token on Mezo testnet: confirms the
 * EIP-2612 / EIP-712 surface used by settleWithPermit.
 *   npx tsx scripts/check-musd-domain.ts
 */
import { createPublicClient, http, parseAbi } from "viem";
import { MUSD_ADDRESS, mezoTestnet } from "./chain";

const abi = parseAbi([
  "function eip712Domain() view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

async function main() {
  const client = createPublicClient({ chain: mezoTestnet, transport: http() });
  const domain = await client.readContract({ address: MUSD_ADDRESS, abi, functionName: "eip712Domain" });
  const separator = await client.readContract({ address: MUSD_ADDRESS, abi, functionName: "DOMAIN_SEPARATOR" });
  const name = await client.readContract({ address: MUSD_ADDRESS, abi, functionName: "name" });
  const symbol = await client.readContract({ address: MUSD_ADDRESS, abi, functionName: "symbol" });
  const decimals = await client.readContract({ address: MUSD_ADDRESS, abi, functionName: "decimals" });
  console.log(
    JSON.stringify(
      {
        chainId: await client.getChainId(),
        token: { address: MUSD_ADDRESS, name, symbol, decimals },
        eip712Domain: {
          name: domain[1],
          version: domain[2],
          chainId: domain[3].toString(),
          verifyingContract: domain[4],
        },
        DOMAIN_SEPARATOR: separator,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
