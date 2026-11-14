/**
 * Live e2e for the Mezo-native rails, with REAL Mezo testnet transactions:
 *
 *   BASE_URL=http://localhost:3000 npx tsx scripts/e2e-mezo.ts
 *
 * 1. "Borrow against BTC and pay": Dave (a wallet with an open MUSD trove — key file DAVE_ENV_FILE,
 *    default the original deployer) owes Alice 10 MUSD and settles it by signing WithdrawMUSD(amount, Dave, Alice)
 *    and calling BorrowerOperationsSignatures.withdrawMUSDWithSignature. MUSD is minted from Dave's
 *    trove straight to Alice; the server verifies TroveUpdated(Dave) + Transfer(0x0 -> Alice, 10).
 *    Negative: a borrow minted to Dave himself is rejected for the same intent.
 * 2. Mezo Pools: Charlie swaps BTC -> MUSD through the router (approve BTC precompile + swap).
 *
 * Test wallets: E2E_WALLETS_FILE (default ./.env.e2e-wallets.json). Keys are never printed.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, formatUnits, getAddress, http, parseUnits, type Hex, type PrivateKeyAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { mezoTestnet } from "../src/config/chains";
import { MEZO_POOLS, MUSD, SWAP_TOKENS, erc20Abi, mezoRouterAbi, musdAbi } from "../src/config/contracts";
import { MEZO_PROTOCOL, WITHDRAW_MUSD_TYPES, borrowerOperationsSignaturesAbi, priceFeedAbi, sortedTrovesAbi, troveManagerAbi } from "../src/config/mezo";
import { afterBorrow, collateralRatio } from "../src/lib/mezo/trove-math";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const WALLETS = process.env.E2E_WALLETS_FILE ?? path.resolve(__dirname, "../.env.e2e-wallets.json");
const U = (n: string) => parseUnits(n, 18);
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const rpc = mezoTestnet.rpcUrls.default.http[0];
const pc = createPublicClient({ chain: mezoTestnet, transport: http(rpc, { retryCount: 3 }) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function deployerKey(): Hex {
  const raw = readFileSync(process.env.DAVE_ENV_FILE ?? path.resolve(__dirname, "../.env.deployer"), "utf8");
  const line = raw.split(/\r?\n/).find((l) => l.trim().startsWith("PRIVATE_KEY="));
  if (!line) throw new Error("PRIVATE_KEY line not found");
  let k = line.trim().slice(12).trim().replace(/^["']|["']$/g, "");
  if (!k.startsWith("0x")) k = `0x${k}`;
  return k as Hex;
}
const wallets = JSON.parse(readFileSync(WALLETS, "utf8")).split as Array<{ role: string; privateKey: Hex }>;
const acct = (role: string) => privateKeyToAccount(wallets.find((w) => w.role === role)!.privateKey);

const results: Array<{ step: string; ok: boolean }> = [];
const txs: Record<string, string> = {};
function check(step: string, cond: unknown, detail?: string) {
  results.push({ step, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${step}${detail ? ` — ${detail}` : ""}`);
  if (!cond) throw new Error(`Assertion failed: ${step}`);
}

class User {
  cookie = "";
  wallet;
  constructor(public name: string, public account: PrivateKeyAccount) {
    this.wallet = createWalletClient({ account, chain: mezoTestnet, transport: http(rpc) });
  }
  get address() {
    return this.account.address.toLowerCase();
  }
  async req<T = Record<string, unknown>>(method: string, p: string, body?: unknown): Promise<{ status: number; data: T }> {
    const res = await fetch(BASE + p, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), origin: BASE },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const m = /musd_split_session=([^;]*)/.exec(res.headers.get("set-cookie") ?? "");
    if (m) this.cookie = `musd_split_session=${m[1]}`;
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, data: data as T };
  }
  async login() {
    const { data } = await this.req<{ nonce: string }>("GET", "/api/auth/nonce");
    const url = new URL(BASE);
    const message = createSiweMessage({
      domain: url.host,
      address: this.account.address,
      statement: "Sign in to MUSD Split (e2e).",
      uri: url.origin,
      version: "1",
      chainId: mezoTestnet.id,
      nonce: data.nonce,
      issuedAt: new Date(),
      expirationTime: new Date(Date.now() + 600_000),
    });
    const signature = await this.account.signMessage({ message });
    const r = await this.req<{ address: string }>("POST", "/api/auth/verify", { message, signature });
    if (r.status !== 200) throw new Error(`${this.name} login failed: ${JSON.stringify(r.data)}`);
  }
  musd() {
    return pc.readContract({ address: MUSD.address, abi: musdAbi, functionName: "balanceOf", args: [this.account.address] });
  }
}

async function trove(a: string) {
  const [price, t, e] = await Promise.all([
    pc.readContract({ address: MEZO_PROTOCOL.PriceFeed, abi: priceFeedAbi, functionName: "fetchPrice" }),
    pc.readContract({ address: MEZO_PROTOCOL.TroveManager, abi: troveManagerAbi, functionName: "Troves", args: [getAddress(a)] }),
    pc.readContract({ address: MEZO_PROTOCOL.TroveManager, abi: troveManagerAbi, functionName: "getEntireDebtAndColl", args: [getAddress(a)] }),
  ]);
  return { price, status: t[4], coll: e[0], principal: e[1], interest: e[2], maxBorrowingCapacity: t[7] };
}

/** Dave signs WithdrawMUSD and sends withdrawMUSDWithSignature: MUSD minted from his trove to `recipient`. */
async function borrowAndPay(u: User, recipient: string, amount: bigint, label: string): Promise<Hex> {
  const bos = { address: MEZO_PROTOCOL.BorrowerOperationsSignatures, abi: borrowerOperationsSignaturesAbi } as const;
  const [domain, nonce, block, t] = await Promise.all([
    pc.readContract({ ...bos, functionName: "eip712Domain" }),
    pc.readContract({ ...bos, functionName: "getNonce", args: [u.account.address] }),
    pc.getBlock(),
    trove(u.address),
  ]);
  const deadline = block.timestamp + 1800n;
  const signature = await u.account.signTypedData({
    domain: { name: domain[1], version: domain[2], chainId: Number(domain[3]), verifyingContract: domain[4] },
    types: WITHDRAW_MUSD_TYPES,
    primaryType: "WithdrawMUSD",
    message: { amount, borrower: u.account.address, recipient: getAddress(recipient), nonce, deadline },
  });
  const params = { price: t.price, mcr: U("1.1"), ccr: U("1.5"), minNetDebt: 0n, gasCompensation: 0n, borrowingRate: U("0.001") };
  const nicr = afterBorrow(t, params, amount).nicr;
  const [upper, lower] = await pc.readContract({ address: MEZO_PROTOCOL.SortedTroves, abi: sortedTrovesAbi, functionName: "findInsertPosition", args: [nicr, ZERO, ZERO] });
  const args = [amount, upper, lower, u.account.address, getAddress(recipient), signature, deadline] as const;
  const est = await pc.estimateContractGas({ ...bos, functionName: "withdrawMUSDWithSignature", args, account: u.account });
  const gas = (est * 13n) / 10n > 1_200_000n ? (est * 13n) / 10n : 1_200_000n;
  console.log(`      gas estimate withdrawMUSDWithSignature: ${est}`);
  const hash = await u.wallet.writeContract({ ...bos, functionName: "withdrawMUSDWithSignature", args, gas });
  txs[label] = hash;
  console.log(`      tx ${label}: ${hash}`);
  return hash;
}

async function verifyUntil(u: User, sid: string, want: string[], max = 40) {
  let s: { status: string; failureCode?: string } = { status: "?" };
  for (let i = 0; i < max; i++) {
    const r = await u.req<{ settlement: typeof s }>("POST", `/api/settlements/${sid}/verify`);
    s = r.data.settlement;
    if (want.includes(s.status)) return s;
    await sleep(3000);
  }
  return s;
}
const net = (b: { ledger: { nets: Record<string, string> } }, a: string) => BigInt(b.ledger.nets[a] ?? "0");

async function main() {
  console.log(`MUSD Split Mezo e2e against ${BASE}\n`);
  const alice = new User("alice", acct("alice"));
  const charlie = new User("charlie", acct("charlie"));
  const dave = new User("dave", privateKeyToAccount(deployerKey()));
  for (const u of [alice, dave, charlie]) await u.login();
  check("SIWE login alice, dave (trove owner), charlie", true);
  await dave.req("PATCH", "/api/me", { displayName: "Dave (trove e2e)" });

  const t0 = await trove(dave.address);
  check("Dave has an active Mezo trove", t0.status === 1, `coll ${formatUnits(t0.coll, 18)} BTC, debt ${formatUnits(t0.principal + t0.interest, 18)} MUSD`);

  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const g = await alice.req<{ id: string }>("POST", "/api/groups", { name: `E2E Mezo trove ${stamp}`, description: "Borrow-against-BTC settlement run", icon: "home", color: "violet" });
  const gid = g.data.id;
  const inv = await alice.req<{ invite: { token: string } }>("POST", `/api/groups/${gid}/invites`, { expiresInHours: 2, maxUses: 2 });
  const j = await dave.req<{ groupId: string }>("POST", `/api/invites/${inv.data.invite.token}/accept`);
  check("Alice creates a group, Dave joins by invite", g.status === 201 && j.data.groupId === gid);
  const exp = await alice.req("POST", `/api/groups/${gid}/expenses`, {
    title: "Electricity bill",
    amount: "20",
    payer: alice.address,
    category: "utilities",
    date: new Date().toISOString().slice(0, 10),
    split: { method: "equal", participants: [alice.address, dave.address] },
  });
  let b = (await alice.req<{ ledger: { nets: Record<string, string> } }>("GET", `/api/groups/${gid}`)).data;
  check("20 MUSD split equally: Dave owes Alice 10", exp.status === 201 && net(b, dave.address) === -U("10"));

  // NEG: borrowing to yourself doesn't settle a debt to Alice
  const bad = await dave.req<{ settlement: { id: string } }>("POST", `/api/groups/${gid}/settlements`, { to: alice.address, amount: "10", method: "trove" });
  check("trove-funded payment intent recorded (method=trove)", bad.status === 201, bad.data.settlement?.id);
  const selfHash = await borrowAndPay(dave, dave.address, U("1"), "dave_borrows_1_to_himself");
  await pc.waitForTransactionReceipt({ hash: selfHash, timeout: 180_000, pollingInterval: 2000 });
  await dave.req("POST", `/api/settlements/${bad.data.settlement.id}/submit`, { txHash: selfHash });
  const badFin = await verifyUntil(dave, bad.data.settlement.id, ["confirmed", "failed", "rejected"]);
  check("NEG borrow minted to the payer (not the creditor) is rejected", badFin.status === "rejected" && badFin.failureCode === "RECIPIENT_MISMATCH", badFin.failureCode);
  b = (await alice.req<typeof b>("GET", `/api/groups/${gid}`)).data;
  check("NEG Dave still owes 10 after the rejected attempt", net(b, dave.address) === -U("10"));

  // Borrow against BTC and pay Alice in one transaction
  const aliceBefore = await alice.musd();
  const tBefore = await trove(dave.address);
  const intent = await dave.req<{ settlement: { id: string; status: string } }>("POST", `/api/groups/${gid}/settlements`, { to: alice.address, amount: "10", method: "trove" });
  check("new trove intent (no money moved yet)", intent.status === 201 && intent.data.settlement.status === "created");
  const hash = await borrowAndPay(dave, alice.address, U("10"), "dave_borrows_10_against_btc_pays_alice");
  const sub = await dave.req<{ settlement: { status: string } }>("POST", `/api/settlements/${intent.data.settlement.id}/submit`, { txHash: hash });
  check("tx hash persisted immediately", sub.status === 200, sub.data.settlement?.status);
  await pc.waitForTransactionReceipt({ hash, timeout: 180_000, pollingInterval: 2000 });
  const fin = await verifyUntil(dave, intent.data.settlement.id, ["confirmed", "failed", "rejected"]);
  check("server verifies TroveUpdated(Dave) + MUSD mint to Alice -> confirmed", fin.status === "confirmed", fin.status + (fin.failureCode ? ` ${fin.failureCode}` : ""));
  const aliceAfter = await alice.musd();
  check("Alice received exactly 10 MUSD, freshly minted", aliceAfter - aliceBefore === U("10"));
  const tAfter = await trove(dave.address);
  const added = tAfter.principal - tBefore.principal;
  check("Dave's trove debt grew by 10 MUSD + 0.1% fee (10.01)", added === U("10.01"), formatUnits(added, 18));
  const ratio = collateralRatio(tAfter.coll, tAfter.principal + tAfter.interest, tAfter.price)!;
  check("Dave's trove stays healthy (ratio > 110%)", ratio > U("1.1"), `${(Number(ratio) / 1e16).toFixed(2)}%`);
  b = (await alice.req<typeof b>("GET", `/api/groups/${gid}`)).data;
  check("Dave is settled up; Alice's receivable cleared", net(b, dave.address) === 0n && net(b, alice.address) === 0n);
  const reuse = await dave.req("POST", `/api/groups/${gid}/settlements`, { to: alice.address, amount: "1", method: "trove" });
  check("NEG nothing left to pay -> intent refused", reuse.status === 409);

  // Mezo Pools: BTC -> MUSD
  const btcIn = U("0.00005");
  const routes = [{ from: SWAP_TOKENS.BTC.address, to: MUSD.address, stable: false, factory: MEZO_POOLS.factory }] as const;
  const quote = (await pc.readContract({ address: MEZO_POOLS.router, abi: mezoRouterAbi, functionName: "getAmountsOut", args: [btcIn, [...routes]] }))[1];
  const cBefore = await charlie.musd();
  const appr = await charlie.wallet.writeContract({ address: SWAP_TOKENS.BTC.address, abi: erc20Abi, functionName: "approve", args: [MEZO_POOLS.router, btcIn], gas: 90_000n });
  await pc.waitForTransactionReceipt({ hash: appr, timeout: 180_000, pollingInterval: 2000 });
  txs.charlie_approves_btc_for_router = appr;
  const block = await pc.getBlock();
  const swap = await charlie.wallet.writeContract({
    address: MEZO_POOLS.router,
    abi: mezoRouterAbi,
    functionName: "swapExactTokensForTokens",
    args: [btcIn, (quote * 99n) / 100n, [...routes], charlie.account.address, block.timestamp + 1200n],
    gas: 450_000n,
  });
  txs.charlie_swaps_btc_for_musd = swap;
  const rc = await pc.waitForTransactionReceipt({ hash: swap, timeout: 180_000, pollingInterval: 2000 });
  console.log(`      swap gas used: ${rc.gasUsed}`);
  const got = (await charlie.musd()) - cBefore;
  check("Mezo Pools swap: 0.00005 BTC -> MUSD at the quoted price (≤1% slippage)", rc.status === "success" && got >= (quote * 99n) / 100n, `${formatUnits(got, 18)} MUSD`);

  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  console.log("Real Mezo testnet transactions:");
  for (const [k, v] of Object.entries(txs)) console.log(`  ${k}: ${mezoTestnet.blockExplorers.default.url}/tx/${v}`);
  console.log(`Group: ${BASE}/groups/${gid}`);
}

main().catch((e) => {
  console.error(String(e?.shortMessage ?? e?.message ?? e).split("\n").slice(0, 3).join("\n"));
  console.log("Transactions so far:", txs);
  process.exit(1);
});
