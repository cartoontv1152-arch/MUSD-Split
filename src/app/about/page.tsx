import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/shell/public-shell";
import { Button } from "@/components/ui/button";
import { CONTACT, TEAM } from "@/config/team";

export const metadata: Metadata = {
  title: "About",
  description: "Why MUSD Split exists, who it is for, how it makes money, and what comes next.",
};

const REVENUE: Array<[string, string, string]> = [
  [
    "Borrow-and-pay interface fee",
    "When someone pays a friend by borrowing against their BTC, the payment is a new MUSD loan we originated. We would add a small interface fee on top of the protocol's 0.1% borrowing fee, or take a share of it if Mezo offers one to front-ends.",
    "Planned for mainnet",
  ],
  [
    "Swap routing fee",
    "Payers who are short on MUSD swap BTC or MEZO on Mezo Pools inside the payment screen. A 0.1–0.2% interface fee on that routed volume, shown before they confirm.",
    "Planned for mainnet",
  ],
  [
    "Group Pro",
    "For flats, clubs and small teams that share costs every month: automatic recurring bills, accounting exports, admin controls, multiple currencies and spending reports. A flat monthly price per group, paid in MUSD.",
    "Designing",
  ],
  [
    "Business accounts",
    "Co-living operators, travel organisers and event hosts collect shared costs from many people at once and need the verified receipts. Priced per active member, with an API.",
    "Exploring",
  ],
];

const ROADMAP: Array<[string, string]> = [
  ["Now", "Groups, four split methods, verified MUSD payments, settlement contract, Mezo Pools swaps, borrow-and-pay from a trove, usage page."],
  ["Next", "Email and push reminders, shareable read-only group summaries, a mobile-first install (PWA), and a second round of contract review."],
  ["Mainnet", "External audit of the settlement contract, launch on Mezo mainnet, switch on the interface fees above, and Group Pro."],
  ["Later", "Scheduled payments with spending limits, multi-currency expenses with on-chain FX snapshots, and business accounts."],
];

export default function AboutPage() {
  return (
    <PublicShell>
      <article className="max-w-[760px]">
        <h1 className="font-display text-[36px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[48px]">Shared costs are easy to record and hard to settle.</h1>
        <p className="mt-6 text-[17px] leading-relaxed text-fg-muted">
          Friends, flatmates and travel groups already use apps to write down who paid for what. The hard part comes after: working out who owes whom, chasing people, and
          checking that money actually arrived. MUSD Split does all of it in one place, and the settling happens in MUSD on Mezo, where every payment can be checked.
        </p>

        <h2 className="mt-14 font-display text-[24px] font-semibold tracking-[-0.02em]">Who it&apos;s for</h2>
        <ul className="mt-4 space-y-3 text-[15.5px] leading-relaxed">
          <li>
            <span className="font-medium">Bitcoin holders who share costs.</span> <span className="text-fg-muted">They want to pay a friend without selling BTC. With a Mezo trove, they borrow exactly what they owe against their BTC and it goes straight to the friend.</span>
          </li>
          <li>
            <span className="font-medium">Groups that live together or travel together.</span> <span className="text-fg-muted">Rent, utilities and trips create dozens of small debts. We turn them into the fewest possible payments.</span>
          </li>
          <li>
            <span className="font-medium">Anyone who has had a &ldquo;did you pay me back?&rdquo; argument.</span> <span className="text-fg-muted">A debt only clears when the server has verified the payment on-chain, and both sides get the same receipt.</span>
          </li>
        </ul>

        <h2 className="mt-14 font-display text-[24px] font-semibold tracking-[-0.02em]">Why Mezo</h2>
        <p className="mt-4 text-[15.5px] leading-relaxed text-fg-muted">
          MUSD is a dollar-pegged token backed by Bitcoin. That matters for paying people back: a BTC holder can create the MUSD they owe from their own collateral at
          the moment of payment, instead of selling BTC first. MUSD Split uses Mezo&apos;s own contracts for that: BorrowerOperationsSignatures to mint borrowed MUSD
          straight to the person being paid, TroveManager and the price feed to show the loan&apos;s health before and after, and Mezo Pools to swap BTC or MEZO for
          any shortfall. Low fees make small payments, like a 12 MUSD dinner share, practical.
        </p>

        <h2 className="mt-14 font-display text-[24px] font-semibold tracking-[-0.02em]">How we make money</h2>
        <p className="mt-4 text-[15.5px] leading-relaxed text-fg-muted">
          Splitting and paying with MUSD you already hold stays free, because that&apos;s what brings groups in. Revenue comes from the moments where we add real value:
          creating the money to pay, and running groups that share costs every month. Nothing below is switched on during testnet.
        </p>
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[560px] text-[14.5px]">
            <thead>
              <tr className="border-b border-fg text-left text-[12.5px] text-fg-muted">
                <th className="py-2 pr-4 font-medium">Stream</th>
                <th className="py-2 pr-4 font-medium">How it works</th>
                <th className="py-2 font-medium whitespace-nowrap">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line align-top">
              {REVENUE.map(([name, how, status]) => (
                <tr key={name}>
                  <td className="py-3 pr-4 font-medium">{name}</td>
                  <td className="py-3 pr-4 leading-relaxed text-fg-muted">{how}</td>
                  <td className="py-3 whitespace-nowrap">{status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-[14px] leading-relaxed text-fg-muted">
          A worked example: a group of six settles 1,200 MUSD a month and half of it is paid by borrowing against BTC. A 0.25% interface fee on that half is 1.50
          MUSD a month. The costs per group are tiny (one database row per expense and a few RPC calls per payment), so the fees cover them many times over.
        </p>

        {TEAM.length > 0 && (
          <>
            <h2 className="mt-14 font-display text-[24px] font-semibold tracking-[-0.02em]">Team</h2>
            <ul className="mt-6 grid gap-6 sm:grid-cols-2">
              {TEAM.map((m) => (
                <li key={m.name} className="border-t-2 border-fg pt-4">
                  <div className="font-display text-[18px] font-semibold">{m.name}</div>
                  <div className="text-[14px] text-blue-700">{m.role}</div>
                  {m.bio && <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">{m.bio}</p>}
                  {m.links && m.links.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13.5px]">
                      {m.links.map((l) => (
                        <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                          {l.label}
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        <h2 className="mt-14 font-display text-[24px] font-semibold tracking-[-0.02em]">Roadmap</h2>
        <ol className="mt-6 space-y-5">
          {ROADMAP.map(([when, what]) => (
            <li key={when} className="grid gap-1 border-t border-line pt-4 sm:grid-cols-[120px_1fr]">
              <span className="font-display text-[15px] font-semibold text-blue-600">{when}</span>
              <span className="text-[15px] leading-relaxed text-fg-muted">{what}</span>
            </li>
          ))}
        </ol>

        <div className="mt-14 flex flex-wrap gap-3 border-t border-line pt-8">
          <Button asChild size="lg">
            <Link href="/dashboard">Open the app</Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link href="/stats">See live usage</Link>
          </Button>
          {CONTACT && (
            <Button asChild size="lg" variant="ghost">
              <a href={CONTACT.href}>{CONTACT.label}</a>
            </Button>
          )}
        </div>
      </article>
    </PublicShell>
  );
}
