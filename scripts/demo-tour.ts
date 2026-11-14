/**
 * Narrated product demo, driven in a real browser with a scripted testnet wallet. Every click is
 * real; the payment is a real Mezo testnet transaction verified by the app.
 *
 *   BASE_URL=https://musd-split.vercel.app npx tsx scripts/demo-tour.ts --video --shots
 *
 *   --video   record docs/demo/musd-split-demo.mp4 (1280×720, captions + spoken narration)
 *   --shots   save desktop + phone screenshots to docs/screenshots/
 *
 * Narration: each line is rendered with Windows text-to-speech (System.Speech, voice NARRATOR_VOICE,
 * default "Microsoft Zira Desktop") before recording; its length sets how long the step stays on
 * screen, and the clips are mixed onto the video at the moments they were shown.
 *
 * Cast: Alice, Bob, Charlie (test wallets, .env.e2e-wallets.json) and Dave, the viewer, whose wallet
 * has an open Mezo trove (DAVE_ENV_FILE, default ./.env.deployer).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Locator, type Page } from "playwright-core";
import { privateKeyToAccount } from "viem/accounts";
import { ApiUser, keyFromEnvFile, testWallet } from "./lib/api-user";
import { injectWallet } from "./lib/demo-wallet";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const VIDEO = process.argv.includes("--video");
const SHOTS = process.argv.includes("--shots");
const ROOT = path.resolve(__dirname, "..");
const SHOT_DIR = path.join(ROOT, "docs/screenshots");
const VIDEO_DIR = path.join(ROOT, "docs/demo");
const RAW = path.join(VIDEO_DIR, "raw");
const DAVE_FILE = process.env.DAVE_ENV_FILE ?? path.resolve(__dirname, "../.env.deployer");
const WALLET_NAME = "MUSD Split Demo Wallet";
const VOICE = process.env.NARRATOR_VOICE ?? "Microsoft Zira Desktop";
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const SITE = BASE.replace(/^https?:\/\//, "").replace(/\./g, " dot ");

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ------------------------------------------------------------------ narration script */

const LINES = {
  intro: "This is MUSD Split. Split the bill, and settle it in MUSD, on Mezo.",
  hero: "MUSD Split is a shared ledger for trips, flats and dinners. It works out who owes whom, and settles every debt in MUSD on the Mezo network.",
  untangle: "Here is a real example. Six friends on a trip end up with fourteen separate debts. One click, and the app reduces them to just five payments that settle everyone.",
  live: "This strip is live from the chain: the latest Mezo block, and the contracts the app uses.",
  ways: "There are three ways to pay a friend, and all of them run on Mezo. Pay with MUSD you already hold. Swap Bitcoin for exactly what you owe on Mezo Pools. Or borrow MUSD against your Bitcoin, at the moment you pay.",
  steps: "It works in four steps. Create a group. Record expenses. See who owes whom. And settle in MUSD.",
  verify: "An expense is not a payment. A debt only shrinks when our server has fetched the transaction from Mezo, and checked the sender, the recipient, the exact amount, and the protocol events.",
  features: "And everything a shared ledger needs is built in: four split methods, exact to the cent, receipts, recurring bills, payment requests, and a full audit trail.",
  connect: "Let's try it. Dave connects his wallet, and signs in with a free signature. No funds move.",
  dashboard: "His dashboard shows what he owes, what he is owed, and what to settle next.",
  source: "Further down, it shows where his MUSD comes from: his wallet balance, and the health of his Mezo trove.",
  group: "This is the Lisbon trip. Four friends, and four shared bills, each split equally.",
  addExpense: "Adding a bill takes seconds. Dave types what it was for and the amount, and the app shows each person's exact share before he saves.",
  saved: "Saved. Every share is exact to the cent, and the app tracks whether each one has been paid.",
  balances: "The balances tab shows each person's position. Alice is owed money, and the others owe.",
  debtMap: "The debt map draws it. As recorded, there are many debts. Simplified, there are only a few payments, with exactly the same result.",
  settleIntro: "Dave owes Alice. He could pay with MUSD from his wallet, but he would rather keep his Bitcoin.",
  trove: "So he borrows against it. Mezo mints the MUSD from his trove, and sends it straight to Alice, in a single transaction.",
  health: "Before signing, he sees his trove's collateral ratio and liquidation price, now and after paying, read live from Mezo.",
  confirm: "He reviews the payment and confirms. His wallet signs once.",
  verifying: "The app saves the transaction immediately, then fetches the receipt from Mezo and verifies it.",
  confirmed: "Confirmed on-chain. Dave's debt is cleared only now, and both friends get the same receipt.",
  receipt: "The receipt links to the transaction on the Mezo explorer, so anyone can check it.",
  wallet: "The wallet page manages the trove. Borrow more, add Bitcoin, or repay, with its health shown live.",
  swap: "Short on MUSD? Swap Bitcoin or MEZO for it on Mezo Pools, priced live, with slippage protection.",
  about: "The about page explains who it is for, and how it makes money. Splitting stays free. Revenue comes from borrowing and swap fees, and a Pro plan for groups.",
  usage: "And the usage page shows live numbers. Every payment counted here was verified on Mezo testnet.",
  outro: `MUSD Split. Split the bill, settle it in MUSD. Try it now, at ${SITE}.`,
} as const;
type LineKey = keyof typeof LINES;

const clips: Record<string, { file: string; ms: number }> = {};
const cues: Array<{ key: LineKey; at: number }> = [];
let t0 = 0;

function wavMs(file: string) {
  const b = readFileSync(file);
  const byteRate = b.readUInt32LE(28);
  let off = 12;
  while (off < b.length - 8) {
    const id = b.toString("ascii", off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === "data") return Math.round((size / byteRate) * 1000);
    off += 8 + size;
  }
  return 3000;
}

function renderNarration() {
  mkdirSync(RAW, { recursive: true });
  const jobs = (Object.keys(LINES) as LineKey[]).map((k, i) => ({ key: k, text: LINES[k], file: path.join(RAW, `voice-${String(i).padStart(2, "0")}-${k}.wav`) }));
  const jobFile = path.join(RAW, "narration.json");
  writeFileSync(jobFile, JSON.stringify(jobs), "utf8");
  const ps = path.join(RAW, "narrate.ps1");
  writeFileSync(
    ps,
    `Add-Type -AssemblyName System.Speech
$jobs = Get-Content -Raw -Encoding UTF8 '${jobFile.replace(/'/g, "''")}' | ConvertFrom-Json
foreach ($j in $jobs) {
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try { $s.SelectVoice('${VOICE.replace(/'/g, "''")}') } catch {}
  $s.Rate = 0
  $s.SetOutputToWaveFile($j.file)
  $s.Speak($j.text)
  $s.Dispose()
}
`,
    "utf8",
  );
  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps], { stdio: "inherit" });
  for (const j of jobs) clips[j.key] = { file: j.file, ms: wavMs(j.file) };
  const total = Object.values(clips).reduce((a, c) => a + c.ms, 0);
  log(`narration: ${jobs.length} lines, ${(total / 1000).toFixed(0)}s of speech (${VOICE})`);
}

/* ------------------------------------------------------------------ on-screen helpers */

async function caption(page: Page, text: string) {
  await page
    .evaluate((t) => {
      let el = document.getElementById("__demo_caption");
      if (!el) {
        el = document.createElement("div");
        el.id = "__demo_caption";
        Object.assign(el.style, {
          position: "fixed",
          left: "50%",
          bottom: "26px",
          transform: "translateX(-50%)",
          width: "min(1080px, 92vw)",
          background: "#000",
          color: "#fff",
          font: "500 20px/1.45 'IBM Plex Sans', system-ui, sans-serif",
          padding: "12px 22px",
          borderRadius: "8px",
          zIndex: "2147483647",
          textAlign: "center",
          pointerEvents: "none",
        });
        document.body.appendChild(el);
      }
      el.textContent = t;
      el.style.display = t ? "block" : "none";
    }, text)
    .catch(() => undefined);
}

/** Show + speak one line. Returns once it has been said (or immediately with `wait: false`). */
async function say(page: Page, key: LineKey, opts: { wait?: boolean; min?: number } = {}) {
  await caption(page, LINES[key]);
  if (!VIDEO) return;
  cues.push({ key, at: Date.now() - t0 });
  if (opts.wait === false) return;
  await page.waitForTimeout(Math.max(clips[key]?.ms ?? 2500, opts.min ?? 0) + 450);
}

async function card(page: Page, title: string, sub: string, key: LineKey) {
  await page.evaluate(
    ([t, s]) => {
      document.getElementById("__demo_caption")?.remove();
      const el = document.createElement("div");
      el.id = "__demo_card";
      el.innerHTML = `<div style="display:flex;align-items:center;gap:14px"><svg viewBox="0 0 32 32" width="56" height="56"><rect width="32" height="32" rx="7" fill="#002fa7"/><path d="M7 9h18v6H7z" fill="#fff"/><path d="M7 17h9v6H7z" fill="#fff"/><path d="M18 17h7v6h-7z" fill="#000"/></svg><span style="font:700 34px system-ui;letter-spacing:-0.02em">MUSD Split</span></div><div style="font:700 56px/1.05 system-ui;letter-spacing:-0.03em;margin-top:36px;max-width:900px">${t}</div><div style="font:400 24px/1.45 system-ui;color:#404040;margin-top:20px;max-width:880px">${s}</div>`;
      Object.assign(el.style, { position: "fixed", inset: "0", background: "#fff", color: "#000", zIndex: "2147483646", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 110px", borderLeft: "16px solid #002fa7" });
      document.body.appendChild(el);
    },
    [title, sub],
  );
  if (VIDEO) {
    cues.push({ key, at: Date.now() - t0 });
    await page.waitForTimeout((clips[key]?.ms ?? 3000) + 900);
  }
  await page.evaluate(() => document.getElementById("__demo_card")?.remove());
}

/** A visible pointer that glides to the element before the real click, so viewers can follow. */
async function pointTo(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded().catch(() => undefined);
  const box = await target.boundingBox();
  if (!box) return;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.evaluate(
    ([x, y]) => {
      let c = document.getElementById("__demo_cursor");
      if (!c) {
        c = document.createElement("div");
        c.id = "__demo_cursor";
        Object.assign(c.style, {
          position: "fixed",
          left: "640px",
          top: "380px",
          width: "22px",
          height: "22px",
          marginLeft: "-11px",
          marginTop: "-11px",
          borderRadius: "50%",
          background: "rgba(0,47,167,0.35)",
          border: "3px solid #002fa7",
          zIndex: "2147483647",
          pointerEvents: "none",
          transition: "left 650ms ease-in-out, top 650ms ease-in-out, transform 160ms",
        });
        document.body.appendChild(c);
      }
      c.style.left = `${x}px`;
      c.style.top = `${y}px`;
    },
    [x, y],
  );
  await page.waitForTimeout(VIDEO ? 800 : 30);
}

async function click(page: Page, target: Locator) {
  await pointTo(page, target);
  await page.evaluate(() => {
    const c = document.getElementById("__demo_cursor");
    if (c) {
      c.style.transform = "scale(0.7)";
      setTimeout(() => (c.style.transform = "scale(1)"), 180);
    }
  });
  await target.click();
}

async function typeSlow(page: Page, target: Locator, text: string) {
  await click(page, target);
  await target.fill("");
  await target.pressSequentially(text, { delay: VIDEO ? 90 : 0 });
}

async function glide(page: Page, px: number, ms = 1400) {
  const steps = Math.max(8, Math.round(ms / 40));
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, px / steps);
    await page.waitForTimeout(VIDEO ? ms / steps : 5);
  }
}

/** Smoothly bring an element to near the top of the viewport. */
async function scrollToEl(page: Page, target: Locator, offset = 72, ms = 1600) {
  const box = await target.first().boundingBox();
  if (!box) return;
  await glide(page, box.y - offset, ms);
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await caption(page, "");
  await page.evaluate(() => document.getElementById("__demo_cursor")?.remove());
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}

async function go(page: Page, url: string) {
  await page.goto(BASE + url, { waitUntil: "load" });
  await page.waitForTimeout(2200);
}

/* ------------------------------------------------------------------ data */

async function seed() {
  const alice = new ApiUser(BASE, "alice", testWallet("alice"));
  const bob = new ApiUser(BASE, "bob", testWallet("bob"));
  const charlie = new ApiUser(BASE, "charlie", testWallet("charlie"));
  const dave = new ApiUser(BASE, "dave", privateKeyToAccount(keyFromEnvFile(DAVE_FILE)));
  for (const u of [alice, bob, charlie, dave]) await u.login();
  // tidy Dave's dashboard: leave earlier demo / test groups he has already settled
  const mine = await dave.req<{ groups: Array<{ id: string; name: string; net: string }> }>("GET", "/api/groups");
  for (const g of mine.data.groups ?? []) {
    if ((g.name === "Lisbon trip" || /^e2e/i.test(g.name)) && BigInt(g.net) === 0n) await dave.req("POST", `/api/groups/${g.id}/leave`);
  }
  await alice.req("PATCH", "/api/me", { displayName: "Alice" });
  await bob.req("PATCH", "/api/me", { displayName: "Bob" });
  await charlie.req("PATCH", "/api/me", { displayName: "Charlie" });
  await dave.req("PATCH", "/api/me", { displayName: "Dave" });
  const g = await alice.req<{ id: string }>("POST", "/api/groups", { name: "Lisbon trip", description: "Four friends, one long weekend", icon: "plane", color: "violet" });
  if (g.status !== 201) throw new Error(`group create failed ${g.status}`);
  const inv = await alice.req<{ invite: { token: string } }>("POST", `/api/groups/${g.data.id}/invites`, { expiresInHours: 24, maxUses: 5 });
  for (const u of [bob, charlie, dave]) await u.req("POST", `/api/invites/${inv.data.invite.token}/accept`);
  const all = [alice, bob, charlie, dave].map((u) => u.address);
  const today = new Date().toISOString().slice(0, 10);
  const add = (u: ApiUser, title: string, amount: string, category: string) =>
    u.req("POST", `/api/groups/${g.data.id}/expenses`, { title, amount, payer: u.address, category, date: today, split: { method: "equal", participants: all } });
  await add(alice, "Apartment, 3 nights", "120", "travel");
  await add(bob, "Dinner at Taberna", "48", "food");
  await add(charlie, "Tram passes", "20", "transport");
  await add(dave, "Groceries", "24", "groceries");
  log(`seeded group ${g.data.id}`);
  return { groupId: g.data.id, dave };
}

/* ------------------------------------------------------------------ the tour */

async function main() {
  mkdirSync(SHOT_DIR, { recursive: true });
  if (VIDEO) {
    rmSync(RAW, { recursive: true, force: true });
    renderNarration();
  }
  const { groupId, dave } = await seed();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    ...(VIDEO ? { recordVideo: { dir: RAW, size: { width: 1280, height: 720 } } } : {}),
  });
  const txs: string[] = [];
  await injectWallet(context, dave.account, { name: WALLET_NAME, approveDelayMs: VIDEO ? 1200 : 200, onTx: (h) => txs.push(h) });
  const page = await context.newPage();
  t0 = Date.now();
  page.setDefaultTimeout(60_000);
  const rest = (key: LineKey, alreadyMs: number) => (VIDEO ? Math.max(400, (clips[key]?.ms ?? 0) - alreadyMs + 450) : 30);

  // 1. The landing page, top to bottom
  await go(page, "/");
  await card(page, "Split the bill. Settle it in MUSD.", "A shared ledger for groups, settled in MUSD on Mezo, with every payment verified on-chain.", "intro");
  await say(page, "hero");
  await shot(page, "desktop-landing");
  await say(page, "untangle", { wait: false });
  const u0 = Date.now();
  await page.waitForTimeout(VIDEO ? 3800 : 30);
  await click(page, page.getByRole("tab", { name: /Simplified/ }));
  await page.waitForTimeout(VIDEO ? 2000 : 30);
  await click(page, page.getByRole("tab", { name: /As recorded/ }));
  await page.waitForTimeout(VIDEO ? 1400 : 30);
  await click(page, page.getByRole("tab", { name: /Simplified/ }));
  await page.waitForTimeout(rest("untangle", Date.now() - u0));
  await scrollToEl(page, page.locator("section[aria-label='Live network data']"), 420, 1400);
  await say(page, "live");
  await scrollToEl(page, page.locator("#pay"), 64);
  await say(page, "ways", { wait: false });
  const w0 = Date.now();
  await page.waitForTimeout(VIDEO ? 4500 : 30);
  await glide(page, 380, 1800);
  await page.waitForTimeout(rest("ways", Date.now() - w0));
  await scrollToEl(page, page.locator("#how"), 64);
  await say(page, "steps");
  await scrollToEl(page, page.locator("#verified"), 64);
  await say(page, "verify");
  await glide(page, 760, 1800);
  await say(page, "features");
  await glide(page, -6000, 1800);

  // 2. Connect and sign in
  await say(page, "connect", { wait: false });
  const c0 = Date.now();
  await click(page, page.getByRole("button", { name: /Connect (a )?wallet/ }).first());
  const walletBtn = page.getByRole("button", { name: new RegExp(WALLET_NAME) });
  if (await walletBtn.waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) {
    await page.waitForTimeout(VIDEO ? 1000 : 30);
    await click(page, walletBtn);
  }
  for (let i = 0; i < 40; i++) {
    const s = await page.evaluate(() => fetch("/api/auth/session").then((r) => r.json() as Promise<{ address: string | null }>));
    if (s.address) break;
    if (i === 39) throw new Error("sign-in did not complete");
    await page.waitForTimeout(750);
  }
  await page.waitForTimeout(rest("connect", Date.now() - c0));

  // 3. Dashboard
  await go(page, "/dashboard");
  await say(page, "dashboard");
  await shot(page, "desktop-dashboard");
  await scrollToEl(page, page.getByText("MUSD in your wallet"), 200, 1500);
  await say(page, "source");

  // 4. The group
  await go(page, `/groups/${groupId}`);
  await say(page, "group");
  await shot(page, "desktop-group");
  await say(page, "addExpense", { wait: false });
  const a0 = Date.now();
  await click(page, page.getByRole("link", { name: /Add expense/ }).first());
  await page.locator("#ex-title").waitFor();
  await page.waitForTimeout(VIDEO ? 600 : 30);
  await typeSlow(page, page.locator("#ex-title"), "Pastéis de nata");
  await typeSlow(page, page.locator("#ex-amt"), "8");
  await glide(page, 440, 1300);
  await page.waitForTimeout(rest("addExpense", Date.now() - a0));
  await shot(page, "desktop-add-expense");
  await click(page, page.getByRole("button", { name: /^Add expense$/ }));
  await page.waitForURL(/\/expenses\/[0-9a-f-]{36}/, { timeout: 30_000 });
  await page.waitForTimeout(1800);
  await say(page, "saved");
  await shot(page, "desktop-expense");

  // 5. Balances and the debt map
  await go(page, `/groups/${groupId}?tab=balances`);
  await say(page, "balances");
  await shot(page, "desktop-balances");
  const dm = page.getByRole("tab", { name: /As recorded/ });
  if (await dm.count()) {
    await scrollToEl(page, dm.first(), 140, 1300);
    await say(page, "debtMap", { wait: false });
    const d0 = Date.now();
    await page.waitForTimeout(VIDEO ? 1500 : 30);
    await click(page, dm.first());
    await page.waitForTimeout(VIDEO ? 2600 : 30);
    await click(page, page.getByRole("tab", { name: /Simplified/ }).first());
    await page.waitForTimeout(rest("debtMap", Date.now() - d0));
  }

  // 6. Pay by borrowing against BTC
  await glide(page, -3000, 900);
  await click(page, page.getByRole("link", { name: /^Pay$/ }).first());
  await page.getByRole("radio", { name: /Borrow against your BTC/ }).waitFor();
  await page.waitForTimeout(1200);
  await say(page, "settleIntro");
  await say(page, "trove", { wait: false });
  const t1 = Date.now();
  await click(page, page.getByRole("radio", { name: /Borrow against your BTC/ }));
  await page.getByText(/collateral ratio/).first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(rest("trove", Date.now() - t1));
  await scrollToEl(page, page.getByText(/collateral ratio/), 110, 1500);
  await say(page, "health");
  await shot(page, "desktop-settle-trove");
  await glide(page, -3000, 900);
  await say(page, "confirm", { wait: false });
  await click(page, page.getByRole("button", { name: /Review payment/ }));
  await page.waitForTimeout(VIDEO ? 2400 : 30);
  await click(page, page.getByRole("button", { name: /Borrow and pay/ }));
  await page.waitForTimeout(VIDEO ? 1500 : 30);
  await say(page, "verifying", { wait: false });
  const v0 = Date.now();
  await page.getByText("Payment confirmed", { exact: true }).waitFor({ timeout: 180_000 });
  await page.waitForTimeout(rest("verifying", Date.now() - v0));
  await say(page, "confirmed");
  await shot(page, "desktop-settle-confirmed");
  await click(page, page.getByRole("link", { name: /View receipt/ }));
  await page.waitForLoadState("load");
  await page.waitForTimeout(2000);
  await say(page, "receipt");
  await shot(page, "desktop-receipt");

  // 7. Wallet and trove
  await go(page, "/wallet");
  await page.getByText(/collateral ratio/).first().waitFor({ timeout: 30_000 });
  await say(page, "wallet");
  await say(page, "swap", { wait: false });
  const s0 = Date.now();
  await typeSlow(page, page.locator("#swap-in"), "0.0001");
  await page.getByText(/You receive about/).waitFor();
  await page.waitForTimeout(rest("swap", Date.now() - s0));
  await shot(page, "desktop-wallet");

  // 8. About and usage
  await go(page, "/about");
  await say(page, "about", { wait: false });
  const b0 = Date.now();
  await page.waitForTimeout(VIDEO ? 2500 : 30);
  await glide(page, 1600, VIDEO ? Math.max(2000, (clips.about?.ms ?? 6000) - 3200) : 100);
  await page.waitForTimeout(rest("about", Date.now() - b0));
  await go(page, "/stats");
  await say(page, "usage", { wait: false });
  const g0 = Date.now();
  await page.waitForTimeout(VIDEO ? 2000 : 30);
  await glide(page, 700, VIDEO ? Math.max(1500, (clips.usage?.ms ?? 4000) - 2600) : 100);
  await page.waitForTimeout(rest("usage", Date.now() - g0));
  await shot(page, "desktop-usage");
  await go(page, "/");
  await card(page, "Split the bill. Settle it in MUSD.", `Try it on Mezo testnet: ${BASE.replace(/^https?:\/\//, "")}`, "outro");

  // 9. Phone screenshots (separate context, not recorded)
  if (SHOTS) {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await injectWallet(phone, dave.account, { name: WALLET_NAME });
    await phone.addCookies((await context.cookies()).filter((c) => c.name === "musd_split_session"));
    const p = await phone.newPage();
    for (const [name, url] of [
      ["mobile-landing", "/"],
      ["mobile-dashboard", "/dashboard"],
      ["mobile-group", `/groups/${groupId}?tab=balances`],
      ["mobile-wallet", "/wallet"],
    ] as const) {
      await p.goto(BASE + url, { waitUntil: "load" });
      await p.waitForTimeout(2500);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 0) log(`WARNING ${name}: horizontal overflow ${overflow}px`);
      await p.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
    }
    await phone.close();
  }

  await context.close();
  await browser.close();
  log("transactions:", txs.map((h) => `https://explorer.test.mezo.org/tx/${h}`).join("  "));

  if (VIDEO) {
    const webm = readdirSync(RAW).find((f) => f.endsWith(".webm"));
    if (!webm) throw new Error("no video recorded");
    const out = path.join(VIDEO_DIR, "musd-split-demo.mp4");
    // mix every narration clip onto the video at the moment its caption appeared
    const inputs = ["-y", "-i", path.join(RAW, webm)];
    const parts: string[] = [];
    cues.forEach((c, i) => {
      inputs.push("-i", clips[c.key].file);
      const d = Math.max(0, c.at);
      parts.push(`[${i + 1}:a]aresample=48000,adelay=${d}|${d}[a${i}]`);
    });
    const mix = `${parts.join(";")};${cues.map((_, i) => `[a${i}]`).join("")}amix=inputs=${cues.length}:normalize=0:dropout_transition=0,volume=1.6[aout]`;
    execFileSync(
      FFMPEG,
      [...inputs, "-filter_complex", mix, "-map", "0:v", "-map", "[aout]", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out],
      { stdio: "ignore" },
    );
    writeFileSync(path.join(VIDEO_DIR, "narration.txt"), cues.map((c) => `[${(c.at / 1000).toFixed(1)}s] ${LINES[c.key]}`).join("\n") + "\n", "utf8");
    log(`video: ${out}`);
    if (existsSync(RAW)) rmSync(RAW, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
