"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { ArrowRight, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/components/providers/session";
import { EXAMPLE_MEMBERS, EXAMPLE_SIMPLIFIED, EXAMPLE_STATS } from "./example-ledger";
import { cn } from "@/lib/client/cn";

const DebtConstellation = dynamic(() => import("./debt-constellation"), { ssr: false, loading: () => null });

/** Static poster (reduced motion / before WebGL loads): the simplified graph in 2D. */
function Poster() {
  const W = 520;
  const H = 420;
  const pos = new Map<string, { x: number; y: number }>(
    EXAMPLE_MEMBERS.map((m, i) => {
      const a = (i / EXAMPLE_MEMBERS.length) * Math.PI * 2 - Math.PI / 2;
      return [m, { x: W / 2 + Math.cos(a) * 170, y: H / 2 + Math.sin(a) * 140 }];
    }),
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 m-auto h-full w-full" aria-hidden="true">
      {EXAMPLE_SIMPLIFIED.map((t) => {
        const a = pos.get(t.from)!;
        const b = pos.get(t.to)!;
        return <path key={t.from + t.to} d={`M${a.x},${a.y} Q${W / 2},${H / 2 - 40} ${b.x},${b.y}`} stroke="#46ddeb" strokeOpacity="0.8" strokeWidth="2.5" fill="none" />;
      })}
      {[...pos.entries()].map(([m, p]) => (
        <g key={m}>
          <circle cx={p.x} cy={p.y} r="26" fill="#8a6cff" fillOpacity="0.18" />
          <circle cx={p.x} cy={p.y} r="12" fill="#8a6cff" />
          <text x={p.x} y={p.y + 34} textAnchor="middle" fontSize="12" fill="#a6acd0">
            {m}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function Hero() {
  const { address, openConnect } = useSession();
  const [phase, setPhase] = useState<"tangled" | "simplifying" | "simplified">("tangled");
  // null on the server / first paint, then the live reduced-motion preference
  const motion = useSyncExternalStore<boolean | null>(
    (cb) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => null,
  );
  const simplified = motion === false || phase === "simplified";

  return (
    <section className="relative overflow-hidden">
      <div className="hairline-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_70%_40%,black,transparent_70%)]" />
      <div className="relative mx-auto grid max-w-[1240px] items-center gap-6 px-4 pt-10 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:pt-16">
        <div className="relative z-10">
          <h1 className="font-display text-[44px] leading-[0.98] font-bold tracking-[-0.035em] text-fg sm:text-[60px] lg:text-[68px]">
            Shared costs,
            <br />
            settled on-chain.
          </h1>
          <p className="mt-6 max-w-[46ch] text-[17px] leading-relaxed text-fg-muted">
            MUSD Split tracks who paid for what, untangles the group&apos;s debts into the fewest payments, and settles each one with a real MUSD transfer on
            Mezo — verified before anyone&apos;s balance moves.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {address ? (
              <Button size="lg" asChild>
                <Link href="/dashboard">
                  Open your dashboard <ArrowRight className="size-4" />
                </Link>
              </Button>
            ) : (
              <Button size="lg" onClick={openConnect}>
                <Wallet className="size-4" /> Connect wallet
              </Button>
            )}
            <Button size="lg" variant="outline" asChild>
              <a href="#how">How it works</a>
            </Button>
          </div>
          <p className="mt-5 text-[13px] text-fg-subtle">Runs on Mezo testnet. Non-custodial — your MUSD only moves when you approve it.</p>
        </div>

        <div className="relative">
          <div className="relative aspect-[5/4] w-full lg:-mr-16 lg:aspect-[6/5] lg:w-[calc(100%+4rem)]">
            {motion === null ? null : motion ? <DebtConstellation onPhase={setPhase} /> : <Poster />}
          </div>
          <div className="glass relative z-10 mx-auto -mt-6 flex w-fit max-w-full flex-wrap items-center justify-center gap-x-4 gap-y-1 rounded-full px-5 py-2.5 text-[13px]" aria-live="polite">
            <span className="text-fg-subtle">Example group · {EXAMPLE_STATS.members} friends</span>
            <span className={cn("transition-colors", simplified ? "text-fg-subtle line-through decoration-fg-subtle/60" : "text-violet-300")}>
              {EXAMPLE_STATS.pairwise} debts as recorded
            </span>
            <ArrowRight className="size-3.5 text-fg-subtle" aria-hidden="true" />
            <span className={cn("font-medium transition-colors", simplified ? "text-cyan-300" : "text-fg-muted")}>{EXAMPLE_STATS.simplified} payments to settle everyone</span>
          </div>
        </div>
      </div>
    </section>
  );
}
