"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, FileCheck2, Fuel, ShieldCheck, Zap } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
import { SignInGate } from "@/components/shell/gate";
import { PreflightList, usePreflight } from "@/components/settle/preflight";
import { SettlementProgress } from "@/components/settle/progress";
import { Amount, methodLabel } from "@/components/money";
import { AddressChip, Avatar, displayName } from "@/components/identity";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Callout, Field, Input, PageHeader, Panel, Skeleton, StatRow } from "@/components/ui/primitives";
import { useGroup, useNetwork } from "@/lib/client/hooks";
import { ApiClientError, errorMessage, isUserRejection, post } from "@/lib/client/api";
import { followVerification, sendSettlement } from "@/lib/client/settle";
import { cn } from "@/lib/client/cn";
import { GAS_FLOORS } from "@/config/chains";
import { SETTLEMENT_CONTRACT } from "@/config/contracts";
import { maxSettleable } from "@/lib/engine/settlement";
import { parseAmount, toDecimalString } from "@/lib/engine/money";
import type { Settlement } from "@/lib/client/types";

type Method = "direct" | "contract_permit" | "contract";
const METHODS: Array<{ id: Method; title: string; body: string; Icon: typeof Zap; floor: bigint }> = [
  { id: "direct", title: "Direct transfer", body: "One MUSD transfer from your wallet to theirs. Simplest.", Icon: Zap, floor: GAS_FLOORS.erc20Transfer },
  {
    id: "contract_permit",
    title: "Settlement contract",
    body: "One free signature + one transaction. Tagged with an on-chain id that can never be paid twice.",
    Icon: ShieldCheck,
    floor: GAS_FLOORS.settleWithPermit,
  },
  { id: "contract", title: "Contract with approval", body: "For wallets that can't sign permits: approve, then settle (two transactions).", Icon: FileCheck2, floor: GAS_FLOORS.settle + GAS_FLOORS.erc20Approve },
];

export default function SettlePage() {
  return (
    <SignInGate title="Sign in to settle up">
      <Suspense>
        <SettleInner />
      </Suspense>
    </SignInGate>
  );
}

function SettleInner() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const to = (sp.get("to") ?? "").toLowerCase();
  const requestId = sp.get("request");
  const expenseId = sp.get("expense");
  const { data: b, isLoading } = useGroup(id);
  const network = useNetwork();
  const [method, setMethod] = useState<Method>("direct");
  const [amountStr, setAmountStr] = useState(() => {
    const a = sp.get("amount");
    try {
      return a ? toDecimalString(BigInt(a)) : "";
    } catch {
      return "";
    }
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [settlement, setSettlement] = useState<Settlement | null>(null);

  const amount = useMemo(() => {
    try {
      return parseAmount(amountStr);
    } catch {
      return null;
    }
  }, [amountStr]);
  const pre = usePreflight(amount ?? 0n);

  const max = (() => {
    if (!b) return 0n;
    const nets = new Map(Object.entries(b.ledger.nets).map(([k, v]) => [k, BigInt(v)]));
    const tx = (l: typeof b.ledger.simplified) => l.map((t) => ({ ...t, amount: BigInt(t.amount) }));
    return maxSettleable({
      from: b.me.address,
      to,
      nets,
      simplified: tx(b.ledger.simplified),
      pairwise: tx(b.ledger.pairwise),
      inFlight: b.settlements.filter((s) => s.status === "submitted" || s.status === "delayed").map((s) => ({ from: s.from, to: s.to, amount: BigInt(s.amount) })),
      activeMembers: new Set(b.members.filter((m) => m.status === "active").map((m) => m.address)),
    });
  })();

  if (isLoading || !b) return <Skeleton className="h-[480px]" />;
  const request = requestId ? b.requests.find((r) => r.id === requestId) : null;
  const recipient = b.members.find((m) => m.address === to);
  const me = b.me.address;
  if (!recipient || to === me) {
    return (
      <Panel className="p-6">
        <p className="text-fg-muted">Choose who to pay from the group&apos;s suggested settlements.</p>
        <Button className="mt-4" asChild>
          <Link href={`/groups/${id}?tab=balances`}>Open balances</Link>
        </Button>
      </Panel>
    );
  }
  const amountError =
    amountStr && amount === null ? "Enter an amount like 12.50" : amount !== null && amount > max ? `You can pay at most ${toDecimalString(max)} MUSD to this member right now` : null;
  const fee = network.data ? BigInt(network.data.gasPriceWei) * (METHODS.find((m) => m.id === method)!.floor) : null;

  async function execute() {
    if (!amount || !b) return;
    setConfirmOpen(false);
    setBusy(true);
    setStep("Recording the payment intent…");
    let current: Settlement | null = null;
    try {
      const { settlement: created } = await post<{ settlement: Settlement }>(`/api/groups/${id}/settlements`, {
        to,
        amount: amountStr,
        method,
        paymentRequestId: request?.id ?? null,
        expenseIds: expenseId ? [expenseId] : undefined,
      });
      current = created;
      setSettlement(created);
      const hash = await sendSettlement({ method, from: me, to, amount, settlementKey: created.settlementKey, onStep: setStep });
      setStep("Saving the transaction hash…");
      // persist the hash BEFORE waiting, so a refresh never loses track of the payment
      const { settlement: submitted } = await post<{ settlement: Settlement }>(`/api/settlements/${created.id}/submit`, { txHash: hash });
      setSettlement(submitted);
      setStep("Waiting for Mezo testnet to confirm and verifying the receipt…");
      const final = await followVerification(created.id, hash, setSettlement);
      if (final?.status === "confirmed") toast.success("Payment confirmed on-chain");
      else if (final?.status === "failed") toast.error("The transaction reverted — no MUSD moved");
      else if (final?.status === "rejected") toast.error("The transaction didn't match this payment");
      void qc.invalidateQueries();
    } catch (e) {
      if (current && current.status === "created") {
        if (isUserRejection(e)) {
          await post(`/api/settlements/${current.id}/cancel`).catch(() => undefined);
          toast.message("Cancelled in your wallet", { description: "Nothing was sent." });
          setSettlement(null);
        } else {
          toast.error("Payment not sent", { description: errorMessage(e) });
          setSettlement(null);
        }
      } else if (e instanceof ApiClientError) {
        toast.error(e.message);
        if (current) setSettlement({ ...current });
      } else {
        toast.error(errorMessage(e));
      }
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  const prof = b.profiles;
  const showProgress = settlement && settlement.status !== "created";
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/groups/${id}?tab=balances`} className="hover:text-fg">
            ← {b.group.name}
          </Link>
        }
        title="Settle up"
        description="Pay a group member in MUSD. Your balance updates only after the transfer is verified on-chain."
      />
      {showProgress || busy ? (
        <div className="mx-auto max-w-[560px]">
          <SettlementProgress settlement={settlement} step={step} profiles={prof} me={me} groupId={id} />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-5">
            <Panel raised className="p-6">
              <div className="flex items-center gap-4">
                <Avatar address={to} profile={prof[to]} size={52} />
                <div className="min-w-0">
                  <div className="text-[13px] text-fg-muted">Paying</div>
                  <div className="truncate font-display text-[22px] font-semibold">{displayName(to, prof)}</div>
                  <AddressChip address={to} full className="mt-0.5" />
                </div>
              </div>
              <p className="mt-3 text-[12.5px] text-fg-subtle">The wallet address above is where the MUSD goes. Check it matches the person you expect.</p>
              <div className="mt-5">
                <Field
                  label="Amount (MUSD)"
                  htmlFor="pay-amt"
                  error={amountError}
                  hint={request ? "Paying an exact payment request." : `You can pay up to ${toDecimalString(max)} MUSD to this member right now.`}
                >
                  <div className="flex gap-2">
                    <Input
                      id="pay-amt"
                      inputMode="decimal"
                      value={amountStr}
                      disabled={!!request}
                      aria-invalid={!!amountError}
                      onChange={(e) => setAmountStr(e.target.value.replace(/[^\d.]/g, ""))}
                      className="num h-12 font-display text-[22px] font-semibold"
                    />
                    {!request && max > 0n && (
                      <Button variant="secondary" className="h-12" onClick={() => setAmountStr(toDecimalString(max))}>
                        Max
                      </Button>
                    )}
                  </div>
                </Field>
              </div>
              {request && (
                <Callout tone="amber" className="mt-4" title="Payment request">
                  {request.note ? `“${request.note}” — ` : ""}requested {new Date(request.createdAt).toLocaleDateString()}
                </Callout>
              )}
            </Panel>
            <Panel className="p-6">
              <div className="mb-3 text-[13px] font-medium">How to pay</div>
              <div role="radiogroup" aria-label="Payment method" className="grid gap-2">
                {METHODS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={method === m.id}
                    onClick={() => setMethod(m.id)}
                    className={cn(
                      "flex items-start gap-3 rounded-[12px] border px-4 py-3 text-left transition-colors",
                      method === m.id ? "border-violet-500 bg-violet-500/10" : "border-line-strong bg-ink-900/40 hover:border-[#3a4677]",
                    )}
                  >
                    <m.Icon className={cn("mt-0.5 size-5 shrink-0", method === m.id ? "text-violet-300" : "text-fg-subtle")} />
                    <span>
                      <span className="block text-[14.5px] font-medium">{m.title}</span>
                      <span className="block text-[12.5px] text-fg-muted">{m.body}</span>
                    </span>
                  </button>
                ))}
              </div>
              {method !== "direct" && (
                <p className="mt-3 text-[12px] text-fg-subtle">
                  Contract{" "}
                  <a className="font-mono text-violet-300 hover:underline" href={`https://explorer.test.mezo.org/address/${SETTLEMENT_CONTRACT.address}`} target="_blank" rel="noreferrer">
                    {SETTLEMENT_CONTRACT.address.slice(0, 10)}…
                  </a>{" "}
                  is non-custodial: it pulls MUSD from you straight to the recipient in the same transaction and never holds funds.
                </p>
              )}
            </Panel>
          </div>
          <div className="space-y-5 lg:sticky lg:top-20 lg:self-start">
            <Panel className="p-5">
              <h2 className="mb-3 font-display text-[16px] font-semibold">Before you send</h2>
              <PreflightList rows={pre.rows} />
            </Panel>
            <Panel className="p-5">
              <dl className="divide-y divide-line">
                <StatRow label="You send">{amount ? <Amount value={amount} exact /> : "—"}</StatRow>
                <StatRow label="Method">{methodLabel(method)}</StatRow>
                <StatRow label="Network">Mezo testnet · 31611</StatRow>
                <StatRow
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      <Fuel className="size-3.5" /> Max network fee
                    </span>
                  }
                >
                  {fee !== null ? `≈ ${(Number(fee) / 1e18).toFixed(10)} BTC` : "—"}
                </StatRow>
              </dl>
              <Button size="lg" className="mt-4 w-full" disabled={!pre.ready || !amount || !!amountError || max === 0n} onClick={() => setConfirmOpen(true)}>
                Review payment <ArrowRight className="size-4" />
              </Button>
              {max === 0n && <p className="mt-2 text-[12.5px] text-fg-muted">Nothing to pay this member right now (or a payment is still confirming).</p>}
            </Panel>
          </div>
        </div>
      )}
      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Confirm payment"
        description="Your wallet will ask you to approve. Payments on a blockchain can't be reversed."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Go back
            </Button>
            <Button onClick={execute} loading={busy}>
              Send {amount ? toDecimalString(amount) : ""} MUSD
            </Button>
          </>
        }
      >
        <div className="rounded-[12px] border border-line bg-ink-900/60 p-4">
          <div className="text-center">
            <div className="font-display text-[34px] font-semibold">{amount && <Amount value={amount} exact />}</div>
            <div className="mt-1 text-[13px] text-fg-muted">to {displayName(to, prof)}</div>
            <div className="mt-1 font-mono text-[12px] break-all text-fg-subtle">{to}</div>
          </div>
          <dl className="mt-4 divide-y divide-line border-t border-line">
            <StatRow label="Method">{methodLabel(method)}</StatRow>
            <StatRow label="Token">MUSD · 0x1189…c503</StatRow>
            <StatRow label="From">{me.slice(0, 10)}…</StatRow>
          </dl>
        </div>
      </Dialog>
    </>
  );
}
