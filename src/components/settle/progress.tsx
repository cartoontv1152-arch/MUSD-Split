"use client";

import { CheckCircle2, Loader2, ShieldCheck, XCircle } from "lucide-react";
import Link from "next/link";
import { Amount, SettlementStatusPill } from "@/components/money";
import { MemberName, TxLink } from "@/components/identity";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/primitives";
import { cn } from "@/lib/client/cn";
import type { Profiles, Settlement } from "@/lib/client/types";

/**
 * Status-first progress card with a 3D flip when verification completes.
 * Text always states the real status; the flip is decoration only.
 */
export function SettlementProgress({ settlement, step, profiles, me, groupId }: { settlement: Settlement | null; step: string | null; profiles: Profiles; me: string; groupId: string }) {
  const s = settlement;
  const done = s?.status === "confirmed";
  const bad = s && (s.status === "failed" || s.status === "rejected");
  return (
    <div className="flip-scene">
      <div className={cn("flip-card relative grid", done && "is-flipped")}>
        <Panel raised className="flip-face col-start-1 row-start-1 p-6">
          <div className="flex items-center gap-3">
            {bad ? <XCircle className="size-6 text-rose-400" /> : <Loader2 className="size-6 animate-spin text-violet-300" />}
            <div>
              <div className="font-display text-[18px] font-semibold">{bad ? (s.status === "failed" ? "Payment failed" : "Payment not accepted") : "Processing payment"}</div>
              <div className="text-[13.5px] text-fg-muted">{bad ? s.failureReason : (step ?? "Working…")}</div>
            </div>
          </div>
          {s && (
            <div className="mt-5 space-y-2 text-[13.5px]">
              <div className="flex items-center justify-between">
                <span className="text-fg-muted">Status</span>
                <SettlementStatusPill status={s.status} />
              </div>
              {(s.txHash || s.rejectedTxHash) && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-fg-muted">Transaction</span>
                  <TxLink hash={(s.txHash || s.rejectedTxHash)!} />
                </div>
              )}
              {s.status === "submitted" && <p className="text-[12.5px] text-fg-subtle">Safe to leave this page — the payment is tracked and verification continues. You&apos;ll find it on your dashboard.</p>}
              {s.status === "delayed" && <p className="text-[12.5px] text-amber-300">The network is slow to answer. We keep re-checking; nothing is lost.</p>}
            </div>
          )}
          {bad && (
            <div className="mt-5 flex gap-2">
              <Button variant="secondary" asChild>
                <Link href={`/settlements/${s.id}`}>Details</Link>
              </Button>
              <Button asChild>
                <Link href={`/groups/${groupId}?tab=balances`}>Back to balances</Link>
              </Button>
            </div>
          )}
        </Panel>
        <Panel raised className="flip-face flip-back col-start-1 row-start-1 border-mint-400/30 p-6">
          {s && done && (
            <>
              <div className="flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-full bg-mint-400/15">
                  <CheckCircle2 className="size-6 text-mint-400" />
                </span>
                <div>
                  <div className="font-display text-[19px] font-semibold">Payment confirmed</div>
                  <div className="text-[13.5px] text-fg-muted">Verified on Mezo testnet{s.blockNumber ? ` in block ${Number(s.blockNumber).toLocaleString()}` : ""}.</div>
                </div>
              </div>
              <div className="mt-5 rounded-[12px] border border-line bg-ink-900/60 p-4 text-[14px]">
                <div className="flex items-center justify-between">
                  <span className="text-fg-muted">Paid</span>
                  <Amount value={s.amount} className="font-semibold text-mint-400" />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-fg-muted">To</span>
                  <MemberName address={s.to} profiles={profiles} me={me} withAvatar />
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-fg-muted">Tx</span>
                  {s.txHash && <TxLink hash={s.txHash} />}
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button asChild>
                  <Link href={`/settlements/${s.id}`}>
                    <ShieldCheck className="size-4" /> View receipt
                  </Link>
                </Button>
                <Button variant="secondary" asChild>
                  <Link href={`/groups/${groupId}`}>Back to group</Link>
                </Button>
              </div>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
