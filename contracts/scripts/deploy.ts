/**
 * Deploy MUSDSplitSettlement to Mezo testnet (chain 31611).
 *
 *   npm run compile && npm run deploy:testnet
 *
 * Security: the deployer key is read AT RUNTIME from the file named by
 * DEPLOYER_ENV_FILE (default C:\Users\nikku\Desktop\.env.txt, line
 * `PRIVATE_KEY=<hex>`). It is never printed, logged or written anywhere.
 *
 * Gas: Mezo testnet enforces the EIP-7623 calldata floor and the public RPC can
 * return bogus estimates, so we always send an explicit gas limit
 * (max(estimate * 1.3, 1_500_000)).
 *
 * Nonces: other tools may share the deployer, so we use the `pending` nonce and
 * retry (up to 5x with backoff) on nonce / replacement / already-known errors.
 * Transactions are signed locally so the hash is known even if a retry hits
 * "already known".
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  http,
  keccak256,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MUSD_ADDRESS, mezoTestnet } from "./chain";

const ROOT = path.resolve(__dirname, "..");
const ARTIFACT = path.join(ROOT, "artifacts/contracts/MUSDSplitSettlement.sol/MUSDSplitSettlement.json");
const DEPLOYMENT_FILE = path.join(ROOT, "deployments/mezo-testnet.json");
const APP_ABI_FILE = path.resolve(ROOT, "../src/config/abis/musdSplitSettlement.ts");
const GAS_FLOOR = 1_500_000n;

function loadDeployerKey(): Hex {
  const file = process.env.DEPLOYER_ENV_FILE ?? "C:\\Users\\nikku\\Desktop\\.env.txt";
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new Error(`Cannot read deployer env file (DEPLOYER_ENV_FILE). Path: ${file}`);
  }
  const line = raw.split(/\r?\n/).find((l) => l.trim().startsWith("PRIVATE_KEY="));
  if (!line) throw new Error("PRIVATE_KEY line not found in deployer env file");
  let key = line.trim().slice("PRIVATE_KEY=".length).trim().replace(/^["']|["']$/g, "");
  if (!key.startsWith("0x")) key = `0x${key}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("PRIVATE_KEY has an unexpected format (value not shown)");
  return key as Hex;
}

const RETRYABLE = /nonce too low|nonce too high|invalid nonce|replacement (transaction )?underpriced|already known|known transaction|nonce has already been used/i;

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (existsSync(DEPLOYMENT_FILE)) {
    const existing = JSON.parse(readFileSync(DEPLOYMENT_FILE, "utf8"));
    console.log(`Already deployed at ${existing.address} (tx ${existing.txHash}). Delete ${DEPLOYMENT_FILE} to redeploy.`);
    return;
  }

  const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8")) as { abi: unknown[]; bytecode: Hex };
  const account = privateKeyToAccount(loadDeployerKey());
  const transport = http(mezoTestnet.rpcUrls.default.http[0], { timeout: 30_000, retryCount: 3 });
  const publicClient = createPublicClient({ chain: mezoTestnet, transport });
  const walletClient = createWalletClient({ chain: mezoTestnet, transport, account });

  const chainId = await publicClient.getChainId();
  if (chainId !== mezoTestnet.id) throw new Error(`Wrong chain: ${chainId}`);
  console.log(`Deployer: ${account.address}`);
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Deployer BTC balance: ${balance} wei`);

  const data = encodeDeployData({
    abi: artifact.abi as never,
    bytecode: artifact.bytecode,
    args: [MUSD_ADDRESS] as never,
  });

  let estimate = 0n;
  try {
    estimate = await publicClient.estimateGas({ account: account.address, data });
  } catch (e) {
    console.warn("Gas estimate failed, using floor:", (e as Error).message.split("\n")[0]);
  }
  const gas = estimate > 30_000n && (estimate * 13n) / 10n > GAS_FLOOR ? (estimate * 13n) / 10n : GAS_FLOOR;
  console.log(`Gas estimate ${estimate}, sending with gas limit ${gas}`);

  let txHash: Hex | undefined;
  for (let attempt = 1; attempt <= 5 && !txHash; attempt++) {
    const nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
    const request = await walletClient.prepareTransactionRequest({ data, gas, nonce, chain: mezoTestnet });
    const signed = await walletClient.signTransaction(request as never);
    const localHash = keccak256(signed);
    try {
      txHash = await publicClient.sendRawTransaction({ serializedTransaction: signed });
      console.log(`Sent deploy tx ${txHash} (nonce ${nonce}, attempt ${attempt})`);
    } catch (e) {
      const msg = (e as Error).message;
      if (/already known|known transaction/i.test(msg)) {
        txHash = localHash;
        console.log(`Node already knows tx ${txHash}; waiting for it.`);
        break;
      }
      if (!RETRYABLE.test(msg) || attempt === 5) throw e;
      const wait = 1500 * attempt;
      console.warn(`Attempt ${attempt} failed (${msg.split("\n")[0]}); retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
  if (!txHash) throw new Error("Deployment was not sent");

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 180_000 });
  if (receipt.status !== "success" || !receipt.contractAddress) {
    throw new Error(`Deployment failed: status ${receipt.status}`);
  }
  const address = receipt.contractAddress;
  console.log(`Deployed MUSDSplitSettlement at ${address} in block ${receipt.blockNumber} (gas used ${receipt.gasUsed})`);

  // Sanity read (RPC reads can lag a block, so retry briefly).
  let musd: string | undefined;
  for (let i = 0; i < 10; i++) {
    try {
      musd = (await publicClient.readContract({
        address,
        abi: artifact.abi as never,
        functionName: "musd",
      })) as string;
      if (musd) break;
    } catch {
      /* lagging RPC */
    }
    await sleep(1500);
  }
  if (!musd || musd.toLowerCase() !== MUSD_ADDRESS.toLowerCase()) {
    throw new Error(`Sanity check failed: musd() returned ${musd}`);
  }
  console.log(`Sanity check ok: musd() = ${musd}`);

  const buildInfo = { version: "0.8.28", evmVersion: "london", optimizerRuns: 200 };
  const deployment = {
    chainId: mezoTestnet.id,
    contract: "MUSDSplitSettlement",
    address,
    txHash,
    blockNumber: Number(receipt.blockNumber),
    gasUsed: receipt.gasUsed.toString(),
    deployer: account.address,
    musd: MUSD_ADDRESS,
    deployedAt: new Date().toISOString(),
    compiler: buildInfo,
    explorer: {
      address: `https://explorer.test.mezo.org/address/${address}`,
      tx: `https://explorer.test.mezo.org/tx/${txHash}`,
    },
  };
  mkdirSync(path.dirname(DEPLOYMENT_FILE), { recursive: true });
  writeFileSync(DEPLOYMENT_FILE, JSON.stringify(deployment, null, 2) + "\n");
  console.log(`Wrote ${DEPLOYMENT_FILE}`);

  writeAppAbi(artifact.abi, deployment);
}

export function writeAppAbi(
  abi: unknown[],
  d: { address: string; txHash: string; blockNumber: number; deployer: string },
) {
  const content = `// AUTO-GENERATED by contracts/scripts/deploy.ts — do not edit by hand.
// MUSDSplitSettlement: minimal non-custodial MUSD settlement rail (no owner, holds no funds).
// Source: contracts/contracts/MUSDSplitSettlement.sol · Solidity 0.8.28, evm london, optimizer 200 runs.

export const musdSplitSettlementAbi = ${JSON.stringify(abi, null, 2)} as const;

export const MUSD_SPLIT_SETTLEMENT_DEPLOYMENT = {
  chainId: 31611,
  address: "${d.address}" as const,
  txHash: "${d.txHash}" as const,
  blockNumber: ${d.blockNumber},
  deployer: "${d.deployer}" as const,
} as const;
`;
  mkdirSync(path.dirname(APP_ABI_FILE), { recursive: true });
  writeFileSync(APP_ABI_FILE, content);
  console.log(`Wrote ${APP_ABI_FILE}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error((e as Error).message ?? e);
    process.exit(1);
  });
}
