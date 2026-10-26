"use client";

import { useMemo, useState } from "react";
import { formatAmount } from "@/lib/engine/money";
import { displayName } from "@/components/identity";
import type { Profiles, Transfer } from "@/lib/client/types";
import { cn } from "@/lib/client/cn";

/**
 * 2D debt map of the REAL group ledger: members on a ring, debts as threads.
 * Toggle between "as recorded" (pairwise debts) and "simplified" (fewest payments) —
 * the same untangling the landing-page hero shows, on your actual data.
 */
export function DebtMap({ members, pairwise, simplified, profiles, me }: { members: string[]; pairwise: Transfer[]; simplified: Transfer[]; profiles: Profiles; me: string }) {
  const [mode, setMode] = useState<"pairwise" | "simplified">("simplified");
  const edges = mode === "pairwise" ? pairwise : simplified;
  const W = 520;
  const H = 360;
  const cx = W / 2;
  const cy = H / 2;
  const r = Math.min(W, H) / 2 - 56;
  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    members.forEach((a, i) => {
      const t = (i / Math.max(1, members.length)) * Math.PI * 2 - Math.PI / 2;
      m.set(a, { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
    });
    return m;
  }, [members, cx, cy, r]);
  const max = edges.reduce((a, e) => (BigInt(e.amount) > a ? BigInt(e.amount) : a), 1n);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Debt view" className="inline-flex rounded-[10px] border border-line-strong bg-ink-900 p-0.5 text-[13px]">
          {(["pairwise", "simplified"] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn("rounded-[8px] px-3 py-1.5", mode === m ? "bg-ink-700 text-fg" : "text-fg-muted hover:text-fg")}
            >
              {m === "pairwise" ? `As recorded · ${pairwise.length}` : `Simplified · ${simplified.length}`}
            </button>
          ))}
        </div>
        <span className="text-[12.5px] text-fg-subtle">
          {pairwise.length > simplified.length
            ? `${pairwise.length - simplified.length} fewer payment${pairwise.length - simplified.length === 1 ? "" : "s"} with the same end result`
            : "Already as simple as it gets"}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Debt map, ${edges.length} payments`}>
        <defs>
          <marker id="dm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="#46ddeb" />
          </marker>
          <radialGradient id="dm-glow">
            <stop offset="0" stopColor="#8a6cff" stopOpacity="0.35" />
            <stop offset="1" stopColor="#8a6cff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={cx} cy={cy} r={r + 30} fill="url(#dm-glow)" />
        {edges.map((e) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const mx = (a.x + b.x) / 2 + (cy - (a.y + b.y) / 2) * 0.18;
          const my = (a.y + b.y) / 2 - (cx - (a.x + b.x) / 2) * 0.18;
          const w = 1.5 + Number((BigInt(e.amount) * 40n) / max) / 10;
          // shorten the end so the arrow sits outside the node
          const dx = b.x - mx;
          const dy = b.y - my;
          const len = Math.hypot(dx, dy) || 1;
          const ex = b.x - (dx / len) * 22;
          const ey = b.y - (dy / len) * 22;
          return (
            <g key={`${e.from}-${e.to}`}>
              <path d={`M${a.x},${a.y} Q${mx},${my} ${ex},${ey}`} fill="none" stroke="#46ddeb" strokeOpacity="0.22" strokeWidth={w + 4} />
              <path d={`M${a.x},${a.y} Q${mx},${my} ${ex},${ey}`} fill="none" stroke="#46ddeb" strokeWidth={w} markerEnd="url(#dm-arrow)" className="thread-flow" />
              <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle" className="num" fontSize="12" fill="#eceeff" paintOrder="stroke" stroke="#0a0f22" strokeWidth="4">
                {formatAmount(BigInt(e.amount))}
              </text>
            </g>
          );
        })}
        {members.map((a) => {
          const p = pos.get(a)!;
          const isMe = a === me;
          return (
            <g key={a}>
              <circle cx={p.x} cy={p.y} r="18" fill={isMe ? "#6e4ff0" : "#192143"} stroke={isMe ? "#c4b5ff" : "#2f3964"} strokeWidth="1.5" />
              <text x={p.x} y={p.y + 34} textAnchor="middle" fontSize="12.5" fill="#a6acd0">
                {displayName(a, profiles, me)}
              </text>
              <text x={p.x} y={p.y + 4.5} textAnchor="middle" fontSize="12" fontWeight="600" fill="#eceeff">
                {displayName(a, profiles, me).slice(0, 2).toUpperCase()}
              </text>
            </g>
          );
        })}
      </svg>
      {edges.length === 0 && <p className="-mt-6 text-center text-[13.5px] text-fg-muted">Nobody owes anybody. All settled.</p>}
    </div>
  );
}
