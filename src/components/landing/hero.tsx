"use client";

import Link from "next/link";
import { useState } from "react";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/components/providers/session";
import { formatAmount } from "@/lib/engine/money";
import { cn } from "@/lib/client/cn";
import { EXAMPLE_MEMBERS, EXAMPLE_PAIRWISE, EXAMPLE_SIMPLIFIED, EXAMPLE_STATS } from "./example-ledger";

const W = 560;
const H = 440;
const R_X = 190;
const R_Y = 160;
const NODE = 22;

const pos = new Map<string, { x: number; y: number; lx: number; ly: number; anchor: "start" | "middle" | "end" }>(
  EXAMPLE_MEMBERS.map((m, i) => {
    const a = (i / EXAMPLE_MEMBERS.length) * Math.PI * 2 - Math.PI / 2;
    const c = Math.cos(a);
    // names sit outside the ring so no debt line ever crosses them
    return [
      m,
      {
        x: W / 2 + c * R_X,
        y: H / 2 + Math.sin(a) * R_Y,
        lx: W / 2 + c * (R_X + NODE + 10),
        ly: H / 2 + Math.sin(a) * (R_Y + NODE + 12) + 4,
        anchor: Math.abs(c) < 0.2 ? "middle" : c > 0 ? "start" : "end",
      },
    ];
  }),
);

/** A straight edge from node edge to node edge, so arrowheads land on the circle. */
function edge(from: string, to: string, inset = NODE + 6) {
  const a = pos.get(from)!;
  const b = pos.get(to)!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  return { x1: a.x + ux * inset, y1: a.y + uy * inset, x2: b.x - ux * inset, y2: b.y - uy * inset, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
}

/**
 * The product in one picture: the example group's 14 recorded debts (computed by the real engine)
 * and the 5 payments that settle everyone. The visitor toggles between them.
 */
function LedgerDiagram() {
  const [view, setView] = useState<"recorded" | "simplified">("recorded");
  const simplified = view === "simplified";
  return (
    <figure className="surface rounded-[var(--radius-panel)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <figcaption className="text-[13px] text-fg-muted">Example: a 6-person trip, {formatAmount(EXAMPLE_STATS.total, { fractionDigits: 0 })} MUSD of bills</figcaption>
        <div role="tablist" aria-label="Debt view" className="inline-flex rounded-[var(--radius-control)] border border-line-strong p-0.5 text-[13px]">
          {(
            [
              ["recorded", `As recorded (${EXAMPLE_STATS.pairwise})`],
              ["simplified", `Simplified (${EXAMPLE_STATS.simplified})`],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn("rounded-[6px] px-3 py-1.5 font-medium transition-colors", view === v ? "bg-fg text-white" : "text-fg-muted hover:text-fg")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={simplified ? `${EXAMPLE_STATS.simplified} payments settle everyone` : `${EXAMPLE_STATS.pairwise} debts as recorded`}>
        <defs>
          <marker id="arrow-ink" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="#000" />
          </marker>
          <marker id="arrow-blue" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="#002fa7" />
          </marker>
        </defs>
        <g className="transition-opacity duration-500" opacity={simplified ? 0.12 : 1}>
          {EXAMPLE_PAIRWISE.map((t) => {
            const e = edge(t.from, t.to);
            return <line key={`p-${t.from}-${t.to}`} {...e} stroke="#000" strokeWidth="1.25" markerEnd="url(#arrow-ink)" />;
          })}
        </g>
        <g className="transition-opacity duration-500" opacity={simplified ? 1 : 0}>
          {EXAMPLE_SIMPLIFIED.map((t) => {
            const e = edge(t.from, t.to);
            return (
              <g key={`s-${t.from}-${t.to}`}>
                <line {...e} stroke="#002fa7" strokeWidth="3.5" markerEnd="url(#arrow-blue)" />
                <rect x={e.mx - 30} y={e.my - 12} width="60" height="22" rx="4" fill="#fff" stroke="#002fa7" />
                <text x={e.mx} y={e.my + 4} textAnchor="middle" fontSize="12" fontWeight="600" fill="#002fa7" className="num">
                  {formatAmount(t.amount, { fractionDigits: 0 })}
                </text>
              </g>
            );
          })}
        </g>
        {[...pos.entries()].map(([m, p]) => (
          <g key={m}>
            <circle cx={p.x} cy={p.y} r={NODE} fill="#fff" stroke="#000" strokeWidth="1.5" />
            <text x={p.x} y={p.y + 5} textAnchor="middle" fontSize="14" fontWeight="600" fill="#000">
              {m.slice(0, 1)}
            </text>
            <text x={p.lx} y={p.ly} textAnchor={p.anchor} fontSize="12.5" fill="#404040">
              {m}
            </text>
          </g>
        ))}
      </svg>
      <p className="border-t border-line px-4 py-3 text-[13px] text-fg-muted">
        {simplified
          ? `${EXAMPLE_STATS.simplified} MUSD payments square everyone up. Each person ends up exactly where the 14 debts said they should.`
          : `${EXAMPLE_STATS.pairwise} separate debts between six people. Nobody wants to pay all of these.`}
      </p>
    </figure>
  );
}

export function Hero() {
  const { address, openConnect } = useSession();
  return (
    <section className="mx-auto grid max-w-[1240px] items-center gap-12 px-4 pt-14 pb-16 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:pt-20 lg:pb-24">
      <div>
        <h1 className="font-display text-[44px] leading-[0.98] font-bold tracking-[-0.035em] sm:text-[64px]">
          Split the bill.
          <br />
          Settle it in MUSD.
        </h1>
        <p className="mt-6 max-w-[48ch] text-[17px] leading-relaxed text-fg-muted">
          A shared ledger for trips, flats and dinners. It works out the fewest payments that square everyone up, and settles them in MUSD on Mezo. A debt only
          clears once the payment is verified on-chain.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          {address ? (
            <Button size="lg" asChild>
              <Link href="/dashboard">Open your dashboard</Link>
            </Button>
          ) : (
            <Button size="lg" onClick={openConnect}>
              <Wallet className="size-4" /> Connect a wallet
            </Button>
          )}
          <Button size="lg" variant="secondary" asChild>
            <a href="#pay">Ways to pay</a>
          </Button>
        </div>
        <dl className="mt-10 grid max-w-[520px] grid-cols-3 border-t border-line pt-5 text-[13px]">
          <div>
            <dt className="text-fg-subtle">Pay with</dt>
            <dd className="mt-1 font-medium">MUSD you hold</dd>
          </div>
          <div>
            <dt className="text-fg-subtle">Or swap</dt>
            <dd className="mt-1 font-medium">BTC on Mezo Pools</dd>
          </div>
          <div>
            <dt className="text-fg-subtle">Or borrow</dt>
            <dd className="mt-1 font-medium">against your BTC</dd>
          </div>
        </dl>
      </div>
      <LedgerDiagram />
    </section>
  );
}
