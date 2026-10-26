"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, RefreshCw, Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { SignInGate } from "@/components/shell/gate";
import { Amount, SettlementStatusPill, methodLabel } from "@/components/money";
import { AddressChip, MemberName, TxLink } from "@/components/identity";
import { LogoMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Callout, Field, Input, Panel, PanelHeader, Skeleton, StatRow } from "@/components/ui/primitives";
import { useSession } from "@/components/providers/session";
import { api, errorMessage, post } from "@/lib/client/api";
import { formatDateTime } from "@/lib/client/cn";
import { MUSD, SETTLEMENT_CONTRACT } from "@/config/contracts";
import type { Profiles, Settlement } from "@/lib/client/types";

interface Detail {
  settlement: Settlement;
  groupName: string | null;
  events: Array<{ from_status: string | null; to_status: string; tx_hash: string | null; detail: string | null; created_at: string }>;
  profiles: Profiles;
}

export default function SettlementPage() {
  return (
    <SignInGate>
      <Inner />
    </SignInGate>
  );
}

function Inner() {
  const { sid } = useParams<{ sid: string }>();
  const { address: me } = useSession();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["settlement", sid],
    queryFn: () => api<Detail>(`/api/settlements/${sid}`),
    refetchInterval: (query) => (["submitted", "delayed"].includes(query.state.data?.settlement.status ?? "") ? 6000 : false),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.error || !q.data) return <Panel className="p-6 text-fg-muted">{errorMessage(q.error)}</Panel>;
  const { settlement: s, profiles: p } = q.data;
  const isPayer = s.from === me;

  async function action(name: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(name);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: ["settlement", sid] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    }
  }

  return (
    <div className="mx-auto max-w-[760px]">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link href={`/groups/${s.groupId}`} className="text-[13px] text-fg-subtle hover:text-fg">
          ← {q.data.groupName}
        </Link>
        <div className="flex gap-2">
          {["submitted", "delayed"].includes(s.status) && (
            <Button size="sm" variant="secondary" loading={busy === "verify"} onClick={() => action("verify", () => post(`/api/settlements/${sid}/verify`))}>
              <RefreshCw className="size-4" /> Check again
            </Button>
          )}
          {s.status === "confirmed" && (
            <Button size="sm" variant="secondary" onClick={() => window.print()}>
              <Printer className="size-4" /> Print receipt
            </Button>
          )}
        </div>
      </div>

      <Panel raised className="print-surface overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div className="flex items-center gap-3">
            <LogoMark className="size-9" />
            <div>
              <div className="font-display text-[18px] font-semibold">Settlement receipt</div>
              <div className="text-[12.5px] text-fg-subtle">MUSD Split · Mezo testnet</div>
            </div>
          </div>
          <SettlementStatusPill status={s.status} />
        </div>
        <div className="px-6 py-6 text-center">
          <div className="font-display text-[44px] leading-none font-semibold tracking-[-0.02em]">
            <Amount value={s.amount} exact />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[14.5px] text-fg-muted">
            <MemberName address={s.from} profiles={p} me={me} withAvatar className="text-fg" /> paid{" "}
            <MemberName address={s.to} profiles={p} me={me} withAvatar className="text-fg" />
          </div>
          {s.status !== "confirmed" && (
            <p className="mx-auto mt-3 max-w-[52ch] text-[13px] text-amber-300">
              {s.status === "created"
                ? "No transaction has been recorded for this payment yet."
                : s.status === "submitted"
                  ? "Waiting for on-chain confirmation. This page refreshes automatically."
                  : s.status === "delayed"
                    ? "Verification is delayed because the network didn't respond. We keep retrying."
                    : s.status === "cancelled"
                      ? "This payment attempt was cancelled before anything was sent."
                      : s.failureReason}
            </p>
          )}
        </div>
        <dl className="divide-y divide-line border-t border-line px-6">
          <StatRow label="From">
            <AddressChip address={s.from} />
          </StatRow>
          <StatRow label="To">
            <AddressChip address={s.to} />
          </StatRow>
          <StatRow label="Method">{methodLabel(s.method)}</StatRow>
          <StatRow label="Token">
            <AddressChip address={MUSD.address} />
          </StatRow>
          {s.method !== "direct" && (
            <>
              <StatRow label="Settlement contract">
                <AddressChip address={SETTLEMENT_CONTRACT.address} />
              </StatRow>
              <StatRow label="Settlement id">
                <span className="font-mono text-[12px] break-all text-fg-muted">{s.settlementKey}</span>
              </StatRow>
            </>
          )}
          {(s.txHash || s.rejectedTxHash) && (
            <StatRow label="Transaction">
              <TxLink hash={(s.txHash || s.rejectedTxHash)!} />
            </StatRow>
          )}
          {s.blockNumber && <StatRow label="Block">{Number(s.blockNumber).toLocaleString()}</StatRow>}
          {s.logIndex !== null && <StatRow label="Log index">{s.logIndex}</StatRow>}
          {s.blockTime && <StatRow label="Block time">{formatDateTime(s.blockTime)}</StatRow>}
          <StatRow label="Created">{formatDateTime(s.createdAt)}</StatRow>
          {s.confirmedAt && <StatRow label="Verified">{formatDateTime(s.confirmedAt)}</StatRow>}
          <StatRow label="Chain">Mezo testnet (31611)</StatRow>
        </dl>
        {s.status === "confirmed" && (
          <div className="flex items-center gap-2 border-t border-line bg-mint-400/6 px-6 py-3 text-[12.5px] text-mint-400">
            <ShieldCheck className="size-4" /> Verified server-side from the transaction receipt: success status, MUSD Transfer log, sender, recipient and exact amount.
          </div>
        )}
      </Panel>

      {isPayer && s.status === "created" && (
        <Panel className="no-print mt-5">
          <PanelHeader title="Recover this payment" description="If you sent the transaction but the page closed before it was recorded, we can find it." />
          <div className="space-y-4 px-5 pb-5">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                loading={busy === "recover"}
                onClick={() =>
                  action("recover", async () => {
                    const r = await post<{ settlement: Settlement }>(`/api/settlements/${sid}/recover`);
                    if (r.settlement.status === "created") toast.message("No matching transaction found on-chain yet");
                  })
                }
              >
                <Search className="size-4" /> Check chain for my payment
              </Button>
              <Button variant="ghost" loading={busy === "cancel"} onClick={() => action("cancel", () => post(`/api/settlements/${sid}/cancel`), "Payment attempt cancelled")}>
                I didn&apos;t send it — cancel
              </Button>
            </div>
            <Field label="Or paste the transaction hash" htmlFor="manual-hash">
              <div className="flex gap-2">
                <Input id="manual-hash" value={manual} onChange={(e) => setManual(e.target.value.trim())} placeholder="0x…" className="font-mono text-[12.5px]" />
                <Button
                  disabled={!/^0x[0-9a-fA-F]{64}$/.test(manual)}
                  loading={busy === "submit"}
                  onClick={() => action("submit", () => post(`/api/settlements/${sid}/submit`, { txHash: manual }), "Transaction submitted for verification")}
                >
                  Verify
                </Button>
              </div>
            </Field>
          </div>
        </Panel>
      )}
      {(s.status === "failed" || s.status === "rejected") && (
        <Callout tone="rose" className="no-print mt-5" title={s.status === "failed" ? "No MUSD moved" : "This transaction doesn't count"}>
          {s.failureReason} Your balance is unchanged. You can start a new payment from the group&apos;s balances.
        </Callout>
      )}

      <Panel className="no-print mt-5">
        <PanelHeader title="Status history" />
        <ol className="px-5 pb-4 text-[13px]">
          {q.data.events.map((e, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-3 border-l border-line py-1.5 pl-4">
              <span className="font-medium text-fg">{e.to_status}</span>
              <span className="text-fg-subtle">{formatDateTime(e.created_at)}</span>
              {e.detail && <span className="text-fg-muted">{e.detail}</span>}
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
