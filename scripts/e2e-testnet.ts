/**
 * Live end-to-end test against a running MUSD Split app + REAL Mezo testnet transactions.
 *
 *   BASE_URL=http://localhost:3000 npm run e2e:testnet
 *
 * Test wallets are read at runtime from E2E_WALLETS_FILE (default: the session scratchpad
 * test-wallets.json, key "split": alice / bob / charlie). Keys are never printed or stored.
 *
 * Covers spec §12 UAT: Alice creates a group, invites Bob & Charlie with an invite token, adds a
 * 90 MUSD expense split equally (30 each), Bob settles 30 MUSD with a real transfer, the app
 * verifies it, Bob's debt clears, Alice's receivable drops, Charlie still owes 30, the activity
 * feed records the tx. Plus negative cases and the settlement contract (permit + batch).
 */
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseSignature,
  parseUnits,
  type Hex,
  type PrivateKeyAccount,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { mezoTestnet } from "../src/config/chains";
import { MUSD, SETTLEMENT_CONTRACT, musdAbi } from "../src/config/contracts";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const WALLETS =
  process.env.E2E_WALLETS_FILE ??
  "C:/Users/nikku/AppData/Local/Temp/claude/C--Users-nikku-Desktop/120e793a-eda2-49e5-92e3-e45940332298/scratchpad/test-wallets.json";
const REFUND = process.env.E2E_REFUND !== "0";
const U = (n: string) => parseUnits(n, 18);

const pc = createPublicClient({ chain: mezoTestnet, transport: http(mezoTestnet.rpcUrls.default.http[0], { retryCount: 3 }) });

type Role = "alice" | "bob" | "charlie";
const raw = JSON.parse(readFileSync(WALLETS, "utf8")).split as Array<{ role: Role; address: string; privateKey: string }>;
const acct = (r: Role) => {
  const w = raw.find((x) => x.role === r)!;
  return privateKeyToAccount((w.privateKey.startsWith("0x") ? w.privateKey : `0x${w.privateKey}`) as Hex);
};

const results: Array<{ step: string; ok: boolean; detail?: string }> = [];
const txs: Record<string, string> = {};
function check(step: string, cond: unknown, detail?: string) {
  results.push({ step, ok: !!cond, detail });
  console.log(`${cond ? "PASS" : "FAIL"}  ${step}${detail ? ` — ${detail}` : ""}`);
  if (!cond) throw new Error(`Assertion failed: ${step}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class User {
  cookie = "";
  wallet;
  constructor(
    public name: string,
    public account: PrivateKeyAccount,
  ) {
    this.wallet = createWalletClient({ account, chain: mezoTestnet, transport: http(mezoTestnet.rpcUrls.default.http[0]) });
  }
  get address() {
    return this.account.address.toLowerCase();
  }
  async req<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        origin: BASE,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const m = /musd_split_session=([^;]*)/.exec(setCookie);
      if (m) this.cookie = `musd_split_session=${m[1]}`;
    }
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* csv etc. */
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
    // replaying the same signed message must fail (single-use nonce)
    const replay = await new User("replay", this.account).req("POST", "/api/auth/verify", { message, signature });
    return { address: r.data.address, replayStatus: replay.status };
  }
  async musd() {
    return pc.readContract({ address: MUSD.address, abi: musdAbi, functionName: "balanceOf", args: [this.account.address] });
  }
  async transfer(to: string, amount: bigint, label: string) {
    let gas = 90_000n;
    try {
      const est = await pc.estimateContractGas({ address: MUSD.address, abi: musdAbi, functionName: "transfer", args: [getAddress(to), amount], account: this.account });
      gas = est * 13n / 10n > gas ? (est * 13n) / 10n : gas;
    } catch {
      /* reverting estimate -> use floor */
    }
    let hash: Hex | null = null;
    for (let attempt = 0; !hash; attempt++) {
      try {
        hash = await this.wallet.writeContract({ address: MUSD.address, abi: musdAbi, functionName: "transfer", args: [getAddress(to), amount], gas, chain: mezoTestnet });
      } catch (e) {
        // retry only failures that happen BEFORE broadcast (nonce/chain lookups), never a possibly-sent tx
        const m = String((e as Error).message);
        if (attempt < 4 && /eth_getTransactionCount|eth_chainId|eth_gasPrice|eth_maxPriorityFeePerGas|eth_getBlockByNumber/.test(m) && /fetch failed|HTTP request failed|timed out/i.test(m)) {
          await sleep(3000 * (attempt + 1));
          continue;
        }
        throw e;
      }
    }
    txs[label] = hash;
    console.log(`      tx ${label}: ${hash}`);
    return hash;
  }
  async permit(value: bigint) {
    const [domain, nonce, block] = await Promise.all([
      pc.readContract({ address: MUSD.address, abi: musdAbi, functionName: "eip712Domain" }),
      pc.readContract({ address: MUSD.address, abi: musdAbi, functionName: "nonces", args: [this.account.address] }),
      pc.getBlock(),
    ]);
    const deadline = block.timestamp + 1800n;
    const sig = await this.account.signTypedData({
      domain: { name: domain[1], version: domain[2], chainId: Number(domain[3]), verifyingContract: domain[4] },
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: { owner: this.account.address, spender: SETTLEMENT_CONTRACT.address, value, nonce, deadline },
    });
    const { r, s, v, yParity } = parseSignature(sig);
    return { deadline, r, s, v: Number(v ?? BigInt(yParity + 27)) };
  }
}

async function waitReceipt(hash: Hex) {
  for (let i = 0; i < 60; i++) {
    try {
      return await pc.getTransactionReceipt({ hash });
    } catch {
      await sleep(2000);
    }
  }
  throw new Error(`receipt not found for ${hash}`);
}

async function verifyUntil(u: User, sid: string, want: string[], max = 30) {
  let s: { status: string; failureCode?: string; txHash?: string } = { status: "?" };
  for (let i = 0; i < max; i++) {
    const r = await u.req<{ settlement: typeof s }>("POST", `/api/settlements/${sid}/verify`);
    s = r.data.settlement;
    if (want.includes(s.status)) return s;
    await sleep(3000);
  }
  return s;
}

const net = (bundle: { ledger: { nets: Record<string, string> } }, a: string) => BigInt(bundle.ledger.nets[a] ?? "0");

async function refund() {
  const alice = new User("alice", acct("alice"));
  const bob = new User("bob", acct("bob"));
  const charlie = new User("charlie", acct("charlie"));
  console.log("      refunding test wallets (plain transfers, not part of the app ledger)…");
  const r1 = await alice.transfer(bob.address, U("30"), "refund_alice_to_bob_30");
  await waitReceipt(r1);
  const r2 = await alice.transfer(charlie.address, U("5"), "refund_alice_to_charlie_5");
  const r3 = await bob.transfer(charlie.address, U("1"), "refund_bob_to_charlie_1");
  await Promise.all([waitReceipt(r2), waitReceipt(r3)]);
  console.log(`      balances now: alice ${(await alice.musd()) / 10n ** 16n / 100n}, bob ${(await bob.musd()) / 10n ** 16n / 100n}, charlie ${(await charlie.musd()) / 10n ** 16n / 100n}`);
}

async function main() {
  if (process.env.E2E_REFUND_ONLY === "1") return refund();
  console.log(`MUSD Split e2e against ${BASE} (chain ${mezoTestnet.id})\n`);
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  check("health: db ok, rpc ok, chain 31611", health.db === "ok" && health.rpc === "ok" && health.chainId === 31611, `block ${health.blockNumber}`);

  const alice = new User("alice", acct("alice"));
  const bob = new User("bob", acct("bob"));
  const charlie = new User("charlie", acct("charlie"));
  const mallory = new User("mallory", privateKeyToAccount(generatePrivateKey()));
  const start = { alice: await alice.musd(), bob: await bob.musd(), charlie: await charlie.musd() };
  console.log(`      MUSD balances: alice ${start.alice / 10n ** 18n}, bob ${start.bob / 10n ** 18n}, charlie ${start.charlie / 10n ** 18n}`);
  check("bob has >= 30 MUSD and charlie >= 6 MUSD for the run", start.bob >= U("30") && start.charlie >= U("6"));

  for (const u of [alice, bob, charlie, mallory]) {
    const r = await u.login();
    check(`SIWE login ${u.name}`, r.address === u.address);
    if (u === alice) check("SIWE replay of a used nonce is rejected", r.replayStatus === 401);
  }
  const unauth = await new User("anon", mallory.account).req("GET", "/api/dashboard");
  check("unauthenticated API call -> 401", unauth.status === 401);

  // profiles
  await alice.req("PATCH", "/api/me", { displayName: "Alice (e2e)" });
  await bob.req("PATCH", "/api/me", { displayName: "Bob (e2e)" });
  await charlie.req("PATCH", "/api/me", { displayName: "Charlie (e2e)" });

  // 1. Alice creates a group
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const g = await alice.req<{ id: string }>("POST", "/api/groups", { name: `E2E Goa trip ${stamp}`, description: "Automated UAT run", icon: "plane", color: "cyan" });
  check("1. Alice creates a group", g.status === 201, g.data.id);
  const gid = g.data.id;

  // 2. Alice invites Bob and Charlie (invite token)
  const inv = await alice.req<{ invite: { token: string; id: string } }>("POST", `/api/groups/${gid}/invites`, { expiresInHours: 24, maxUses: 5 });
  check("2a. invite link created", inv.status === 201 && inv.data.invite.token.length >= 32);
  const preview = await mallory.req<{ group: { name: string }; state: string }>("GET", `/api/invites/${inv.data.invite.token}`);
  check("2b. invite preview shows the group but no member list", preview.status === 200 && preview.data.state === "active" && preview.data.group.name.startsWith("E2E") && !("members" in (preview.data as object)));
  for (const u of [bob, charlie]) {
    const a = await u.req<{ groupId: string }>("POST", `/api/invites/${inv.data.invite.token}/accept`);
    check(`2c. ${u.name} joins via invite token`, a.status === 200 && a.data.groupId === gid);
  }
  const revoked = await alice.req<{ invite: { token: string; id: string } }>("POST", `/api/groups/${gid}/invites`, { expiresInHours: 1 });
  await alice.req("DELETE", `/api/groups/${gid}/invites/${revoked.data.invite.id}`);
  const joinRevoked = await mallory.req("POST", `/api/invites/${revoked.data.invite.token}/accept`);
  check("NEG revoked invite cannot be used (410)", joinRevoked.status === 410);
  const badToken = await mallory.req("POST", `/api/invites/${"x".repeat(32)}/accept`);
  check("NEG guessed invite token rejected (404)", badToken.status === 404);

  // Non-member authorization
  const mGet = await mallory.req("GET", `/api/groups/${gid}`);
  check("NEG non-member cannot read the group (403)", mGet.status === 403);
  const mExp = await mallory.req("POST", `/api/groups/${gid}/expenses`, {
    title: "Sneaky",
    amount: "10",
    payer: mallory.address,
    category: "other",
    date: "2026-10-26",
    split: { method: "equal", participants: [alice.address, mallory.address] },
  });
  check("NEG random non-member tries to add an expense -> 403", mExp.status === 403);
  const mSet = await mallory.req("POST", `/api/groups/${gid}/settlements`, { to: alice.address, amount: "1" });
  check("NEG non-member cannot create a settlement (403)", mSet.status === 403);

  // 3-7. 90 MUSD expense split equally
  const members = [alice.address, bob.address, charlie.address];
  const exp = await alice.req<{ id: string }>("POST", `/api/groups/${gid}/expenses`, {
    title: "Beach villa dinner",
    amount: "90",
    payer: alice.address,
    category: "food",
    date: new Date().toISOString().slice(0, 10),
    split: { method: "equal", participants: members },
    clientRequestId: `e2e-${Date.now()}`,
  });
  check("3. Alice adds a 90 MUSD shared expense", exp.status === 201, exp.data.id);
  const eDetail = await bob.req<{ expense: { participants: Array<{ address: string; share: string }>; payer: string } }>(
    "GET",
    `/api/groups/${gid}/expenses/${exp.data.id}`,
  );
  check(
    "4-5. split equally: each share is exactly 30 MUSD",
    eDetail.data.expense.participants.length === 3 && eDetail.data.expense.participants.every((p) => BigInt(p.share) === U("30")),
  );
  check("6. Alice is shown as the payer", eDetail.data.expense.payer === alice.address);
  let b = (await alice.req<{ ledger: { nets: Record<string, string>; simplified: Array<{ from: string; to: string; amount: string }> } }>("GET", `/api/groups/${gid}`)).data;
  check("7. Bob and Charlie each owe Alice 30; Alice +60", net(b, bob.address) === -U("30") && net(b, charlie.address) === -U("30") && net(b, alice.address) === U("60"));
  check(
    "7b. suggested settlements: bob->alice 30, charlie->alice 30",
    b.ledger.simplified.length === 2 && b.ledger.simplified.every((t) => t.to === alice.address && BigInt(t.amount) === U("30")),
  );

  // payment request lifecycle
  const reqR = await alice.req<{ request: { id: string; status: string } }>("POST", `/api/groups/${gid}/requests`, {
    payer: bob.address,
    amount: "30",
    note: "Villa dinner",
    expenseIds: [exp.data.id],
    expiresInDays: 7,
  });
  check("payment request created (pending)", reqR.status === 201 && reqR.data.request.status === "pending");
  const over = await alice.req("POST", `/api/groups/${gid}/requests`, { payer: bob.address, amount: "31" });
  check("NEG request above the debt is refused (409)", over.status === 409);

  // 8. Bob settles 30 MUSD with a REAL transfer
  const intent = await bob.req<{ settlement: { id: string; status: string } }>("POST", `/api/groups/${gid}/settlements`, {
    to: alice.address,
    amount: "30",
    method: "direct",
    paymentRequestId: reqR.data.request.id,
  });
  check("8a. Bob records a payment intent (no money moved yet)", intent.status === 201 && intent.data.settlement.status === "created");
  b = (await alice.req<typeof b>("GET", `/api/groups/${gid}`)).data;
  check("8b. intent alone does not change balances", net(b, bob.address) === -U("30"));
  const bobHash = await bob.transfer(alice.address, U("30"), "bob_settles_30_direct");
  const sub = await bob.req<{ settlement: { status: string } }>("POST", `/api/settlements/${intent.data.settlement.id}/submit`, { txHash: bobHash });
  check("8c. tx hash persisted immediately (submitted/confirmed)", sub.status === 200 && ["submitted", "confirmed", "delayed"].includes(sub.data.settlement.status), sub.data.settlement.status);
  await waitReceipt(bobHash);
  const fin = await verifyUntil(bob, intent.data.settlement.id, ["confirmed", "failed", "rejected"]);
  check("9. app verifies the transaction on-chain -> confirmed", fin.status === "confirmed");

  b = (await alice.req<typeof b>("GET", `/api/groups/${gid}`)).data;
  check("10a. Bob's outstanding debt is cleared", net(b, bob.address) === 0n);
  check("10b. Alice's receivable reduced to 30", net(b, alice.address) === U("30"));
  check("11. Charlie still owes 30", net(b, charlie.address) === -U("30"));
  const act = await alice.req<{ activity: Array<{ type: string; data: { txHash?: string } }> }>("GET", `/api/groups/${gid}/activity`);
  check(
    "12. activity feed records the settlement with its tx reference",
    act.data.activity.some((a) => a.type === "settlement_confirmed" && a.data.txHash === bobHash.toLowerCase()),
  );
  const reqs = await bob.req<{ received: Array<{ id: string; status: string; settlementTxHash: string }> }>("GET", "/api/requests");
  check("payment request marked paid only by the verified transfer", reqs.data.received.find((r) => r.id === reqR.data.request.id)?.status === "paid");
  const notes = await alice.req<{ unread: number; notifications: Array<{ type: string }> }>("GET", "/api/notifications");
  check("Alice got a 'paid you' notification", notes.data.notifications.some((n) => n.type === "settlement_received"));

  // Negative: duplicate / foreign tx hashes, overpay, wrong amount, reverted tx
  const bobAgain = await bob.req("POST", `/api/groups/${gid}/settlements`, { to: alice.address, amount: "30" });
  check("NEG Bob can't pay the same debt twice (409 NOTHING_OWED)", bobAgain.status === 409);
  const cIntent = await charlie.req<{ settlement: { id: string } }>("POST", `/api/groups/${gid}/settlements`, { to: alice.address, amount: "30", method: "direct" });
  const steal = await charlie.req<{ error: { code: string } }>("POST", `/api/settlements/${cIntent.data.settlement.id}/submit`, { txHash: bobHash });
  check("NEG Charlie submits Bob's tx hash -> rejected", steal.status === 422 || steal.status === 409, `${steal.status} ${steal.data.error?.code}`);

  const wrongHash = await charlie.transfer(alice.address, U("1"), "charlie_wrong_amount_1_for_30");
  await charlie.req("POST", `/api/settlements/${cIntent.data.settlement.id}/submit`, { txHash: wrongHash });
  await waitReceipt(wrongHash);
  const wrong = await verifyUntil(charlie, cIntent.data.settlement.id, ["confirmed", "failed", "rejected"]);
  check("NEG wrong-amount transaction (1 MUSD for a 30 MUSD payment) -> rejected", wrong.status === "rejected" && wrong.failureCode === "AMOUNT_MISMATCH", wrong.failureCode);
  b = (await alice.req<typeof b>("GET", `/api/groups/${gid}`)).data;
  check("NEG rejected payment does not reduce Charlie's debt", net(b, charlie.address) === -U("30"));

  const fIntent = await charlie.req<{ settlement: { id: string } }>("POST", `/api/groups/${gid}/settlements`, { to: alice.address, amount: "30", method: "direct" });
  let revertHash: Hex | null = null;
  try {
    revertHash = await charlie.transfer(alice.address, U("100000"), "charlie_reverting_transfer");
  } catch (e) {
    console.log("      node refused the reverting tx at broadcast:", String((e as Error).message).split("\n")[0]);
    await charlie.req("POST", `/api/settlements/${fIntent.data.settlement.id}/cancel`);
  }
  if (revertHash) {
    await charlie.req("POST", `/api/settlements/${fIntent.data.settlement.id}/submit`, { txHash: revertHash });
    await waitReceipt(revertHash);
    const failed = await verifyUntil(charlie, fIntent.data.settlement.id, ["confirmed", "failed", "rejected"]);
    check("NEG reverted transaction -> failed (no balance change)", failed.status === "failed");
  }

  // Settlement contract: settleWithPermit (one signature + one tx)
  const kIntent = await charlie.req<{ settlement: { id: string; settlementKey: Hex } }>("POST", `/api/groups/${gid}/settlements`, {
    to: alice.address,
    amount: "3",
    method: "contract_permit",
  });
  check("contract intent created with a bytes32 settlement id", kIntent.status === 201 && /^0x[0-9a-f]{64}$/.test(kIntent.data.settlement.settlementKey));
  const p = await charlie.permit(U("3"));
  const kArgs = [kIntent.data.settlement.settlementKey, getAddress(alice.address), U("3"), p.deadline, p.v, p.r, p.s] as const;
  const kHash = await charlie.wallet.writeContract({ address: SETTLEMENT_CONTRACT.address, abi: SETTLEMENT_CONTRACT.abi, functionName: "settleWithPermit", args: kArgs, gas: 300_000n, chain: mezoTestnet });
  txs.charlie_settleWithPermit_3 = kHash;
  console.log(`      tx charlie_settleWithPermit_3: ${kHash}`);
  await charlie.req("POST", `/api/settlements/${kIntent.data.settlement.id}/submit`, { txHash: kHash });
  await waitReceipt(kHash);
  const k = await verifyUntil(charlie, kIntent.data.settlement.id, ["confirmed", "failed", "rejected"]);
  check("contract settleWithPermit verified (Settled event + MUSD Transfer)", k.status === "confirmed");
  b = (await alice.req<typeof b>("GET", `/api/groups/${gid}`)).data;
  check("Charlie now owes 27 after the 3 MUSD contract settlement", net(b, charlie.address) === -U("27"));
  let dupReverted = false;
  try {
    await pc.simulateContract({
      address: SETTLEMENT_CONTRACT.address,
      abi: SETTLEMENT_CONTRACT.abi,
      functionName: "settle",
      args: [kIntent.data.settlement.settlementKey, getAddress(alice.address), U("3")],
      account: charlie.account,
    });
  } catch (e) {
    dupReverted = /AlreadySettled/.test(String((e as Error).message));
  }
  check("NEG on-chain duplicate settlement id reverts (AlreadySettled)", dupReverted);

  // Batch: settle everything Charlie owes in a second group in ONE transaction
  const g2 = await alice.req<{ id: string }>("POST", "/api/groups", { name: `E2E batch ${stamp}`, icon: "home", color: "violet" });
  const inv2 = await alice.req<{ invite: { token: string } }>("POST", `/api/groups/${g2.data.id}/invites`, {});
  await bob.req("POST", `/api/invites/${inv2.data.invite.token}/accept`);
  await charlie.req("POST", `/api/invites/${inv2.data.invite.token}/accept`);
  const today = new Date().toISOString().slice(0, 10);
  const e2 = await alice.req<{ id: string }>("POST", `/api/groups/${g2.data.id}/expenses`, {
    title: "Groceries",
    amount: "2",
    payer: alice.address,
    category: "groceries",
    date: today,
    split: { method: "equal", participants: [alice.address, charlie.address] },
  });
  await bob.req("POST", `/api/groups/${g2.data.id}/expenses`, {
    title: "Internet",
    amount: "3",
    payer: bob.address,
    category: "internet",
    date: today,
    split: { method: "percentage", percentages: { [bob.address]: "66.67", [charlie.address]: "33.33" } },
  });
  let b2 = (await charlie.req<typeof b>("GET", `/api/groups/${g2.data.id}`)).data;
  check("group 2: charlie owes 1.00 to Alice + 1.00 to Bob (percentage split rounding)", net(b2, charlie.address) === -U("2"), String(net(b2, charlie.address)));
  const batch = await charlie.req<{ batch: { id: string; total: string }; items: Array<{ settlementKey: Hex; to: string; amount: string }> }>(
    "POST",
    `/api/groups/${g2.data.id}/settlements/batch`,
    { method: "batch_permit" },
  );
  check("batch created with 2 items", batch.status === 201 && batch.data.items.length === 2);
  const bp = await charlie.permit(BigInt(batch.data.batch.total));
  const bArgs = [
    batch.data.items.map((i) => i.settlementKey),
    batch.data.items.map((i) => getAddress(i.to)),
    batch.data.items.map((i) => BigInt(i.amount)),
    bp.deadline,
    bp.v,
    bp.r,
    bp.s,
  ] as const;
  const bHash = await charlie.wallet.writeContract({
    address: SETTLEMENT_CONTRACT.address,
    abi: SETTLEMENT_CONTRACT.abi,
    functionName: "settleBatchWithPermit",
    args: bArgs,
    gas: 450_000n,
    chain: mezoTestnet,
  });
  txs.charlie_settleBatchWithPermit_2_items = bHash;
  console.log(`      tx charlie_settleBatchWithPermit_2_items: ${bHash}`);
  await charlie.req("POST", `/api/settlement-batches/${batch.data.batch.id}/submit`, { txHash: bHash });
  await waitReceipt(bHash);
  let bs = { batch: { status: "" } };
  for (let i = 0; i < 20 && bs.batch.status !== "confirmed"; i++) {
    bs = (await charlie.req<typeof bs>("POST", `/api/settlement-batches/${batch.data.batch.id}/verify`)).data;
    if (bs.batch.status !== "confirmed") await sleep(3000);
  }
  check("batch settlement verified: both items confirmed in one tx", bs.batch.status === "confirmed");
  b2 = (await charlie.req<typeof b>("GET", `/api/groups/${g2.data.id}`)).data;
  check("group 2: everyone settled up", Object.values(b2.ledger.nets).every((v) => BigInt(v) === 0n));

  // Auditable adjustment after settlement
  const ev = await alice.req<{ expense: { version: number } }>("GET", `/api/groups/${g2.data.id}/expenses/${e2.data.id}`);
  const editBody = {
    title: "Groceries",
    amount: "4",
    payer: alice.address,
    category: "groceries",
    date: today,
    split: { method: "equal", participants: [alice.address, charlie.address] },
    expectedVersion: ev.data.expense.version,
  };
  const noReason = await alice.req<{ error: { code: string } }>("PATCH", `/api/groups/${g2.data.id}/expenses/${e2.data.id}`, editBody);
  check("NEG editing a settled expense without a reason is refused", noReason.status === 400 && noReason.data.error.code === "REASON_REQUIRED");
  const withReason = await alice.req<{ adjustment: boolean }>("PATCH", `/api/groups/${g2.data.id}/expenses/${e2.data.id}`, { ...editBody, reason: "Forgot the second bag" });
  check("edit after settlement recorded as an auditable adjustment", withReason.status === 200 && withReason.data.adjustment === true);
  b2 = (await charlie.req<typeof b>("GET", `/api/groups/${g2.data.id}`)).data;
  check("adjustment re-opens exactly the delta (charlie owes 1 more), settlements untouched", net(b2, charlie.address) === -U("1"));
  const stale = await alice.req("PATCH", `/api/groups/${g2.data.id}/expenses/${e2.data.id}`, { ...editBody, reason: "x" });
  check("NEG stale version edit -> 409", stale.status === 409);

  const csv = await alice.req<string>("GET", `/api/groups/${gid}/export`);
  check("CSV export includes the verified tx hash", csv.status === 200 && String(csv.data).includes(bobHash.toLowerCase()));

  // Housekeeping: return the test MUSD so the run is repeatable (plain transfers, not app settlements)
  if (REFUND) await refund().catch((e) => console.log("      refund failed (re-run with E2E_REFUND_ONLY=1):", String(e).split("\n")[0]));

  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  console.log("Real Mezo testnet transactions:");
  for (const [k, v] of Object.entries(txs)) console.log(`  ${k}: https://explorer.test.mezo.org/tx/${v}`);
  console.log(`Groups: ${BASE}/groups/${gid}  ${BASE}/groups/${g2.data.id}`);
}

main().catch((e) => {
  console.error("\nE2E FAILED:", e instanceof Error ? e.message : e);
  console.log("Transactions so far:", JSON.stringify(txs, null, 2));
  process.exit(1);
});
