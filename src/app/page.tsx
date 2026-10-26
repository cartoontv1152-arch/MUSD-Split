import Link from "next/link";
import { BadgeCheck, CalendarClock, FileDown, Layers, Link2, Receipt, ScanSearch, Scale, ShieldCheck, Split, Undo2, Users } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { Hero } from "@/components/landing/hero";
import { LiveStrip } from "@/components/landing/live-strip";
import { NetworkBadge } from "@/components/shell/app-shell";
import { WalletMenu } from "@/components/wallet/wallet-menu";

const STEPS = [
  ["Create a group", "Start a group for the trip, the flat or Friday dinners, and share an invite link or QR code. Links can expire and be revoked."],
  ["Record expenses", "Say who paid and who took part. Split equally, by exact amounts, percentages or shares — the breakdown is shown before you save."],
  ["See who owes whom", "Balances update instantly. One tap simplifies the tangle into the fewest payments that leave everyone square."],
  ["Settle in MUSD", "Pay from your wallet. The server checks the transaction on Mezo before your debt is cleared, and keeps the receipt."],
] as const;

const FEATURES: Array<{ title: string; items: Array<[typeof Split, string, string]> }> = [
  {
    title: "Splitting that adds up",
    items: [
      [Split, "Four split methods", "Equal, exact amounts, percentages and shares, with excluded members never charged."],
      [Scale, "Exact to the cent", "Integer maths only. Leftover cents are assigned by a published rule, so shares always sum to the total."],
      [Undo2, "Auditable changes", "Edits after a payment become recorded adjustments with a reason. Settled history is never rewritten."],
      [CalendarClock, "Recurring bills", "Rent and subscriptions are added on schedule with reminders — no money moves automatically."],
    ],
  },
  {
    title: "Settlement you can verify",
    items: [
      [BadgeCheck, "Real MUSD transfers", "Direct ERC-20 transfers of MUSD on Mezo testnet, with explicit gas and live status."],
      [ShieldCheck, "Duplicate-proof contract", "Optional non-custodial contract: one permit signature, one transaction, and a settlement id that can't be paid twice."],
      [Layers, "Settle everything at once", "Pay every creditor in a group in a single batch transaction."],
      [ScanSearch, "Server-side verification", "Receipt status, token, sender, recipient and amount are checked on-chain. Pending never counts as paid."],
    ],
  },
  {
    title: "Everyone stays in sync",
    items: [
      [Users, "Groups & roles", "Membership checks on every action. Outsiders can't read or change a group."],
      [Link2, "Requests", "Ask someone to pay; it's marked paid only by a verified transfer."],
      [Receipt, "Receipts", "Attach photos or PDFs, visible only to the group, and print settlement receipts."],
      [FileDown, "Activity & export", "A full timeline with transaction links, notifications and CSV export."],
    ],
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line/60 bg-ink-900/75 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="MUSD Split home">
            <Wordmark />
          </Link>
          <nav className="ml-6 hidden gap-6 text-[14px] text-fg-muted md:flex" aria-label="Landing">
            <a href="#how" className="hover:text-fg">
              How it works
            </a>
            <a href="#features" className="hover:text-fg">
              Features
            </a>
            <Link href="/help" className="hover:text-fg">
              Help
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

        <section id="how" className="mx-auto max-w-[1240px] px-4 py-20 sm:px-6">
          <h2 className="max-w-[20ch] font-display text-[34px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[42px]">From the bill to a verified payment</h2>
          <ol className="mt-12 grid gap-px overflow-hidden rounded-[18px] border border-line bg-line md:grid-cols-4">
            {STEPS.map(([title, body], i) => (
              <li key={title} className="bg-ink-850 p-6">
                <div className="num font-display text-[15px] text-violet-300">{String(i + 1).padStart(2, "0")}</div>
                <h3 className="mt-6 font-display text-[19px] font-semibold">{title}</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-fg-muted">{body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="features" className="border-t border-line bg-ink-950/40">
          <div className="mx-auto max-w-[1240px] px-4 py-20 sm:px-6">
            <div className="grid gap-14 lg:grid-cols-3 lg:gap-10">
              {FEATURES.map((col) => (
                <div key={col.title}>
                  <h2 className="font-display text-[24px] font-semibold tracking-[-0.02em]">{col.title}</h2>
                  <ul className="mt-6 space-y-6">
                    {col.items.map(([Icon, t, d]) => (
                      <li key={t} className="flex gap-4">
                        <Icon className="mt-0.5 size-5 shrink-0 text-cyan-300" aria-hidden="true" />
                        <div>
                          <div className="text-[15px] font-medium text-fg">{t}</div>
                          <p className="mt-1 text-[14px] leading-relaxed text-fg-muted">{d}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1240px] px-4 py-20 sm:px-6">
          <div className="surface-raised grid gap-8 rounded-[22px] p-8 md:grid-cols-[1.2fr_1fr] md:p-12">
            <div>
              <h2 className="font-display text-[30px] leading-tight font-semibold tracking-[-0.025em]">An expense isn&apos;t a payment. We keep them apart.</h2>
              <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-fg-muted">
                Expenses record what the group agreed was spent. Settlements record MUSD that actually moved on Mezo. A debt is only cleared when a settlement is
                verified from its on-chain receipt — and each transaction can back exactly one payment.
              </p>
            </div>
            <ul className="space-y-3 text-[14px]">
              {[
                "Transaction succeeded on chain 31611",
                "MUSD Transfer log from the official token contract",
                "Sender, recipient and exact amount match the payment",
                "Not older than the payment attempt, never reused",
                "Contract path: matching Settled event and settlement id",
              ].map((t) => (
                <li key={t} className="flex items-start gap-3 rounded-[12px] border border-line bg-ink-900/60 px-4 py-3">
                  <BadgeCheck className="mt-0.5 size-4 shrink-0 text-mint-400" aria-hidden="true" />
                  <span className="text-fg-muted">{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-4 py-10 text-[13px] text-fg-subtle sm:px-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-[56ch] space-y-2">
            <Wordmark />
            <p>
              Testnet software: MUSD on Mezo testnet has no monetary value. Blockchain payments are irreversible. The settlement contract is unaudited.{" "}
              <Link href="/help#risks" className="text-violet-300 hover:underline">
                Read the risk disclosure
              </Link>
              .
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Footer">
            <Link href="/dashboard" className="hover:text-fg">
              Dashboard
            </Link>
            <Link href="/help" className="hover:text-fg">
              Help & about
            </Link>
            <Link href="/legal" className="hover:text-fg">
              Terms & privacy
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
