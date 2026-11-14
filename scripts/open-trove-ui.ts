/**
 * Opens a Mezo trove for the main wallet THROUGH THE APP'S UI (Wallet page -> "Open a trove"),
 * with a scripted testnet wallet — proves the open-trove path end to end on-chain.
 *
 *   BASE_URL=http://localhost:3000 npx tsx scripts/open-trove-ui.ts
 *
 * Wallet key: DAVE_ENV_FILE (default ./.env.deployer). Never printed.
 */
import path from "node:path";
import { chromium } from "playwright-core";
import { privateKeyToAccount } from "viem/accounts";
import { keyFromEnvFile } from "./lib/api-user";
import { injectWallet } from "./lib/demo-wallet";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const KEY_FILE = process.env.DAVE_ENV_FILE ?? path.resolve(__dirname, "../.env.deployer");

async function main() {
  const account = privateKeyToAccount(keyFromEnvFile(KEY_FILE));
  console.log(`wallet ${account.address}`);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const txs: string[] = [];
  await injectWallet(ctx, account, { name: "MUSD Split Demo Wallet", onTx: (h) => txs.push(h) });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60_000);
  await page.goto(BASE + "/wallet", { waitUntil: "load" });
  await page.getByRole("button", { name: /Connect wallet|Sign in with wallet/ }).first().click();
  const walletBtn = page.getByRole("button", { name: /MUSD Split Demo Wallet/ });
  await walletBtn.waitFor({ timeout: 4000 }).then(() => walletBtn.click()).catch(() => undefined);
  await page.getByRole("heading", { name: "Wallet and trove" }).waitFor({ timeout: 60_000 });
  await page.getByText("No Mezo trove yet").waitFor({ timeout: 60_000 });
  const amount = await page.locator("#open-amt").inputValue();
  const coll = (await page.locator("dt", { hasText: "BTC to lock" }).locator("xpath=following-sibling::dd").innerText()).trim();
  console.log(`opening trove via UI: borrow ${amount} MUSD, lock ${coll}`);
  await page.getByRole("button", { name: "Lock BTC and borrow" }).click();
  await page.getByText("Trove opened", { exact: true }).waitFor({ timeout: 240_000 });
  await page.waitForTimeout(3000);
  await page.reload({ waitUntil: "load" });
  await page.getByText(/collateral ratio/).first().waitFor({ timeout: 60_000 });
  const ratio = await page.locator("span.font-display").filter({ hasText: "%" }).first().innerText();
  console.log(`trove open, collateral ratio ${ratio}`);
  await page.screenshot({ path: path.resolve(__dirname, "../docs/screenshots/desktop-trove-opened.png") });
  console.log("transactions:", txs.map((h) => `https://explorer.test.mezo.org/tx/${h}`).join("  "));
  await browser.close();
}

main().catch((e) => {
  console.error(String(e?.message ?? e).split("\n").slice(0, 4).join("\n"));
  process.exit(1);
});
