import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/shell/public-shell";
import { explorerAddressUrl, explorerTxUrl } from "@/config/chains";
import { MEZO_POOLS, MUSD, SETTLEMENT_CONTRACT } from "@/config/contracts";
import { MEZO_PROTOCOL } from "@/config/mezo";
import { formatAmount } from "@/lib/engine/money";
import { usageStats, type UsageStats } from "@/lib/server/stats";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Usage", description: "Live usage of MUSD Split on Mezo testnet: groups, expenses and verified MUSD payments." };

const METHOD: Record<string, string> = {
  direct: "Direct MUSD transfer",
  contract_permit: "Settlement contract (permit)",
  contract: "Settlement contract (approve)",
  trove: "Borrowed against BTC (Mezo trove)",
  batch_permit: "Batch, one transaction (permit)",
  batch: "Batch, one transaction (approve)",
};

const money = (v: string) => `${formatAmount(BigInt(v), { fractionDigits: 2 })} MUSD`;

export default async function StatsPage() {
  let s: UsageStats | null = null;
  try {
    s = await usageStats();
  } catch {
    s = null;
  }
  return (
    <PublicShell>
      <h1 className="font-display text-[36px] leading-[1.05] font-semibold tracking-[-0.03em] sm:text-[44px]">Usage</h1>
      <p className="mt-3 max-w-[64ch] text-[16px] leading-relaxed text-fg-muted">
        Live from the app&apos;s database. Every payment counted here was verified from its Mezo testnet receipt; each one links to the explorer. Groups created
        by our automated test runs or by the team&apos;s own test wallets are counted separately and left out of the headline numbers.
      </p>
      {!s ? (
        <p className="mt-10 border-l-4 border-fg pl-4 text-[15px]">The usage numbers can&apos;t be loaded right now. Try again in a minute.</p>
      ) : (
        <>
          {s.real.groups === 0 && (
            <div className="mt-10 border-l-4 border-blue-600 bg-blue-50 px-5 py-4 text-[15px] leading-relaxed">
              <p className="font-medium">No groups from outside the team yet.</p>
              <p className="mt-1 text-fg-muted">
                Every group, expense and payment so far came from our own test wallets. The first group someone else creates will appear in these numbers
                automatically. Below, our test activity is shown separately so you can check that every payment was real and verified.
              </p>
            </div>
          )}
          <section aria-label="Headline numbers" className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-line bg-line md:grid-cols-5">
            {[
              ["People in groups", s.real.people.toLocaleString()],
              ["Groups", s.real.groups.toLocaleString()],
              ["Expenses recorded", s.real.expenses.toLocaleString(), money(s.real.expenseVolume)],
              ["Verified payments", s.real.payments.toLocaleString(), money(s.real.paymentVolume)],
              ["Different payers", s.real.payers.toLocaleString()],
            ].map(([k, v, sub]) => (
              <div key={k} className="bg-paper p-5">
                <div className="text-[13px] text-fg-muted">{k}</div>
                <div className="num mt-1 font-display text-[30px] font-semibold tracking-[-0.02em]">{v}</div>
                {sub && <div className="num mt-0.5 text-[12.5px] text-fg-subtle">{sub}</div>}
              </div>
            ))}
          </section>
          <p className="mt-3 text-[13px] text-fg-subtle">
            Team test activity on top of this: {s.test.groups} groups and {s.test.payments} verified payments, all real Mezo testnet transactions made by our test
            wallets and end-to-end scripts.
          </p>

          <div className="mt-12 grid gap-10 lg:grid-cols-2">
            <section>
              <h2 className="font-display text-[20px] font-semibold">How people pay</h2>
              <p className="mt-1 text-[13.5px] text-fg-muted">All verified payments, including team test activity.</p>
              <table className="mt-4 w-full text-[14px]">
                <thead>
                  <tr className="border-b border-fg text-left text-[12.5px] text-fg-muted">
                    <th className="py-2 font-medium">Method</th>
                    <th className="py-2 text-right font-medium">Payments</th>
                    <th className="py-2 text-right font-medium">Volume</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {s.byMethod.map((m) => (
                    <tr key={m.method}>
                      <td className="py-2.5">{METHOD[m.method] ?? m.method}</td>
                      <td className="num py-2.5 text-right">{m.payments}</td>
                      <td className="num py-2.5 text-right">{money(m.volume)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section>
              <h2 className="font-display text-[20px] font-semibold">Payments by week</h2>
              <p className="mt-1 text-[13.5px] text-fg-muted">Verified payments, including team test activity.</p>
              <table className="mt-4 w-full text-[14px]">
                <thead>
                  <tr className="border-b border-fg text-left text-[12.5px] text-fg-muted">
                    <th className="py-2 font-medium">Week of</th>
                    <th className="py-2 text-right font-medium">Payments</th>
                    <th className="py-2 text-right font-medium">Volume</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {s.weekly.map((w) => (
                    <tr key={w.week}>
                      <td className="num py-2.5">{new Date(w.week + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</td>
                      <td className="num py-2.5 text-right">{w.payments}</td>
                      <td className="num py-2.5 text-right">{money(w.volume)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          <section className="mt-12">
            <h2 className="font-display text-[20px] font-semibold">Latest verified payments</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] text-[14px]">
                <thead>
                  <tr className="border-b border-fg text-left text-[12.5px] text-fg-muted">
                    <th className="py-2 font-medium">When</th>
                    <th className="py-2 font-medium">Method</th>
                    <th className="py-2 text-right font-medium">Amount</th>
                    <th className="py-2 pl-6 font-medium">Transaction</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {s.recent.map((r) => (
                    <tr key={r.txHash + r.amount}>
                      <td className="num py-2.5 whitespace-nowrap">
                        {new Date(r.confirmedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC
                      </td>
                      <td className="py-2.5">
                        {METHOD[r.method] ?? r.method}
                        {r.test && <span className="ml-2 rounded-[4px] border border-line px-1.5 text-[11px] text-fg-subtle">team test</span>}
                      </td>
                      <td className="num py-2.5 text-right">{money(r.amount)}</td>
                      <td className="py-2.5 pl-6">
                        <a href={explorerTxUrl(r.txHash)} target="_blank" rel="noreferrer" className="font-mono text-[13px] text-blue-600 hover:underline">
                          {r.txHash.slice(0, 10)}…{r.txHash.slice(-6)}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      <section className="mt-12 border-t border-line pt-8">
        <h2 className="font-display text-[20px] font-semibold">Contracts this app uses</h2>
        <dl className="mt-4 grid gap-x-10 gap-y-2 text-[14px] md:grid-cols-2">
          {[
            ["MUSDSplitSettlement (ours, source verified)", SETTLEMENT_CONTRACT.address],
            ["MUSD token", MUSD.address],
            ["Mezo BorrowerOperations", MEZO_PROTOCOL.BorrowerOperations],
            ["Mezo BorrowerOperationsSignatures", MEZO_PROTOCOL.BorrowerOperationsSignatures],
            ["Mezo TroveManager", MEZO_PROTOCOL.TroveManager],
            ["Mezo Pools router", MEZO_POOLS.router],
          ].map(([k, a]) => (
            <div key={a} className="flex justify-between gap-4 border-b border-line py-2">
              <dt className="text-fg-muted">{k}</dt>
              <dd>
                <a href={explorerAddressUrl(a)} target="_blank" rel="noreferrer" className="font-mono text-[13px] text-blue-600 hover:underline">
                  {a.slice(0, 8)}…{a.slice(-6)}
                </a>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-[14px]">
          <Link href="/about" className="font-medium text-blue-600 hover:underline">
            Read about the product and business model
          </Link>
        </p>
      </section>
    </PublicShell>
  );
}
