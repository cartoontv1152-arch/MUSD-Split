"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Layers } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { SignInGate } from "@/components/shell/gate";
import { PreflightList, usePreflight } from "@/components/settle/preflight";
import { Amount, SettlementStatusPill } from "@/components/money";
import { MemberName, TxLink } from "@/components/identity";
import { Button } from "@/components/ui/button";
import { Callout, PageHeader, Panel, PanelHeader, Skeleton } from "@/components/ui/primitives";
import { useGroup } from "@/lib/client/hooks";
import { ApiClientError, errorMessage, isUserRejection, post } from "@/lib/client/api";
import { cn } from "@/lib/client/cn";
import { sendBatch, waitForReceiptLenient } from "@/lib/client/settle";
import type { Settlement } from "@/lib/client/types";

interface BatchDTO {
  batch: { id: string; status: string; txHash: string | null; total: string; method: string };
  items: Settlement[];
}

export default function SettleAllPage() {
  return (
    <SignInGate>
      <Inner />
    </SignInGate>
  );
}

function Inner() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: b, isLoading } = useGroup(id);
  const [batch, setBatch] = useState<BatchDTO | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [usePermit, setUsePermit] = useState(true);
  const method = usePermit ? "batch_permit" : "batch";
  const route = b ? (b.group.simplifyDebts ? b.ledger.simplified : b.ledger.pairwise).filter((t) => t.from === b.me.address) : [];
  const total = route.reduce((a, t) => a + BigInt(t.amount), 0n);
  const pre = usePreflight(total);
  if (isLoading || !b) return <Skeleton className="h-96" />;

  async function run() {
    setBusy(true);
    let created: BatchDTO | null = null;
    let sentHash: string | null = null;
    try {
      setStep("Recording the batch…");
      created = await post<BatchDTO>(`/api/groups/${id}/settlements/batch`, { method });
      setBatch(created);
      const hash = await sendBatch({
        method,
        from: b!.me.address,
        items: created.items.map((i) => ({ settlementKey: i.settlementKey, to: i.to, amount: BigInt(i.amount) })),
        onStep: setStep,
      });
      sentHash = hash;
      setStep("Saving the transaction hash…");
      let cur: BatchDTO | null = null;
      for (let attempt = 0; !cur; attempt++) {
        try {
          cur = await post<BatchDTO>(`/api/settlement-batches/${created.batch.id}/submit`, { txHash: hash });
        } catch (err) {
          if (attempt >= 3 || (err instanceof ApiClientError && err.status < 500)) throw err;
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        }
      }
      setBatch(cur);
      setStep("Waiting for confirmation and verifying every payment…");
      await waitForReceiptLenient(hash);
      for (let i = 0; i < 30 && !["confirmed", "failed", "rejected"].includes(cur.batch.status); i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const prev: BatchDTO = cur;
        cur = await post<BatchDTO>(`/api/settlement-batches/${created.batch.id}/verify`).catch(() => prev);
        setBatch(cur);
      }
      if (cur.batch.status === "confirmed") toast.success("All payments confirmed in one transaction");
      void qc.invalidateQueries();
    } catch (e) {
      if (sentHash && created) {
        // broadcast already happened: keep the batch on screen with its hash, never say "not sent"
        toast.error("Batch sent, but not recorded yet", { description: "Keep this page open; it will be checked again. Your transaction is on its way." });
        setBatch({ ...created, batch: { ...created.batch, txHash: sentHash, status: "submitted" } });
      } else {
        if (isUserRejection(e)) toast.message("Cancelled in your wallet. Nothing was sent.");
        else toast.error("Batch not completed", { description: errorMessage(e) });
        if (created && created.batch.status === "created") setBatch(null);
      }
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/groups/${id}?tab=balances`} className="hover:text-fg">
            ← {b.group.name}
          </Link>
        }
        title="Settle everything you owe"
        description="Pay everyone you owe in this group in one transaction through the MUSD Split settlement contract."
      />
      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Panel>
          <PanelHeader title={`${route.length} payment${route.length === 1 ? "" : "s"}`} description="Each one gets its own on-chain settlement id and is verified separately." />
          {route.length === 0 && !batch ? (
            <p className="px-5 pb-5 text-fg-muted">You don&apos;t owe anyone in this group.</p>
          ) : (
            <ul className="divide-y divide-line px-5 pb-3">
              {(batch?.items ?? route.map((t) => ({ ...t, id: t.to, status: "created" as const, txHash: null }))).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-3 text-[14px]">
                  <MemberName address={t.to} profiles={b.profiles} withAvatar className="font-medium" />
                  <span className="flex items-center gap-3">
                    <Amount value={t.amount} />
                    {batch && <SettlementStatusPill status={t.status} />}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[14px]">
            <span className="text-fg-muted">Total</span>
            <Amount value={batch ? batch.batch.total : total} className="font-semibold" />
          </div>
        </Panel>
        <div className="space-y-5">
          {batch?.batch.txHash && (
            <Panel className="p-5 text-[14px]">
              <div className="flex items-center gap-2">
                {batch.batch.status === "confirmed" ? <CheckCircle2 className="size-5 text-blue-600" /> : <Layers className="size-5 text-blue-600" />}
                <span className="font-medium">{batch.batch.status === "confirmed" ? "All confirmed on-chain" : `Batch ${batch.batch.status}`}</span>
              </div>
              <div className="mt-2">
                <TxLink hash={batch.batch.txHash} />
              </div>
              {step && <p className="mt-2 text-[13px] text-fg-muted">{step}</p>}
            </Panel>
          )}
          <Panel className="p-5">
            <h2 className="mb-3 font-display text-[16px] font-semibold">Before you send</h2>
            <PreflightList rows={pre.rows} />
            <div role="radiogroup" aria-label="Approval method" className="mt-4 grid gap-2 text-[13.5px]">
              {[
                [true, "One signature (permit)", "Sign a free permit for the total, then one transaction."],
                [false, "Approve first", "For wallets that can't sign permits: an approval, then the batch."],
              ].map(([v, t, d]) => (
                <button
                  key={String(v)}
                  type="button"
                  role="radio"
                  aria-checked={usePermit === v}
                  onClick={() => setUsePermit(v as boolean)}
                  className={cn("rounded-[var(--radius-card)] border px-3 py-2 text-left", usePermit === v ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600" : "border-line-strong hover:border-fg")}
                >
                  <span className="block font-medium">{t as string}</span>
                  <span className="block text-[12.5px] text-fg-muted">{d as string}</span>
                </button>
              ))}
            </div>
            <Callout tone="violet" className="mt-4">
              You authorise exactly <Amount value={total} />. The contract moves MUSD from you directly to each person and keeps nothing.
            </Callout>
            <Button size="lg" className="mt-4 w-full" loading={busy} disabled={!pre.ready || route.length === 0 || (!!batch && batch.batch.status !== "created")} onClick={run}>
              <Layers className="size-4" /> {busy ? (step ?? "Working…") : `Pay ${route.length} people in one transaction`}
            </Button>
          </Panel>
        </div>
      </div>
    </>
  );
}
