"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, Clock3, Hourglass, Ban, XCircle } from "lucide-react";
import { formatAmount } from "@/lib/engine/money";
import { cn } from "@/lib/client/cn";
import type { SettlementStatus } from "@/lib/client/types";
import { Badge } from "./ui/primitives";

export function Amount({
  value,
  className,
  signed,
  unit = true,
  exact,
  tone,
}: {
  value: string | bigint;
  className?: string;
  signed?: boolean;
  unit?: boolean;
  exact?: boolean;
  tone?: "auto" | "owe" | "owed" | "plain";
}) {
  const v = typeof value === "bigint" ? value : BigInt(value || "0");
  const color =
    tone === "auto" ? (v > 0n ? "text-cyan-300" : v < 0n ? "text-amber-300" : "text-fg-muted") : tone === "owe" ? "text-amber-300" : tone === "owed" ? "text-cyan-300" : "";
  return (
    <span className={cn("num whitespace-nowrap", color, className)}>
      {formatAmount(v, { signed, exact })}
      {unit && <span className="ml-1 text-[0.78em] font-medium tracking-wide text-fg-subtle">MUSD</span>}
    </span>
  );
}

/** One person's position, as words first (status readable without colour). */
export function NetLabel({ net, className }: { net: string | bigint; className?: string }) {
  const v = typeof net === "bigint" ? net : BigInt(net || "0");
  if (v === 0n) return <span className={cn("text-fg-muted", className)}>Settled up</span>;
  return (
    <span className={cn(v > 0n ? "text-cyan-300" : "text-amber-300", className)}>
      {v > 0n ? "Gets back " : "Owes "}
      <Amount value={v < 0n ? -v : v} />
    </span>
  );
}

/** Diverging bar centred on zero: amber left = owes, cyan right = should receive. */
export function BalanceBar({ net, max, className }: { net: bigint; max: bigint; className?: string }) {
  const pct = max === 0n ? 0 : Number(((net < 0n ? -net : net) * 1000n) / max) / 10;
  return (
    <div className={cn("relative h-2 w-full rounded-full bg-ink-750", className)} aria-hidden="true">
      <div className="absolute top-[-3px] bottom-[-3px] left-1/2 w-px bg-line-strong" />
      {net !== 0n && (
        <div
          className={cn("absolute top-0 bottom-0 rounded-full", net < 0n ? "right-1/2 bg-amber-400" : "left-1/2 bg-cyan-400")}
          style={{ width: `${Math.max(2, pct / 2)}%` }}
        />
      )}
    </div>
  );
}

const STATUS: Record<SettlementStatus, { label: string; tone: "mint" | "amber" | "rose" | "violet" | "neutral" | "sky"; Icon: typeof CheckCircle2 }> = {
  created: { label: "Awaiting signature", tone: "neutral", Icon: CircleDashed },
  submitted: { label: "Pending confirmation", tone: "sky", Icon: Hourglass },
  delayed: { label: "Verification delayed", tone: "amber", Icon: Clock3 },
  confirmed: { label: "Confirmed on-chain", tone: "mint", Icon: CheckCircle2 },
  failed: { label: "Failed — reverted", tone: "rose", Icon: XCircle },
  rejected: { label: "Not accepted", tone: "rose", Icon: AlertTriangle },
  cancelled: { label: "Cancelled", tone: "neutral", Icon: Ban },
};

export function SettlementStatusPill({ status, className }: { status: SettlementStatus; className?: string }) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone} className={className}>
      <s.Icon className={cn("size-3.5", (status === "submitted" || status === "delayed") && "animate-pulse-soft")} aria-hidden="true" />
      {s.label}
    </Badge>
  );
}

export const settlementStatusLabel = (s: SettlementStatus) => STATUS[s].label;

export function ExpenseStatusPill({ status }: { status: "open" | "partial" | "settled" | "deleted" }) {
  if (status === "settled") return <Badge tone="mint">Settled</Badge>;
  if (status === "partial") return <Badge tone="sky">Partly settled</Badge>;
  if (status === "deleted") return <Badge tone="rose">Deleted</Badge>;
  return <Badge tone="amber">Open</Badge>;
}

export function methodLabel(m: string): string {
  switch (m) {
    case "direct":
      return "Direct MUSD transfer";
    case "contract":
      return "Settlement contract";
    case "contract_permit":
      return "Settlement contract (permit)";
    case "batch":
    case "batch_permit":
      return "Batch settlement";
    default:
      return m;
  }
}
