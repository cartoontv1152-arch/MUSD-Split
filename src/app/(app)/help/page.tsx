import type { Metadata } from "next";
import Link from "next/link";
import { CHAIN_ID, EXPLORER_URL, FAUCET_URL, MEZO_DOCS_URL, MEZO_TESTNET_APP_URL, explorerAddressUrl } from "@/config/chains";
import { MEZO_PROTOCOL_TESTNET, MUSD, SETTLEMENT_CONTRACT } from "@/config/contracts";

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
            ["Get testnet funds", <>Get test BTC for gas from the <a className="text-violet-300 hover:underline" href={FAUCET_URL} target="_blank" rel="noreferrer">Mezo faucet</a>, then borrow MUSD against it at <a className="text-violet-300 hover:underline" href={MEZO_TESTNET_APP_URL} target="_blank" rel="noreferrer">testnet.mezo.org</a>.</>],
            ["Connect & sign in", "Connect an EVM wallet (MetaMask, Rabby…) and sign the one-time sign-in message."],
            ["Create a group & invite", "Create a group and share its invite link or QR code. Links can expire and be revoked."],
            ["Add expenses", "Record who paid and who took part. Split equally, by exact amounts, percentages or shares."],
            ["Settle in MUSD", "Pay a suggested settlement. Choose a direct transfer or the duplicate-proof settlement contract; the app verifies it on-chain."],
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
                ...Object.entries(MEZO_PROTOCOL_TESTNET).map(([k, v]) => [`Mezo ${k}`, v]),
              ].map(([k, v]) => (
                <tr key={k}>
                  <td className="w-[40%] px-5 py-3 text-fg-muted">{k}</td>
                  <td className="px-5 py-3 font-mono text-[12.5px] break-all">
                    {/^0x[0-9a-fA-F]{40}$/.test(v) ? (
                      <a href={explorerAddressUrl(v)} target="_blank" rel="noreferrer" className="text-cyan-300 hover:underline">
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
          <a href={MEZO_DOCS_URL} className="text-violet-300 hover:underline" target="_blank" rel="noreferrer">
            Mezo developer docs
          </a>
          .
        </p>
      </section>

      <section className="mt-10">
        <h2 className="font-display text-[22px] font-semibold">Questions</h2>
        <div className="mt-4 space-y-2">
          {FAQ.map(([q, a]) => (
            <details key={q} className="surface group rounded-[14px] px-5 py-4">
              <summary className="cursor-pointer list-none text-[15px] font-medium marker:hidden">{q}</summary>
              <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section id="risks" className="mt-10 rounded-[16px] border border-amber-400/30 bg-amber-400/6 p-6">
        <h2 className="font-display text-[20px] font-semibold text-amber-200">Risk disclosure</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-[14px] text-fg-muted">
          <li>This deployment runs on Mezo <strong className="text-fg">testnet</strong>. Testnet tokens have no monetary value and the network can be reset.</li>
          <li>Blockchain payments are irreversible. Always check the recipient address before you confirm in your wallet.</li>
          <li>MUSD is a stablecoin issued by the Mezo protocol against BTC collateral; its peg and the protocol carry their own risks.</li>
          <li>The settlement contract is small, tested and non-custodial, but it has not been audited. Do not use this build with real funds.</li>
          <li>Expense records are an agreement between group members, not a legal debt instrument.</li>
        </ul>
        <p className="mt-4 text-[13px] text-fg-subtle">
          See also <Link href="/legal" className="text-violet-300 hover:underline">terms & privacy</Link>.
        </p>
      </section>
    </div>
  );
}
