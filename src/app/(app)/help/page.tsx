import type { Metadata } from "next";
import Link from "next/link";
import { CHAIN_ID, EXPLORER_URL, FAUCET_URL, MEZO_DOCS_URL, MEZO_TESTNET_APP_URL, explorerAddressUrl } from "@/config/chains";
import { MEZO_POOLS, MUSD, SETTLEMENT_CONTRACT } from "@/config/contracts";
import { MEZO_PROTOCOL } from "@/config/mezo";

export const metadata: Metadata = { title: "Help & about" };

const FAQ: Array<[string, React.ReactNode]> = [
  [
    "Does MUSD Split ever hold my money?",
    "No. Direct transfers go from your wallet to the other person's wallet. The optional settlement contract pulls MUSD from you and sends it straight to the recipient in the same transaction — it has no owner and never keeps a balance.",
  ],
  [
    "When does my balance change after I pay?",
    "Only after our server fetches the transaction receipt from Mezo testnet and checks it: the transaction succeeded, it's a MUSD transfer (or our contract's Settled event) from your wallet to the right person for the exact amount, and the transaction hash hasn't been used before. Until then the payment shows as pending.",
  ],
  [
    "What does “simplify debts” do?",
    "It replaces a tangle of who-owes-whom with the fewest payments that leave everyone with exactly the same final balance. Example: if Alice owes Bob 20 and Bob owes Charlie 20, Alice can pay Charlie 20 directly. It's a suggestion — nothing moves until a payer approves a payment.",
  ],
  [
    "How is rounding handled?",
    "Shares are calculated in whole cents (0.01 MUSD) with integer maths — never floating point. Leftover cents go to the person with the largest remainder; ties go to the payer first (they fronted the money), then by wallet address. Shares always add up to the exact total.",
  ],
  [
    "Can an expense be changed after someone paid?",
    "Yes, but payments are never rewritten. The change is stored as a new version with a reason and the exact balance change for each member, so everyone can audit what happened.",
  ],
  [
    "I paid but closed the page. Is my payment lost?",
    "No. The transaction hash is saved the moment your wallet broadcasts it. Open the payment from your dashboard to re-check it. If the page closed even earlier, use “Check chain for my payment” and we'll find the transfer on-chain.",
  ],
  [
    "How does “Borrow against your BTC” work?",
    "If you have a Mezo trove (BTC locked as collateral for MUSD), you can pay a friend without holding MUSD. You sign a WithdrawMUSD message for exactly that amount and that person, and send it through Mezo's BorrowerOperationsSignatures contract. Mezo mints the MUSD from your trove straight to them; your trove debt grows by the amount plus the protocol's 0.1% fee. Before you sign, the app shows your collateral ratio and liquidation price now and after paying. Our server confirms the payment only if the receipt shows Mezo's TroveUpdated event for your own trove and MUSD minted to the right person for the exact amount.",
  ],
  [
    "I don't have enough MUSD. What can I do?",
    "Three options, all on Mezo. Swap BTC or MEZO for the missing amount on Mezo Pools (the payment screen sizes the swap for you). Borrow it against your BTC if you have a trove. Or open a trove on the Wallet page: lock BTC and borrow MUSD. The smallest trove borrows 1,800 MUSD, so for small debts a swap is usually simpler.",
  ],
  [
    "What can liquidate my trove?",
    "If BTC's price falls until your collateral ratio drops below 110%, the trove can be liquidated and you lose the collateral backing it. The Wallet page shows the BTC price that would trigger this. Keep your ratio well above 150% and add BTC or repay if it gets close.",
  ],
  [
    "What is signing in with my wallet?",
    "You sign a plain-text message (Sign-In With Ethereum). It's free, moves no funds and can't authorise payments. We never ask for a seed phrase or private key.",
  ],
];

export default function HelpPage() {
  return (
    <div className="max-w-[880px]">
      <h1 className="font-display text-[34px] leading-tight font-semibold tracking-[-0.025em]">Help & about</h1>
      <p className="mt-2 max-w-[64ch] text-[15px] text-fg-muted">
        MUSD Split keeps a shared ledger of who paid for what, works out exactly who owes whom, and lets people settle up with real MUSD transfers on the Mezo network.
      </p>

      <section className="mt-10">
        <h2 className="font-display text-[22px] font-semibold">How to use it</h2>
        <ol className="mt-4 space-y-3 text-[14.5px] text-fg-muted">
          {[
            ["Get testnet funds", <>Get test BTC for gas from the <a className="text-blue-600 hover:underline" href={FAUCET_URL} target="_blank" rel="noreferrer">Mezo faucet</a>, then swap some for MUSD or open a trove on the <Link className="text-blue-600 hover:underline" href="/wallet">Wallet page</Link> (or at <a className="text-blue-600 hover:underline" href={MEZO_TESTNET_APP_URL} target="_blank" rel="noreferrer">testnet.mezo.org</a>).</>],
            ["Connect & sign in", "Connect an EVM wallet (MetaMask, Rabby…) and sign the one-time sign-in message."],
            ["Create a group & invite", "Create a group and share its invite link or QR code. Links can expire and be revoked."],
            ["Add expenses", "Record who paid and who took part. Split equally, by exact amounts, percentages or shares."],
            ["Settle in MUSD", "Pay a suggested settlement: a direct transfer, the duplicate-proof settlement contract, or borrow it against your BTC. The app verifies it on-chain."],
          ].map(([t, d], i) => (
            <li key={i} className="flex gap-4">
              <span className="num grid size-7 shrink-0 place-items-center rounded-full border border-line-strong text-[13px] text-fg">{i + 1}</span>
              <span>
                <span className="font-medium text-fg">{t}.</span> {d}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-[22px] font-semibold">Supported network</h2>
        <div className="surface mt-4 overflow-hidden rounded-[16px]">
          <table className="w-full text-[14px]">
            <tbody className="divide-y divide-line">
              {[
                ["Network", `Mezo testnet (chain id ${CHAIN_ID})`],
                ["RPC", "https://rpc.test.mezo.org"],
                ["Explorer", EXPLORER_URL],
                ["Gas token", "BTC (18 decimals)"],
                ["MUSD token", MUSD.address],
                ["MUSD Split settlement contract", SETTLEMENT_CONTRACT.address],
                ...Object.entries(MEZO_PROTOCOL).map(([k, v]) => [`Mezo ${k}`, v]),
                ["Mezo Pools router", MEZO_POOLS.router],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td className="w-[40%] px-5 py-3 text-fg-muted">{k}</td>
                  <td className="px-5 py-3 font-mono text-[12.5px] break-all">
                    {/^0x[0-9a-fA-F]{40}$/.test(v) ? (
                      <a href={explorerAddressUrl(v)} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                        {v}
                      </a>
                    ) : (
                      v
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[13px] text-fg-subtle">
          Network details verified against the{" "}
          <a href={MEZO_DOCS_URL} className="text-blue-600 hover:underline" target="_blank" rel="noreferrer">
            Mezo developer docs
          </a>
          .
        </p>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-[22px] font-semibold">Questions</h2>
        <div className="mt-4 space-y-2">
          {FAQ.map(([q, a]) => (
            <details key={q} className="surface group rounded-[var(--radius-card)] px-5 py-4">
              <summary className="cursor-pointer list-none text-[15px] font-medium marker:hidden">{q}</summary>
              <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section id="risks" className="mt-10 rounded-[var(--radius-panel)] border-2 border-fg p-6">
        <h2 className="font-display text-[20px] font-semibold text-fg">Risk disclosure</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-[14px] text-fg-muted">
          <li>This deployment runs on Mezo <strong className="text-fg">testnet</strong>. Testnet tokens have no monetary value and the network can be reset.</li>
          <li>Blockchain payments are irreversible. Always check the recipient address before you confirm in your wallet.</li>
          <li>MUSD is a stablecoin issued by the Mezo protocol against BTC collateral; its peg and the protocol carry their own risks.</li>
          <li>The settlement contract is small, tested and non-custodial, and was reviewed internally (see docs/SECURITY.md), but it has not had an external audit. Do not use this build with real funds.</li>
          <li>Borrowing against BTC creates a loan in the Mezo protocol. If BTC&apos;s price falls far enough, your trove can be liquidated. Interest accrues on the debt.</li>
          <li>Expense records are an agreement between group members, not a legal debt instrument.</li>
        </ul>
        <p className="mt-4 text-[13px] text-fg-subtle">
          See also <Link href="/legal" className="text-blue-600 hover:underline">terms & privacy</Link>.
        </p>
      </section>
    </div>
  );
}
