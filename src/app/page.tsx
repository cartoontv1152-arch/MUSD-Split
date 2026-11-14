import Link from "next/link";
import { ArrowLeftRight, BadgeCheck, CalendarClock, FileDown, Landmark, Layers, Link2, Receipt, Scale, Split, Undo2, Users, Wallet } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { Hero } from "@/components/landing/hero";
import { LiveStrip } from "@/components/landing/live-strip";
import { NetworkBadge } from "@/components/shell/app-shell";
import { WalletMenu } from "@/components/wallet/wallet-menu";
import { explorerAddressUrl } from "@/config/chains";
import { MEZO_POOLS, MUSD, SETTLEMENT_CONTRACT } from "@/config/contracts";
import { MEZO_PROTOCOL } from "@/config/mezo";

const STEPS = [
  ["Create a group", "Start a group for the trip, the flat or Friday dinners. Share an invite link or QR code; links can expire and be revoked."],
  ["Record expenses", "Say who paid and who took part. Split equally, by exact amounts, percentages or shares, and see the breakdown before you save."],
  ["See who owes whom", "Balances update instantly. One tap turns the tangle into the fewest payments that leave everyone square."],
  ["Settle in MUSD", "Pay from your wallet. The server checks the transaction on Mezo before your debt clears, and keeps the receipt."],
] as const;

const PAY = [
  {
    Icon: Wallet,
    title: "Send MUSD you already hold",
    body: "A direct MUSD transfer, or our settlement contract with an EIP-2612 permit: one free signature and one transaction, with a payment id that can never be used twice.",
    contract: ["MUSD token", MUSD.address],
    extra: ["Settlement contract", SETTLEMENT_CONTRACT.address],
  },
  {
    Icon: ArrowLeftRight,
    title: "Swap BTC for exactly what you owe",
    body: "Short on MUSD? Swap BTC or MEZO for the missing amount on Mezo Pools without leaving the payment screen, then pay. Fresh from the faucet to paid in about a minute.",
    contract: ["Mezo Pools router", MEZO_POOLS.router],
  },
  {
    Icon: Landmark,
    title: "Borrow against your BTC and pay",
    body: "Have a Mezo trove? Sign once and the protocol mints MUSD from your BTC-backed credit line straight to your friend. You see your collateral ratio before and after.",
    contract: ["BorrowerOperations", MEZO_PROTOCOL.BorrowerOperations],
    extra: ["BorrowerOperationsSignatures", MEZO_PROTOCOL.BorrowerOperationsSignatures],
  },
] as const;

const CHECKS = [
  "The transaction succeeded on Mezo (chain 31611)",
  "It was sent by the person who owes, never someone else",
  "A Transfer log from the official MUSD token, to the right person, for the exact amount",
  "Contract payments: a matching Settled event and a never-used payment id",
  "Borrowed payments: a TroveUpdated event for the payer's own trove, minted straight to the creditor",
  "It happened after the payment was started, and backs exactly one payment",
];

const FEATURES: Array<[typeof Split, string, string]> = [
  [Split, "Four split methods", "Equal, exact amounts, percentages and shares. Excluded members are never charged."],
  [Scale, "Exact to the cent", "Integer maths only. Leftover cents follow a published rule, so shares always add up to the total."],
  [Undo2, "Auditable changes", "Edits after a payment become recorded adjustments with a reason. Paid history is never rewritten."],
  [CalendarClock, "Recurring bills", "Rent and subscriptions are added on schedule with reminders. No money moves on its own."],
  [Layers, "Settle everything at once", "Pay every person you owe in a group in one transaction."],
  [Link2, "Payment requests", "Ask someone to pay. A request is marked paid only by a verified payment."],
  [Receipt, "Receipts", "Attach photos or PDFs, visible only to the group. Print a receipt for any payment."],
  [FileDown, "Activity and export", "A timeline with transaction links, notifications and CSV export."],
  [Users, "Roles", "Owners, admins and members. Outsiders can't read or change a group."],
];

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="sticky top-0 z-30 border-b border-line bg-paper">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="MUSD Split home">
            <Wordmark />
          </Link>
          <nav className="ml-6 hidden gap-6 text-[14px] text-fg-muted md:flex" aria-label="Landing">
            <a href="#pay" className="hover:text-fg">
              Ways to pay
            </a>
            <a href="#verified" className="hover:text-fg">
              Verification
            </a>
            <Link href="/about" className="hover:text-fg">
              About
            </Link>
            <Link href="/stats" className="hover:text-fg">
              Usage
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden sm:inline-flex">
              <NetworkBadge compact />
            </span>
            <WalletMenu />
          </div>
        </div>
      </header>
      <main>
        <Hero />
        <LiveStrip />

        <section id="pay" className="mx-auto max-w-[1240px] scroll-mt-16 px-4 py-20 sm:px-6">
          <h2 className="max-w-[24ch] font-display text-[32px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[40px]">Three ways to pay a friend, all on Mezo</h2>
          <p className="mt-4 max-w-[62ch] text-[16px] leading-relaxed text-fg-muted">
            MUSD is Bitcoin-backed money. You can pay with MUSD you hold, swap for it, or borrow it against your BTC at the moment you pay.
          </p>
          <div className="mt-10 grid gap-px overflow-hidden rounded-[var(--radius-panel)] border border-line bg-line lg:grid-cols-3">
            {PAY.map(({ Icon, title, body, contract, ...rest }) => (
              <article key={title} className="flex flex-col bg-paper p-6">
                <Icon className="size-6 text-blue-600" aria-hidden="true" />
                <h3 className="mt-5 font-display text-[20px] font-semibold tracking-[-0.015em]">{title}</h3>
                <p className="mt-2 flex-1 text-[14.5px] leading-relaxed text-fg-muted">{body}</p>
                <dl className="mt-6 space-y-1 border-t border-line pt-4 text-[12.5px]">
                  {[contract, "extra" in rest ? rest.extra : null].filter(Boolean).map((c) => (
                    <div key={c![1]} className="flex justify-between gap-3">
                      <dt className="text-fg-subtle">{c![0]}</dt>
                      <dd>
                        <a href={explorerAddressUrl(c![1])} target="_blank" rel="noreferrer" className="font-mono text-blue-600 hover:underline">
                          {short(c![1])}
                        </a>
                      </dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        </section>

        <section id="how" className="border-t border-line">
          <div className="mx-auto max-w-[1240px] px-4 py-20 sm:px-6">
            <h2 className="max-w-[20ch] font-display text-[32px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[40px]">From the bill to a verified payment</h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-4 md:gap-6">
              {STEPS.map(([title, body], i) => (
                <li key={title} className="border-t-2 border-fg pt-4">
                  <div className="num font-display text-[15px] font-semibold text-blue-600">Step {i + 1}</div>
                  <h3 className="mt-3 font-display text-[19px] font-semibold">{title}</h3>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-fg-muted">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="verified" className="scroll-mt-16 bg-black text-white">
          <div className="mx-auto grid max-w-[1240px] gap-10 px-4 py-20 sm:px-6 md:grid-cols-[1fr_1.1fr]">
            <div>
              <h2 className="font-display text-[32px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[40px]">An expense isn&apos;t a payment. We keep them apart.</h2>
              <p className="mt-5 max-w-[50ch] text-[15.5px] leading-relaxed text-white/75">
                Expenses record what the group agreed was spent. Payments record MUSD that actually moved on Mezo. A debt only shrinks when the server has fetched the
                transaction receipt itself and checked every one of these:
              </p>
            </div>
            <ul className="divide-y divide-white/15 border-y border-white/15 text-[15px]">
              {CHECKS.map((t) => (
                <li key={t} className="flex items-start gap-3 py-3.5">
                  <BadgeCheck className="mt-0.5 size-5 shrink-0 text-white" aria-hidden="true" />
                  <span className="text-white/90">{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-[1240px] px-4 py-20 sm:px-6">
          <h2 className="font-display text-[28px] font-semibold tracking-[-0.025em]">Everything a shared ledger needs</h2>
          <ul className="mt-8 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(([Icon, t, d]) => (
              <li key={t} className="flex gap-4">
                <Icon className="mt-0.5 size-5 shrink-0 text-blue-600" aria-hidden="true" />
                <div>
                  <div className="text-[15px] font-medium text-fg">{t}</div>
                  <p className="mt-1 text-[14px] leading-relaxed text-fg-muted">{d}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-4 py-10 text-[13px] text-fg-subtle sm:px-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-[56ch] space-y-3">
            <Wordmark />
            <p>
              Testnet software: MUSD on Mezo testnet has no monetary value. Blockchain payments can&apos;t be reversed. The settlement contract has been reviewed
              but not externally audited.{" "}
              <Link href="/help#risks" className="text-blue-600 hover:underline">
                Read the risk disclosure
              </Link>
              .
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Footer">
            <Link href="/dashboard" className="hover:text-fg">
              Dashboard
            </Link>
            <Link href="/about" className="hover:text-fg">
              About and business model
            </Link>
            <Link href="/stats" className="hover:text-fg">
              Usage
            </Link>
            <Link href="/help" className="hover:text-fg">
              Help
            </Link>
            <Link href="/legal" className="hover:text-fg">
              Terms and privacy
            </Link>
            <a href="https://mezo.org/docs/developers/" target="_blank" rel="noreferrer" className="hover:text-fg">
              Mezo docs
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
