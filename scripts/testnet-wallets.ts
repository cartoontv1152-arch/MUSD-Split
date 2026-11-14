/**
 * Test-wallet helper for the live Mezo testnet e2e run.
 *
 *   npx tsx scripts/testnet-wallets.ts status   # addresses + BTC/MUSD balances
 *   npx tsx scripts/testnet-wallets.ts fund     # top every test wallet up from the deployer
 *
 * - Test wallets live in E2E_WALLETS_FILE (default: ./.env.e2e-wallets.json, gitignored via `.env*`).
 *   The file is created with three fresh keys (alice / bob / charlie) when missing.
 * - The deployer key is read at runtime from DEPLOYER_ENV_FILE (line `PRIVATE_KEY=…`).
 * - If the deployer is short of MUSD it swaps BTC -> MUSD through Mezo Pools first
 *   (approve the BTC ERC-20 precompile + router.swapExactTokensForTokens) — the same path the app uses.
 * Keys are never printed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, formatUnits, getAddress, http, parseUnits, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { mezoTestnet } from "../src/config/chains";
import { MEZO_POOLS, MUSD, SWAP_TOKENS, erc20Abi, mezoRouterAbi, musdAbi } from "../src/config/contracts";

export const DEFAULT_WALLETS_FILE = path.resolve(__dirname, "../.env.e2e-wallets.json");
const WALLETS = process.env.E2E_WALLETS_FILE ?? DEFAULT_WALLETS_FILE;
const ROLES = ["alice", "bob", "charlie"] as const;
const U = (n: string) => parseUnits(n, 18);

/** Targets per wallet; the e2e needs bob >= 30 MUSD and charlie >= 6 MUSD. */
const TARGET: Record<(typeof ROLES)[number], { btc: bigint; musd: bigint }> = {
  alice: { btc: U("0.002"), musd: U("5") },
  bob: { btc: U("0.002"), musd: U("40") },
  charlie: { btc: U("0.002"), musd: U("15") },
};

const rpc = process.env.MEZO_RPC_URL ?? mezoTestnet.rpcUrls.default.http[0];
const pc = createPublicClient({ chain: mezoTestnet, transport: http(rpc, { retryCount: 3 }) });

function loadDeployerKey(): Hex {
  const file = process.env.DEPLOYER_ENV_FILE ?? path.resolve(__dirname, "../.env.deployer");
  const raw = readFileSync(file, "utf8");
  const line = raw.split(/\r?\n/).find((l) => l.trim().startsWith("PRIVATE_KEY="));
  if (!line) throw new Error("PRIVATE_KEY line not found in deployer env file");
  let key = line.trim().slice("PRIVATE_KEY=".length).trim().replace(/^["']|["']$/g, "");
  if (!key.startsWith("0x")) key = `0x${key}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("PRIVATE_KEY has an unexpected format (value not shown)");
  return key as Hex;
}

type WalletRow = { role: (typeof ROLES)[number]; address: string; privateKey: string };
export function loadWallets(): WalletRow[] {
  if (!existsSync(WALLETS)) {
    const split = ROLES.map((role) => {
      const privateKey = generatePrivateKey();
      return { role, address: privateKeyToAccount(privateKey).address, privateKey };
    });
    writeFileSync(WALLETS, JSON.stringify({ split }, null, 2), { encoding: "utf8", mode: 0o600 });
    console.log(`created ${split.length} new test wallets in ${WALLETS}`);
  }
  return (JSON.parse(readFileSync(WALLETS, "utf8")) as { split: WalletRow[] }).split;
}

const fmt = (v: bigint, d = 4) => Number(formatUnits(v, 18)).toFixed(d);
const musdOf = (a: string) => pc.readContract({ address: MUSD.address, abi: musdAbi, functionName: "balanceOf", args: [getAddress(a)] });

async function withGas(estimate: () => Promise<bigint>, floor: bigint) {
  try {
    const est = await estimate();
    const padded = (est * 13n) / 10n;
    return padded > floor ? padded : floor;
  } catch {
    return floor;
  }
}

async function status() {
  const ws = loadWallets();
  const deployer = privateKeyToAccount(loadDeployerKey());
  const rows = [{ role: "deployer", address: deployer.address }, ...ws];
  for (const w of rows) {
    const [btc, musd] = await Promise.all([pc.getBalance({ address: getAddress(w.address) }), musdOf(w.address)]);
    console.log(`${w.role.padEnd(9)} ${w.address}  BTC ${fmt(btc, 6)}  MUSD ${fmt(musd, 2)}`);
  }
}

async function fund() {
  const ws = loadWallets();
  const account = privateKeyToAccount(loadDeployerKey());
  const wallet = createWalletClient({ account, chain: mezoTestnet, transport: http(rpc) });
  const wait = async (hash: Hex, label: string) => {
    const r = await pc.waitForTransactionReceipt({ hash, timeout: 180_000, pollingInterval: 2_000 });
    console.log(`  ${r.status === "success" ? "ok " : "FAIL"} ${label}  ${mezoTestnet.blockExplorers.default.url}/tx/${hash}`);
    if (r.status !== "success") throw new Error(`${label} reverted`);
    return r;
  };

  // How much MUSD do we need to hand out?
  let needMusd = 0n;
  for (const w of ws) {
    const have = await musdOf(w.address);
    if (have < TARGET[w.role].musd) needMusd += TARGET[w.role].musd - have;
  }
  const deployerMusd = await musdOf(account.address);
  if (needMusd > deployerMusd) {
    const short = needMusd - deployerMusd + U("5");
    const routes = [{ from: SWAP_TOKENS.BTC.address, to: MUSD.address, stable: false, factory: MEZO_POOLS.factory }] as const;
    // size the BTC input from the current price (+3% headroom)
    const unit = await pc.readContract({ address: MEZO_POOLS.router, abi: mezoRouterAbi, functionName: "getAmountsOut", args: [U("0.0001"), [...routes]] });
    const btcIn = (short * U("0.0001") * 103n) / (unit[1] * 100n);
    const quote = await pc.readContract({ address: MEZO_POOLS.router, abi: mezoRouterAbi, functionName: "getAmountsOut", args: [btcIn, [...routes]] });
    const minOut = (quote[1] * 99n) / 100n;
    console.log(`deployer short ${fmt(short, 2)} MUSD -> swapping ${fmt(btcIn, 6)} BTC for ~${fmt(quote[1], 2)} MUSD via Mezo Pools`);
    const allowance = await pc.readContract({ address: SWAP_TOKENS.BTC.address, abi: erc20Abi, functionName: "allowance", args: [account.address, MEZO_POOLS.router] });
    if (allowance < btcIn) {
      const gas = await withGas(() => pc.estimateContractGas({ address: SWAP_TOKENS.BTC.address, abi: erc20Abi, functionName: "approve", args: [MEZO_POOLS.router, btcIn], account }), 80_000n);
      await wait(await wallet.writeContract({ address: SWAP_TOKENS.BTC.address, abi: erc20Abi, functionName: "approve", args: [MEZO_POOLS.router, btcIn], gas }), "approve BTC -> router");
    }
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
    const gas = await withGas(
      () => pc.estimateContractGas({ address: MEZO_POOLS.router, abi: mezoRouterAbi, functionName: "swapExactTokensForTokens", args: [btcIn, minOut, [...routes], account.address, deadline], account }),
      400_000n,
    );
    await wait(await wallet.writeContract({ address: MEZO_POOLS.router, abi: mezoRouterAbi, functionName: "swapExactTokensForTokens", args: [btcIn, minOut, [...routes], account.address, deadline], gas }), "swap BTC -> MUSD");
  }

  for (const w of ws) {
    const to = getAddress(w.address);
    const [btc, musd] = await Promise.all([pc.getBalance({ address: to }), musdOf(to)]);
    if (btc < TARGET[w.role].btc) {
      const value = TARGET[w.role].btc - btc;
      await wait(await wallet.sendTransaction({ to, value, gas: 30_000n }), `send ${fmt(value, 6)} BTC -> ${w.role}`);
    }
    if (musd < TARGET[w.role].musd) {
      const amount = TARGET[w.role].musd - musd;
      await wait(await wallet.writeContract({ address: MUSD.address, abi: musdAbi, functionName: "transfer", args: [to, amount], gas: 120_000n }), `send ${fmt(amount, 2)} MUSD -> ${w.role}`);
    }
  }
  await status();
}

const cmd = process.argv[2] ?? "status";
(cmd === "fund" ? fund() : status()).catch((e) => {
  console.error(String(e?.shortMessage ?? e?.message ?? e).split("\n")[0]);
  process.exit(1);
});
