"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { SignInGate } from "@/components/shell/gate";
import { Amount, ExpenseStatusPill, SettlementStatusPill } from "@/components/money";
import { MemberName, TxLink } from "@/components/identity";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Badge, Field, PageHeader, Panel, PanelHeader, Skeleton, StatRow, Textarea } from "@/components/ui/primitives";
import { useSession } from "@/components/providers/session";
import { api, del, errorMessage } from "@/lib/client/api";
import { categoryLabel } from "@/config/app";
import { formatDate, formatDateTime } from "@/lib/client/cn";
import type { Expense, Profiles, Settlement } from "@/lib/client/types";

interface Detail {
  expense: Expense;
  canEdit: boolean;
  revisions: Array<{ id: string; version: number; action: string; isAdjustment: boolean; reason: string | null; deltas: Record<string, string>; actor: string; createdAt: string; snapshot: { amount?: string; title?: string } }>;
  settlements: Settlement[];
  receipt: { id: string; mime: string; size: number; filename: string | null } | null;
  profiles: Profiles;
  groupName: string;
}

export default function ExpenseDetailPage() {
  return (
    <SignInGate>
      <Inner />
    </SignInGate>
  );
}

function Inner() {
  const { id, eid } = useParams<{ id: string; eid: string }>();
  const { address: me } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ["expense", eid], queryFn: () => api<Detail>(`/api/groups/${id}/expenses/${eid}`) });
  const [delOpen, setDelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  if (isLoading) return <Skeleton className="h-96" />;
  if (error || !data) return <Panel className="p-6 text-fg-muted">{errorMessage(error)}</Panel>;
  const e = data.expense;
  const p = data.profiles;
  const outstandingByMember = Object.fromEntries((e.coverage ?? []).map((c) => [c.member, c]));
  const myShare = e.participants.find((x) => x.address === me);
  const myOutstanding = me ? outstandingByMember[me]?.outstanding : undefined;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/groups/${id}?tab=expenses`} className="hover:text-fg">
            ← {data.groupName}
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {e.title} <ExpenseStatusPill status={e.status} />
          </span>
        }
        description={`${categoryLabel(e.category)} · ${formatDate(e.date)}${e.recurringId ? " · from a recurring schedule" : ""}`}
        actions={
          data.canEdit && (
            <>
              <Button variant="danger" onClick={() => setDelOpen(true)}>
                <Trash2 className="size-4" /> Delete
              </Button>
              <Button variant="secondary" asChild>
                <Link href={`/groups/${id}/expenses/${eid}/edit`}>
                  <Pencil className="size-4" /> Edit
                </Link>
              </Button>
            </>
          )
        }
      />
      {e.deletedAt && (
        <Panel className="mb-5 border-rose-400/30 px-5 py-3 text-[14px] text-rose-300">
          Deleted {formatDateTime(e.deletedAt)}
          {e.deleteReason ? ` — “${e.deleteReason}”` : ""}. It no longer counts toward balances; its history is kept below.
        </Panel>
      )}
      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-5">
          <Panel raised className="p-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-[13px] text-fg-muted">Total</div>
                <div className="font-display text-[38px] leading-none font-semibold tracking-[-0.02em]">
                  <Amount value={e.amount} />
                </div>
              </div>
              <div className="text-right text-[14px]">
                <div className="text-fg-muted">Paid by</div>
                <MemberName address={e.payer} profiles={p} me={me} withAvatar className="font-medium" />
              </div>
            </div>
            {myShare && e.payer !== me && (
              <p className="mt-4 rounded-[10px] bg-ink-900/60 px-3 py-2 text-[13.5px] text-fg-muted">
                Your share is <Amount value={myShare.share} className="text-fg" />.{" "}
                {myOutstanding && BigInt(myOutstanding) > 0n ? (
                  <>
                    <Amount value={myOutstanding} className="text-amber-300" /> of it is still outstanding.{" "}
                    <Link href={`/groups/${id}/settle?to=${e.payer}&amount=${myOutstanding}&expense=${e.id}`} className="text-violet-300 hover:underline">
                      Pay it now
                    </Link>
                  </>
                ) : (
                  "It's covered."
                )}
              </p>
            )}
          </Panel>
          <Panel>
            <PanelHeader title="Individual shares" description={`Split ${e.splitMethod === "equal" ? "equally" : `by ${e.splitMethod}`} between ${e.participants.length} people.`} />
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-y border-line text-left text-[12px] text-fg-subtle">
                  <th className="px-5 py-2 font-medium">Member</th>
                  <th className="px-3 py-2 font-medium">Input</th>
                  <th className="px-3 py-2 text-right font-medium">Share</th>
                  <th className="px-5 py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {e.participants.map((x) => {
                  const c = outstandingByMember[x.address];
                  const isPayer = x.address === e.payer;
                  const out = c ? BigInt(c.outstanding) : 0n;
                  return (
                    <tr key={x.address}>
                      <td className="px-5 py-2.5">
                        <MemberName address={x.address} profiles={p} me={me} withAvatar />
                      </td>
                      <td className="px-3 py-2.5 text-fg-subtle">{x.input ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right">
                        <Amount value={x.share} />
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        {e.deletedAt ? (
                          <span className="text-fg-subtle">—</span>
                        ) : isPayer ? (
                          <Badge tone="violet">Paid the bill</Badge>
                        ) : out === 0n ? (
                          <Badge tone="mint">Covered</Badge>
                        ) : (
                          <Badge tone="amber">
                            Owes <Amount value={out} unit={false} />
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="px-5 py-3 text-[12px] text-fg-subtle">
              Coverage follows first-in-first-out: a member&apos;s payments and offsets pay down their oldest shares first.
            </p>
          </Panel>
          <Panel>
            <PanelHeader title="Audit history" description="Every version of this expense and how it moved each balance." />
            <ol className="divide-y divide-line px-5 pb-3">
              {data.revisions.map((r) => (
                <li key={r.id} className="py-3 text-[13.5px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={r.action === "deleted" ? "rose" : r.isAdjustment ? "amber" : r.action === "created" ? "violet" : "neutral"}>
                      v{r.version} · {r.isAdjustment ? "adjustment" : r.action}
                    </Badge>
                    <MemberName address={r.actor} profiles={p} me={me} className="font-medium" />
                    <span className="text-fg-subtle">{formatDateTime(r.createdAt)}</span>
                  </div>
                  {r.reason && <p className="mt-1 text-fg-muted">“{r.reason}”</p>}
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-fg-muted">
                    {Object.entries(r.deltas).map(([a, d]) => (
                      <span key={a}>
                        <MemberName address={a} profiles={p} me={me} />: <Amount value={d} signed tone="auto" />
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel>
            <PanelHeader title="Details" />
            <dl className="divide-y divide-line px-5 pb-3">
              <StatRow label="Date">{formatDate(e.date)}</StatRow>
              <StatRow label="Category">{categoryLabel(e.category)}</StatRow>
              <StatRow label="Added by">
                <MemberName address={e.createdBy} profiles={p} me={me} />
              </StatRow>
              <StatRow label="Added">{formatDateTime(e.createdAt)}</StatRow>
              <StatRow label="Version">v{e.version}</StatRow>
              <StatRow label="Currency">MUSD (settled on Mezo testnet)</StatRow>
            </dl>
            {e.notes && <p className="border-t border-line px-5 py-3 text-[14px] whitespace-pre-wrap text-fg-muted">{e.notes}</p>}
          </Panel>
          {data.receipt && (
            <Panel className="p-5">
              <h2 className="mb-3 font-display text-[16px] font-semibold">Receipt</h2>
              {data.receipt.mime.startsWith("image/") ? (
                <a href={`/api/receipts/${data.receipt.id}`} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/receipts/${data.receipt.id}`} alt="Receipt" className="max-h-[360px] w-full rounded-[12px] border border-line object-contain" />
                </a>
              ) : (
                <a href={`/api/receipts/${data.receipt.id}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-violet-300 hover:underline">
                  <FileText className="size-4" /> {data.receipt.filename ?? "Receipt.pdf"}
                </a>
              )}
              <p className="mt-2 text-[12px] text-fg-subtle">Visible to group members only.</p>
            </Panel>
          )}
          <Panel>
            <PanelHeader title="Related payments" description="On-chain settlements linked to this expense." />
            {data.settlements.length === 0 ? (
              <p className="px-5 pb-5 text-[13.5px] text-fg-muted">None linked yet.</p>
            ) : (
              <ul className="divide-y divide-line px-5 pb-3">
                {data.settlements.map((s) => (
                  <li key={s.id} className="py-2.5 text-[13.5px]">
                    <div className="flex items-center justify-between gap-2">
                      <span>
                        <MemberName address={s.from} profiles={p} me={me} /> → <MemberName address={s.to} profiles={p} me={me} />
                      </span>
                      <Amount value={s.amount} />
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      {s.txHash ? <TxLink hash={s.txHash} /> : <span />}
                      <Link href={`/settlements/${s.id}`}>
                        <SettlementStatusPill status={s.status} />
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
      <Dialog
        open={delOpen}
        onOpenChange={setDelOpen}
        title="Delete this expense?"
        description="Balances are recalculated. The expense and its history stay visible in the audit trail."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDelOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              loading={deleting}
              onClick={async () => {
                setDeleting(true);
                try {
                  await del(`/api/groups/${id}/expenses/${eid}`, { expectedVersion: e.version, reason: reason || null });
                  toast.success("Expense deleted");
                  await qc.invalidateQueries();
                  router.push(`/groups/${id}?tab=expenses`);
                } catch (err) {
                  toast.error("Couldn't delete", { description: errorMessage(err) });
                  setDeleting(false);
                }
              }}
            >
              Delete expense
            </Button>
          </>
        }
      >
        <Field label="Reason" htmlFor="del-reason" hint={e.status !== "open" ? "Required — part of this expense was already settled." : "Optional"}>
          <Textarea id="del-reason" value={reason} maxLength={280} onChange={(ev) => setReason(ev.target.value)} />
        </Field>
      </Dialog>
    </>
  );
}
