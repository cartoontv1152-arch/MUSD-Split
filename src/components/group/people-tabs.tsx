"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Copy, HandCoins, Link2, Pause, Play, QrCode, RefreshCw, ShieldCheck, UserMinus } from "lucide-react";
import QRCode from "qrcode";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Amount, NetLabel } from "@/components/money";
import { AddressChip, MemberName } from "@/components/identity";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Badge, EmptyState, Field, Input, Panel, PanelHeader, Select, Textarea } from "@/components/ui/primitives";
import { api, del, errorMessage, patch, post } from "@/lib/client/api";
import { formatDate, formatDateTime, relativeTime } from "@/lib/client/cn";
import { categoryLabel } from "@/config/app";
import type { GroupBundle, PaymentRequest } from "@/lib/client/types";

interface Invite {
  id: string;
  token: string;
  label: string | null;
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
  state: "active" | "revoked" | "expired" | "used_up";
}

function InviteCard({ invite, groupId, canRevoke }: { invite: Invite; groupId: string; canRevoke: boolean }) {
  const qc = useQueryClient();
  const [qr, setQr] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const link = typeof window !== "undefined" ? `${window.location.origin}/join/${invite.token}` : `/join/${invite.token}`;
  useEffect(() => {
    if (showQr && !qr) void QRCode.toDataURL(link, { margin: 1, width: 360, color: { dark: "#0a0f22", light: "#eceeff" } }).then(setQr);
  }, [showQr, qr, link]);
  const active = invite.state === "active";
  return (
    <li className="rounded-[12px] border border-line-strong bg-ink-900/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13.5px]">
          <Link2 className="size-4 text-violet-300" />
          <span className="font-medium">{invite.label || "Invite link"}</span>
          <Badge tone={active ? "mint" : "neutral"}>{active ? "Active" : invite.state.replace("_", " ")}</Badge>
        </div>
        <span className="text-[12px] text-fg-subtle">
          {invite.uses}
          {invite.maxUses ? ` / ${invite.maxUses}` : ""} joined · {invite.expiresAt ? `expires ${relativeTime(invite.expiresAt)}` : "no expiry"}
        </span>
      </div>
      {active && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Input readOnly value={link} aria-label="Invite link" className="min-w-0 flex-1 font-mono text-[12.5px]" onFocus={(e) => e.currentTarget.select()} />
          <Button
            size="md"
            variant="secondary"
            onClick={() => {
              void navigator.clipboard.writeText(link);
              toast.success("Invite link copied");
            }}
          >
            <Copy className="size-4" /> Copy
          </Button>
          <Button size="icon" variant="secondary" onClick={() => setShowQr(true)} aria-label="Show QR code">
            <QrCode className="size-4" />
          </Button>
          {canRevoke && (
            <Button
              size="md"
              variant="danger"
              onClick={async () => {
                try {
                  await del(`/api/groups/${groupId}/invites/${invite.id}`);
                  toast.success("Invite revoked — the link no longer works");
                  void qc.invalidateQueries({ queryKey: ["invites", groupId] });
                } catch (e) {
                  toast.error("Couldn't revoke", { description: errorMessage(e) });
                }
              }}
            >
              Revoke
            </Button>
          )}
        </div>
      )}
      <Dialog open={showQr} onOpenChange={setShowQr} title="Scan to join" description="Point a phone camera here to open the invite.">
        <div className="flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {qr ? <img src={qr} alt="Invite QR code" className="size-[260px] rounded-xl" /> : <div className="size-[260px] animate-pulse rounded-xl bg-ink-750" />}
        </div>
      </Dialog>
    </li>
  );
}

export function MembersTab({ b, openInvite }: { b: GroupBundle; openInvite?: boolean }) {
  const qc = useQueryClient();
  const router = useRouter();
  const invites = useQuery({
    queryKey: ["invites", b.group.id],
    queryFn: () => api<{ canInvite: boolean; canManage: boolean; invites: Invite[] }>(`/api/groups/${b.group.id}/invites`),
  });
  const [expires, setExpires] = useState("168");
  const [maxUses, setMaxUses] = useState("");
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [newOpen, setNewOpen] = useState(!!openInvite);

  async function create() {
    setCreating(true);
    try {
      await post(`/api/groups/${b.group.id}/invites`, {
        expiresInHours: expires === "never" ? null : Number(expires),
        maxUses: maxUses ? Number(maxUses) : null,
        label: label || null,
      });
      toast.success("Invite link created");
      setNewOpen(false);
      void qc.invalidateQueries({ queryKey: ["invites", b.group.id] });
    } catch (e) {
      toast.error("Couldn't create invite", { description: errorMessage(e) });
    } finally {
      setCreating(false);
    }
  }

  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      toast.success(ok);
      void qc.invalidateQueries({ queryKey: ["group", b.group.id] });
    } catch (e) {
      toast.error("That didn't work", { description: errorMessage(e) });
    }
  }

  const active = b.members.filter((m) => m.status === "active");
  const former = b.members.filter((m) => m.status !== "active");
  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
      <Panel>
        <PanelHeader title={`Members · ${active.length}`} description="Wallet addresses are the source of truth for every payment." />
        <ul className="divide-y divide-line px-5 pb-3">
          {active.map((m) => (
            <li key={m.address} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <MemberName address={m.address} profiles={b.profiles} me={b.me.address} withAvatar size={30} className="text-[14.5px] font-medium" />
                  {m.role !== "member" && <Badge tone={m.role === "owner" ? "violet" : "sky"}>{m.role}</Badge>}
                </div>
                <div className="mt-0.5 pl-[38px]">
                  <AddressChip address={m.address} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <NetLabel net={m.net} className="text-[13px]" />
                {b.me.isAdmin && m.address !== b.me.address && (
                  <>
                    {m.role === "member" ? (
                      <Button size="sm" variant="ghost" onClick={() => act(() => patch(`/api/groups/${b.group.id}/members/${m.address}`, { role: "admin" }), "Made admin")}>
                        <ShieldCheck className="size-4" /> Make admin
                      </Button>
                    ) : m.role === "admin" ? (
                      <Button size="sm" variant="ghost" onClick={() => act(() => patch(`/api/groups/${b.group.id}/members/${m.address}`, { role: "member" }), "Admin removed")}>
                        Remove admin
                      </Button>
                    ) : null}
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Remove member"
                      title={BigInt(m.net) !== 0n ? "Members with an open balance can't be removed" : "Remove from group"}
                      disabled={BigInt(m.net) !== 0n}
                      onClick={() => act(() => del(`/api/groups/${b.group.id}/members/${m.address}`), "Member removed")}
                    >
                      <UserMinus className="size-4" />
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        {former.length > 0 && (
          <div className="border-t border-line px-5 py-3 text-[12.5px] text-fg-subtle">
            Former members: {former.map((m) => b.profiles[m.address]?.displayName || m.address.slice(0, 8)).join(", ")}
          </div>
        )}
        <div className="border-t border-line px-5 py-3">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              act(async () => {
                await post(`/api/groups/${b.group.id}/leave`);
                router.push("/groups");
              }, "You left the group")
            }
          >
            Leave group
          </Button>
        </div>
      </Panel>
      <Panel>
        <PanelHeader
          title="Invite people"
          description="Anyone with an active link can join after signing in with their wallet."
          action={
            invites.data?.canInvite ? (
              <Button size="sm" onClick={() => setNewOpen(true)}>
                <Link2 className="size-4" /> New link
              </Button>
            ) : null
          }
        />
        <div className="px-5 pb-5">
          {invites.data && !invites.data.canInvite ? (
            <p className="text-[14px] text-fg-muted">Only admins can invite people to this group.</p>
          ) : (invites.data?.invites.length ?? 0) === 0 ? (
            <EmptyState icon={<Link2 className="size-5" />} title="No invite links yet" action={<Button onClick={() => setNewOpen(true)}>Create invite link</Button>}>
              Links can expire and be revoked at any time.
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {invites.data!.invites.map((i) => (
                <InviteCard key={i.id} invite={i} groupId={b.group.id} canRevoke={!!invites.data?.canManage || i.createdBy === b.me.address} />
              ))}
            </ul>
          )}
        </div>
      </Panel>
      <Dialog
        open={newOpen}
        onOpenChange={setNewOpen}
        title="New invite link"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button loading={creating} onClick={create}>
              Create link
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Expires" htmlFor="exp">
            <Select id="exp" value={expires} onChange={(e) => setExpires(e.target.value)}>
              <option value="24">In 24 hours</option>
              <option value="168">In 7 days</option>
              <option value="720">In 30 days</option>
              <option value="never">Never</option>
            </Select>
          </Field>
          <Field label="Max people" htmlFor="max" hint="Leave empty for no limit.">
            <Input id="max" inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label="Label" htmlFor="lbl" hint="Optional, e.g. “Flatmates chat”.">
            <Input id="lbl" maxLength={40} value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

const REQ_TONE: Record<PaymentRequest["status"], "amber" | "mint" | "neutral" | "rose"> = {
  pending: "amber",
  paid: "mint",
  cancelled: "neutral",
  declined: "rose",
  expired: "neutral",
};

export function RequestRow({ r, me, profiles, onChanged }: { r: PaymentRequest; me: string; profiles: GroupBundle["profiles"]; onChanged: () => void }) {
  const incoming = r.payer === me;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0 text-[14px]">
        <div className="flex flex-wrap items-center gap-1.5">
          {incoming ? (
            <>
              <MemberName address={r.requester} profiles={profiles} me={me} withAvatar className="font-medium" /> asked you
            </>
          ) : (
            <>
              You asked <MemberName address={r.payer} profiles={profiles} me={me} withAvatar className="font-medium" />
            </>
          )}
          <Badge tone={REQ_TONE[r.status]}>{r.status}</Badge>
        </div>
        <div className="mt-0.5 text-[12.5px] text-fg-subtle">
          {r.groupName ? `${r.groupName} · ` : ""}
          {formatDateTime(r.createdAt)}
          {r.expiresAt && r.status === "pending" ? ` · expires ${relativeTime(r.expiresAt)}` : ""}
          {r.note ? ` · “${r.note}”` : ""}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Amount value={r.amount} className="font-semibold" />
        {r.status === "pending" && incoming && (
          <>
            <Button size="sm" asChild>
              <Link href={`/groups/${r.groupId}/settle?to=${r.requester}&amount=${r.amount}&request=${r.id}`}>Pay</Link>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                try {
                  await post(`/api/requests/${r.id}/decline`);
                  toast.success("Request declined");
                  onChanged();
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}
            >
              Decline
            </Button>
          </>
        )}
        {r.status === "pending" && !incoming && (
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              try {
                await post(`/api/requests/${r.id}/cancel`);
                toast.success("Request cancelled");
                onChanged();
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
          >
            Cancel
          </Button>
        )}
        {r.status === "paid" && r.paidSettlementId && (
          <Link href={`/settlements/${r.paidSettlementId}`} className="text-[12.5px] text-violet-300 hover:underline">
            Receipt
          </Link>
        )}
      </div>
    </li>
  );
}

export function RequestsTab({ b, ask, askAmount }: { b: GroupBundle; ask?: string | null; askAmount?: string | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(!!ask);
  const debtors = b.members.filter((m) => m.status === "active" && BigInt(m.net) < 0n && m.address !== b.me.address);
  const [payer, setPayer] = useState(ask ?? debtors[0]?.address ?? "");
  const owed = (() => {
    const m = b.members.find((x) => x.address === payer);
    return m && BigInt(m.net) < 0n ? -BigInt(m.net) : 0n;
  })();
  const toDec = (v: bigint) => (Number(v / 10n ** 16n) / 100).toFixed(2);
  const [amount, setAmount] = useState(askAmount ? toDec(BigInt(askAmount)) : "");
  const [note, setNote] = useState("");
  const [days, setDays] = useState("14");
  const [saving, setSaving] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["group", b.group.id] });

  async function submit() {
    setSaving(true);
    try {
      await post(`/api/groups/${b.group.id}/requests`, { payer, amount, note: note || null, expiresInDays: days === "never" ? null : Number(days) });
      toast.success("Payment request sent");
      setOpen(false);
      setAmount("");
      setNote("");
      refresh();
    } catch (e) {
      toast.error("Couldn't send request", { description: errorMessage(e) });
    } finally {
      setSaving(false);
    }
  }
  return (
    <Panel>
      <PanelHeader
        title="Payment requests"
        description="A request is a reminder, not proof of payment. Only a verified on-chain transfer marks it paid."
        action={
          <Button size="sm" onClick={() => setOpen(true)} disabled={debtors.length === 0} title={debtors.length === 0 ? "Nobody owes money in this group" : undefined}>
            <HandCoins className="size-4" /> Request payment
          </Button>
        }
      />
      {b.requests.length === 0 ? (
        <EmptyState icon={<HandCoins className="size-5" />} title="No requests yet">
          Ask a member to settle what they owe you — they can pay it in MUSD right from the request.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line px-5 pb-3">
          {b.requests.map((r) => (
            <RequestRow key={r.id} r={r} me={b.me.address} profiles={b.profiles} onChanged={refresh} />
          ))}
        </ul>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Request a payment"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={saving} disabled={!payer || !amount} onClick={submit}>
              Send request
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Who should pay" htmlFor="rq-payer">
            <Select id="rq-payer" value={payer} onChange={(e) => setPayer(e.target.value)}>
              {debtors.map((m) => (
                <option key={m.address} value={m.address}>
                  {b.profiles[m.address]?.displayName || m.address}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount (MUSD)" htmlFor="rq-amt" hint={owed > 0n ? `They owe ${toDec(owed)} MUSD in this group.` : undefined}>
            <div className="flex gap-2">
              <Input id="rq-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="num" />
              {owed > 0n && (
                <Button variant="secondary" onClick={() => setAmount(toDec(owed))}>
                  Full amount
                </Button>
              )}
            </div>
          </Field>
          <Field label="Note" htmlFor="rq-note" hint="Optional">
            <Textarea id="rq-note" maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Field label="Expires" htmlFor="rq-exp">
            <Select id="rq-exp" value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="3">In 3 days</option>
              <option value="14">In 14 days</option>
              <option value="30">In 30 days</option>
              <option value="never">Never</option>
            </Select>
          </Field>
        </div>
      </Dialog>
    </Panel>
  );
}

export function RecurringTab({ b }: { b: GroupBundle }) {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["group", b.group.id] });
  return (
    <Panel>
      <PanelHeader
        title="Recurring bills"
        description="Rent, internet, subscriptions. Each run adds an expense record on its date — money never moves automatically."
        action={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={running}
              onClick={async () => {
                setRunning(true);
                try {
                  const r = await post<{ created: number; reminded: number }>(`/api/groups/${b.group.id}/recurring/run`);
                  toast.success(r.created ? `Added ${r.created} due expense${r.created === 1 ? "" : "s"}` : "Nothing due today");
                  refresh();
                } catch (e) {
                  toast.error(errorMessage(e));
                } finally {
                  setRunning(false);
                }
              }}
            >
              <RefreshCw className="size-4" /> Check now
            </Button>
            <Button size="sm" asChild>
              <Link href={`/groups/${b.group.id}/expenses/new?recurring=1`}>
                <CalendarClock className="size-4" /> New schedule
              </Link>
            </Button>
          </div>
        }
      />
      {b.recurring.length === 0 ? (
        <EmptyState icon={<CalendarClock className="size-5" />} title="No recurring bills">
          Schedule a weekly or monthly shared bill. Members get a reminder before it&apos;s added.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line px-5 pb-3">
          {b.recurring.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[14.5px] font-medium">
                  {r.title} {!r.active && <Badge>Paused</Badge>}
                </div>
                <div className="text-[12.5px] text-fg-subtle">
                  {r.intervalCount > 1 ? `Every ${r.intervalCount} ${r.cadence === "weekly" ? "weeks" : "months"}` : r.cadence === "weekly" ? "Weekly" : "Monthly"} ·{" "}
                  {categoryLabel(r.category)} · paid by <MemberName address={r.payer} profiles={b.profiles} me={b.me.address} /> · next {formatDate(r.nextRunOn)}
                  {r.endOn ? ` · ends ${formatDate(r.endOn)}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Amount value={r.amount} className="font-medium" />
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={r.active ? "Pause schedule" : "Resume schedule"}
                  onClick={async () => {
                    try {
                      await patch(`/api/groups/${b.group.id}/recurring/${r.id}`, { active: !r.active });
                      refresh();
                    } catch (e) {
                      toast.error(errorMessage(e));
                    }
                  }}
                >
                  {r.active ? <Pause className="size-4" /> : <Play className="size-4" />}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-line px-5 py-3 text-[12px] text-fg-subtle">
        <CalendarClock className="mr-1 inline size-3" /> Schedules run once a day (06:00 UTC) and whenever someone presses “Check now”.
      </p>
    </Panel>
  );
}
