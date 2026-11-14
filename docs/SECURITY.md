# Security review — MUSD Split (Wave 2)

Reviewed 2026-11-14. Scope: the `MUSDSplitSettlement` contract, the server's payment verification and
authorization, and the new Mezo integrations (trove borrow-and-pay, Mezo Pools swaps).
This is an internal review, not an external audit. Do not use this build with real funds.

## 1. Settlement contract

`contracts/contracts/MUSDSplitSettlement.sol`, Solidity 0.8.28, EVM `london`, optimizer 200.

| Deployment | Address | Deployer | Source |
|---|---|---|---|
| **v2 (live)** | [`0x2deedDE2CA49d0B32D4f523DFf66Fc1EDe66C48e`](https://explorer.test.mezo.org/address/0x2deedDE2CA49d0B32D4f523DFf66Fc1EDe66C48e) · [deploy tx](https://explorer.test.mezo.org/tx/0x8465ecac6a9d39499ca9149e5ec72855a7c5e3f35330d384b8d42ac08ef5bed7) | `0x09596B22…56EC` | verified on Blockscout (standard JSON input) |
| v1 (retired) | [`0x2d2F5788…2602`](https://explorer.test.mezo.org/address/0x2d2F57887fA5a970344CeA9f1176BB761aFc2602) | `0x10ac9924…B628` | verified on Blockscout |

v2 has identical bytecode to v1. It was redeployed from a new deployer key; no payments were in flight at the switch, and v1 payments stay valid history.

### Function review

| Function | Money path | Checks |
|---|---|---|
| `settle(id, to, amount)` | `transferFrom(msg.sender → to)` | id ≠ 0, `to` ∉ {0, payer, contract, token}, amount > 0, payer-scoped id unused |
| `settleWithPermit(…)` | permit, then as above | permit is wrapped in try/catch, so a front-run permit can't block the payment |
| `settleBatch(ids, tos, amounts)` | one `transferFrom` per item | 1–32 items, equal lengths, all-or-nothing |
| `settleBatchWithPermit(…)` | one permit for the checked-arithmetic total | same as batch |

Properties that hold:
- **Never custodial.** MUSD moves payer → creditor inside the call. The contract has no balance, no owner, no admin, no upgrade path and no fee.
- **Can't spend someone else's money.** `from` is always `msg.sender`; a leftover allowance can only be spent by its owner.
- **No griefing of settlement ids.** Keys are `keccak256(payer, id)`, so another wallet can't burn your id.
- **Reentrancy.** `nonReentrant` on every entry point, plus checks → effects → interaction order. Covered by the `ReentrantToken` test.

### Findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| C-1 | Informational | Permit front-running: anyone can submit a payer's permit first. | By design: try/catch, then `transferFrom` succeeds on the allowance the permit already set. Test: *"front-run permit"*. |
| C-2 | Informational | The contract accepts any recipient. | By design. The server only confirms a payment whose `Settled` event matches the intent's recipient and amount. |
| C-3 | Informational | Immutable, with no pause. | Accepted. A bug fix means a redeploy (as with v2), and the app's config holds a single address. |

**28 / 28** Hardhat tests pass (`npm run contracts:test`).

### What a contract can't prevent
- A user confirming a payment to the wrong address. The UI shows the full address and asks for a check before signing.
- Phishing sites that imitate the app.
- MUSD peg or Mezo protocol risk, including trove liquidation when BTC falls.
- Wrong expense data. The ledger is an off-chain agreement between members.

## 2. Payment verification (server)

The server never trusts the client. It fetches every receipt itself (Mezo RPC, with Blockscout as fallback) and checks it in `src/lib/chain/verify.ts`, a pure, unit-tested module.

| Rail | Tx target | Proof required |
|---|---|---|
| Direct | MUSD token | `Transfer(payer → creditor, exact amount)` from the official token; sent by the payer; mined after the intent |
| Contract / batch | MUSDSplitSettlement | `Settled(id, payer, creditor, amount)` for this intent's id, plus the matching MUSD `Transfer` |
| **Trove borrow-and-pay (new)** | Mezo `BorrowerOperationsSignatures` | `TroveUpdated(_borrower = payer)` emitted by Mezo `BorrowerOperations`; MUSD `Transfer(0x0 → creditor, exact amount)`; sent by the payer; mined after the intent |

Nine unit tests cover the trove rail, including:
- someone else's trove;
- a fake `TroveUpdated` emitted from another contract;
- a mint to the payer instead of the creditor;
- a short amount;
- a look-alike token;
- the wrong sender;
- a transaction older than the intent;
- a reverted transaction.

The live e2e run also proves that a borrow minted to the payer is rejected (`scripts/e2e-mezo.ts`).

## 3. Application findings fixed in this review

| ID | Severity | Finding | Fix | Regression |
|---|---|---|---|---|
| A-1 | Medium | A transaction hash rejected once was blacklisted forever. A hash that was squatted, or submitted to the wrong intent, could never back the real payment. | Only *accepted* hashes count as used; partial unique indexes still prevent double use. | e2e: rejected/negative cases, then a valid payment |
| A-2 | Medium | A transaction mined after its intent was cancelled or superseded (for example in a second tab, or by "settle everything") could never be attached, so MUSD moved but the debt stayed. | `submit` and `recover` accept attempts cancelled before any hash was recorded. `createBatch` scans the chain for unsent attempts before superseding them. | — |
| A-3 | Medium | If saving the hash failed *after* the wallet broadcast, the UI said "Payment not sent", which invited a double payment. | The save is retried. After a broadcast the UI never says "not sent"; it opens the payment page, which has *Check again* and *Find my payment on-chain*. Applied to single and batch payments. | manual and UI tour |
| A-4 | Medium | A removed admin or owner who rejoined through an invite got their old role back. | Rejoining always resets the role to `member`. | — |
| A-5 | Low | A direct payment intent created while the RPC was down had no block binding, so an older unused transfer could be claimed. | Block-bound methods (direct, trove) refuse to start without a block (503). | — |
| A-6 | Low | Invalid ids (non-UUID) and impossible dates (`2025-02-30`) caused Postgres 500s. | Strict UUID checks on every id; dates are validated by round-trip. | `tests/server/validation.test.ts` |
| A-7 | Low | Invites to archived groups could still be accepted. | 410 `GROUP_ARCHIVED`. | — |
| A-8 | Low | A payment request linked to a since-deleted expense couldn't be paid. | Unknown request expense ids are dropped instead of blocking the payment. | — |
| A-9 | Low (UX) | A wallet that had already authorised the site reconnected silently, so "Connect" then failed with "Connector already connected". | "Connect" goes straight to signing in when a wallet is connected, and the modal treats "already connected" as success. | UI tour |

## 4. Mezo integration safety
- **Trove actions** (borrow, add BTC, repay, open, borrow-and-pay) are signed by the user in their wallet. The app never holds keys.
- Before anything is signed, the UI previews the collateral ratio and liquidation price after the action, refuses amounts that would cross 110% (150% in recovery mode), and suggests 150% as a safe floor.
- **Hints** for `SortedTroves` are computed with `findInsertPosition` as a read call. Wrong hints only cost gas; the protocol re-finds the position.
- **Swaps** approve the *exact* input amount to the Mezo Pools router (never unlimited), keep 0.00002 BTC back for gas, use 1% slippage protection, and set a 20-minute deadline from chain time.
- **Gas:** every write passes an explicit limit, `max(estimate × 1.3, floor)`, because the public RPC sometimes under-estimates.

## 5. Keys and secrets
- No key is stored in the repository or deployed. Deployer and test-wallet keys are read at runtime from gitignored `.env*` files.
- `.vercelignore` excludes `.env*`, scripts, contracts and docs.
- Sessions are HttpOnly, Secure, SameSite=Lax HS256 JWTs. Cookie-authenticated mutations check `Origin`.
