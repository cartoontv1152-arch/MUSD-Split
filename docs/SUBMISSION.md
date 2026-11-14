# AKINDO WaveHack: Mezo Buildathon, Wave 2 submission answers

Ready to paste. Team details are left for you to fill in.

---

**Project name**
MUSD Split

**One-line description**
Split the bill, settle it in MUSD on Mezo: pay with MUSD you hold, swap BTC for it on Mezo Pools, or borrow it against your BTC at the moment you pay, with every payment verified on-chain.

**Live app**
https://musd-split.vercel.app (Mezo testnet, chain 31611)

**Demo video**
`docs/demo/musd-split-demo.mp4` in the repository: a narrated walkthrough of the live site. Upload it (YouTube or Loom) wherever the form asks for a video link.

**GitHub**
_(your repository URL)_

**Contracts**
- MUSDSplitSettlement (ours, v3, source verified): https://explorer.test.mezo.org/address/0x07A97685C16fCd717a66c7cCf974fFfB6f8c2607
- MUSD: https://explorer.test.mezo.org/address/0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503
- Mezo contracts used: BorrowerOperations, BorrowerOperationsSignatures, TroveManager, PriceFeed, SortedTroves, InterestRateManager and the Mezo Pools router (addresses in the README).

---

**What problem does it solve?**
Shared costs are easy to write down and hard to settle. Groups lose time to working out who owes whom, chasing payments and arguing about whether money arrived. Bitcoin holders have an extra problem: paying a friend back usually means selling BTC first.

**How does it work?**
A group records expenses with four split methods, exact to the cent. The app works out the fewest payments that settle everyone. Each payment is made in MUSD on Mezo, in one of three ways:
1. **Pay with MUSD you hold.** Either a direct transfer, or our non-custodial settlement contract: one EIP-2612 permit signature plus one transaction, with a payment id that can't be paid twice.
2. **Swap for exactly what you're missing.** BTC or MEZO is swapped to MUSD on Mezo Pools, right on the payment screen.
3. **Borrow against your BTC and pay in one step.** The debtor signs a `WithdrawMUSD` message and Mezo's BorrowerOperationsSignatures mints the MUSD from their trove straight to the creditor. Before signing, the app shows the trove's collateral ratio and liquidation price now and after paying.

Our server fetches every transaction receipt itself and checks the sender, the recipient, the exact amount, the official token and the protocol events before any balance changes.

**How does it use Mezo / MUSD? (Integration)**
- MUSD is the only unit of account. Every balance and payment is in MUSD.
- **Mezo protocol, not just the token.** Borrow-and-pay through `BorrowerOperationsSignatures.withdrawMUSDWithSignature`, verified by the protocol's own `TroveUpdated` event for the payer's trove plus the MUSD mint to the creditor.
  - Open a trove, borrow, add BTC and repay through `BorrowerOperations`, with `SortedTroves.findInsertPosition` hints.
  - Live trove health from `TroveManager` and `PriceFeed`, with accrued interest included.
- **Mezo Pools.** In-app BTC/MEZO → MUSD swaps through the router, sized to the shortfall, with an exact-amount approval of the BTC ERC-20 precompile and slippage protection.
- **EIP-2612 permit** for one-transaction contract settlement and batch settlement.
- Mezo specifics handled: explicit gas floors because RPC estimates run low, `eth_getLogs` read in chunks, EVM `london` with no `mcopy`, and BTC kept back for gas.

**What did you build in Wave 2?**
- **The Mezo-native rails the judges asked for:**
  - borrow-against-BTC payments, minted straight to the creditor;
  - a trove dashboard (open, borrow, add BTC, repay);
  - trove health on the payment screen and dashboard;
  - in-app Mezo Pools swaps.
- **Settlement contract verified on the explorer.** Redeployed from the team's main key (v3) and source-verified, along with v1 and v2.
- **Security review** (`docs/SECURITY.md`). Nine app issues fixed with regressions where possible, for example:
  - rejected hashes could be blacklisted forever;
  - a transaction landing after a cancel was lost;
  - "Payment not sent" was shown after a broadcast;
  - an admin role came back on rejoin.
- **New design:** three colours (blue, black, white), plain-English copy, phone-first layouts.
- **About page** with business model and roadmap; a public **Usage page** that keeps team test activity separate from real users.
- **Tested end to end on production:** 53/53 core and 16/16 Mezo live checks with real testnet transactions. Also 129 unit tests, 28 contract tests, a browser tour with real clicks, and opening a trove through the UI.

**Business model**
Splitting, and paying with MUSD you hold, stay free. Revenue comes from:
- an interface fee on borrow-and-pay (MUSD we originate);
- a routing fee on in-app swaps;
- *Group Pro* for households and clubs that share costs monthly (recurring bills, exports, admin controls);
- business accounts for co-living and travel operators.

All of it starts at mainnet launch, after an external audit.

**Traction**
Honest status: so far every group was created by the team's test wallets. The public Usage page (https://musd-split.vercel.app/stats) says so and will count the first outside group automatically. Next step: onboard real groups (flatmates, travel groups) on testnet.

**Tech stack**
Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, wagmi 2 + viem 2, TanStack Query, Neon Postgres, zod, jose (SIWE sessions), Vitest, Hardhat 2 + OpenZeppelin 5, Playwright, Vercel (Fluid compute, Cron, Analytics).

**Challenges**
- **Verifying a borrowed payment without trusting the client.** The MUSD comes from a mint (`0x0`), not from the payer, so the proof has two parts: the protocol's `TroveUpdated` event for the payer's own trove, plus the exact mint to the creditor. Nine unit tests and a live negative test cover it.
- **Mezo's public RPC quirks:** low gas estimates and occasional `null` receipts. We added gas floors, receipt retries and a Blockscout fallback.
- **Getting the trove maths exact,** including interest accrued since the last update, so the ratio shown matches `getCurrentICR`.

**Team**
_(fill in: names, roles, links)_

---

# AKINDO form fields (Wave 2 submit page)

**Product Category** (max 3)
Payments, Consumer App, DeFi

**Updates in this Wave** (2,372 / 3,000 characters)

```text
Wave 2 follows the Wave 1 feedback: use Mezo itself, not just the MUSD token; verify the contract; keep test wallets apart from real users; add a team section and a revenue model.

Live app: https://musd-split.vercel.app (Mezo testnet, chain 31611)

1. Borrow against BTC and pay (new). A payer who is short on MUSD signs one WithdrawMUSD message. Mezo's BorrowerOperationsSignatures.withdrawMUSDWithSignature then mints the MUSD from their trove straight to the person they owe. Before they sign, the payment screen shows the trove's collateral ratio and liquidation price now and after paying. The debt only clears once our server has checked the receipt:
- the tx went to BorrowerOperationsSignatures;
- the protocol's TroveUpdated event names the payer's trove;
- MUSD was minted to the creditor for the exact amount.

2. Trove dashboard (new): https://musd-split.vercel.app/wallet
Open a trove, borrow, add BTC and repay through BorrowerOperations, using SortedTroves hints. Live health comes from TroveManager and PriceFeed and includes interest accrued since the last update, with 110% and 150% markers.

3. Swap for the shortfall (new). On the payment screen, BTC or MEZO is swapped on Mezo Pools for exactly the missing MUSD. The approval covers only that amount, slippage is capped at 1%, and some BTC is kept back for gas.

4. Contract verified. The settlement contract was redeployed as v3 and its source is verified on the explorer: https://explorer.test.mezo.org/address/0x07A97685C16fCd717a66c7cCf974fFfB6f8c2607 (v1 and v2 are verified too).

5. Security review (docs/SECURITY.md). Nine app issues fixed, including:
- a rejected tx hash was blocked forever;
- a payment that landed after a cancel was lost;
- "Payment not sent" was shown after a broadcast;
- an old admin role came back on rejoin.

6. New design: blue, black and white only, plain-English copy, phone-first navigation.

7. Business model, audience and roadmap: https://musd-split.vercel.app/about

8. Public usage page: https://musd-split.vercel.app/stats
It counts team test wallets separately from real users. So far every group was created by our test wallets, and the page says so.

9. Tested on production:
- 53/53 core and 16/16 Mezo end-to-end checks with real testnet transactions;
- 129 unit tests and 28 contract tests;
- a browser tour with real clicks;
- a narrated demo video.
```

**Milestone: 3rd Wave**

```text
Real users and safer troves.
- Onboard at least 10 groups from outside the team on testnet (flatmates, travel groups, the Mezo community). Progress shows publicly on https://musd-split.vercel.app/stats.
- Trove safety alerts: warn payers in the app and by email when their trove ratio falls toward 150%, and before a borrow-and-pay would take it below that.
- Repay from what you receive: MUSD that friends pay you can go straight to repaying your trove.
- Email and push reminders for unpaid debts, shareable read-only group summaries, and an installable mobile app (PWA).
- A second round of review on the settlement contract.
```

**Milestone: 4th Wave**

```text
Mainnet readiness and first revenue.
- External audit of the settlement contract, with every finding fixed and published.
- Launch on Mezo mainnet with real MUSD, Mezo troves and Mezo Pools.
- Switch on the revenue model: an interface fee on borrow-and-pay and a routing fee on in-app swaps, both shown before the user confirms.
- Group Pro beta for households and clubs: recurring bills, accounting exports and admin controls.
- Target: 25 active groups and 100 verified MUSD payments, tracked on the public usage page.
```
