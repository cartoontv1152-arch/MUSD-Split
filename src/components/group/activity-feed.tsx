"use client";

import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  HandCoins,
  Link2,
  LogOut,
  Pencil,
  Receipt,
  Scale,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  UserPlus,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Amount } from "@/components/money";
import { MemberName, TxLink } from "@/components/identity";
import { formatDateTime, relativeTime } from "@/lib/client/cn";
import type { Activity, Profiles } from "@/lib/client/types";

const ICON: Record<string, [LucideIcon, string]> = {
  group_created: [Sparkles, "text-violet-300"],
  group_updated: [Settings2, "text-fg-muted"],
  member_joined: [UserPlus, "text-cyan-300"],
  member_left: [LogOut, "text-fg-muted"],
  member_removed: [LogOut, "text-fg-muted"],
  invite_created: [Link2, "text-fg-muted"],
  invite_revoked: [Link2, "text-fg-muted"],
  expense_added: [Receipt, "text-violet-300"],
  expense_edited: [Pencil, "text-fg-muted"],
  expense_deleted: [Trash2, "text-rose-400"],
  expense_adjusted: [Scale, "text-amber-300"],
  payment_requested: [HandCoins, "text-amber-300"],
  payment_request_cancelled: [XCircle, "text-fg-muted"],
  payment_request_declined: [XCircle, "text-fg-muted"],
  settlement_initiated: [Send, "text-sky-400"],
  settlement_confirmed: [CheckCircle2, "text-mint-400"],
  settlement_failed: [XCircle, "text-rose-400"],
  settlement_rejected: [AlertTriangle, "text-rose-400"],
  recurring_created: [CalendarClock, "text-violet-300"],
  recurring_run: [CalendarClock, "text-violet-300"],
};

function Sentence({ a, profiles, me }: { a: Activity; profiles: Profiles; me: string }) {
  const d = a.data as Record<string, string | number | boolean | null | undefined | string[]>;
  const actor = a.actor ? <MemberName address={a.actor} profiles={profiles} me={me} className="font-medium text-fg" /> : <span className="font-medium text-fg">Schedule</span>;
  const exp = d.expenseId ? (
    <Link href={`/groups/${a.groupId}/expenses/${d.expenseId}`} className="font-medium text-fg hover:underline">
      {String(d.title ?? "an expense")}
    </Link>
  ) : (
    <span className="font-medium text-fg">{String(d.title ?? "")}</span>
  );
  const amt = d.amount ? <Amount value={String(d.amount)} className="text-fg" /> : null;
  const to = d.to ? <MemberName address={String(d.to)} profiles={profiles} me={me} className="font-medium text-fg" /> : null;
  switch (a.type) {
    case "group_created":
      return <>{actor} created the group</>;
    case "group_updated":
      return <>{actor} updated group settings</>;
    case "member_joined":
      return <>{actor} joined the group</>;
    case "member_left":
      return <>{actor} left the group</>;
    case "member_removed":
      return (
        <>
          {actor} removed <MemberName address={String(d.member)} profiles={profiles} me={me} />
        </>
      );
    case "invite_created":
      return <>{actor} created an invite link</>;
    case "invite_revoked":
      return <>{actor} revoked an invite link</>;
    case "expense_added":
      return (
        <>
          {actor} added {exp} · {amt}
          {d.recurring ? " (recurring)" : ""}
        </>
      );
    case "expense_edited":
      return (
        <>
          {actor} edited {exp} · now {amt}
        </>
      );
    case "expense_deleted":
      return (
        <>
          {actor} deleted {exp} ({amt})
        </>
      );
    case "expense_adjusted":
      return (
        <>
          {actor} recorded an adjustment to {exp}
          {d.reason ? <span className="text-fg-muted"> — “{String(d.reason)}”</span> : null}
        </>
      );
    case "payment_requested":
      return (
        <>
          {actor} requested {amt} from <MemberName address={String(d.payer)} profiles={profiles} me={me} className="font-medium text-fg" />
        </>
      );
    case "payment_request_cancelled":
      return <>{actor} cancelled a payment request ({amt})</>;
    case "payment_request_declined":
      return <>{actor} declined a payment request ({amt})</>;
    case "settlement_initiated":
      return (
        <>
          {actor} sent {amt}
          {to ? <> to {to}</> : null} — waiting for confirmation
        </>
      );
    case "settlement_confirmed":
      return (
        <>
          {actor} paid {to} {amt} — verified on-chain
        </>
      );
    case "settlement_failed":
      return (
        <>
          {actor}&apos;s payment of {amt} to {to} failed on-chain
        </>
      );
    case "settlement_rejected":
      return (
        <>
          A transaction submitted by {actor} for {amt} was not accepted: <span className="text-fg-muted">{String(d.reason ?? "")}</span>
        </>
      );
    case "recurring_created":
      return (
        <>
          {actor} scheduled {exp} ({String(d.cadence)}) · {amt}
        </>
      );
    case "recurring_run":
      return <>Recurring bill {exp} was added automatically</>;
    default:
      return <>{a.type}</>;
  }
}

export function ActivityFeed({ items, profiles, me, showGroup }: { items: Activity[]; profiles: Profiles; me: string; showGroup?: boolean }) {
  if (items.length === 0) return <p className="px-5 py-8 text-center text-[14px] text-fg-muted">No activity yet.</p>;
  return (
    <ol className="relative px-5 pb-4">
      {items.map((a) => {
        const [Icon, color] = ICON[a.type] ?? [Sparkles, "text-fg-muted"];
        const tx = (a.data as { txHash?: string }).txHash;
        return (
          <li key={a.id} className="relative flex gap-3 py-3 before:absolute before:top-10 before:bottom-0 before:left-[15px] before:w-px before:bg-line last:before:hidden">
            <span className={`relative z-[1] grid size-8 shrink-0 place-items-center rounded-full border border-line-strong bg-ink-800 ${color}`}>
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 pt-1 text-[13.5px] leading-relaxed text-fg-muted">
              <Sentence a={a} profiles={profiles} me={me} />
              {tx && (
                <div className="mt-0.5">
                  <TxLink hash={tx} />
                </div>
              )}
              <div className="text-[12px] text-fg-subtle" title={formatDateTime(a.createdAt)}>
                {showGroup && a.groupName ? `${a.groupName} · ` : ""}
                {relativeTime(a.createdAt)}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
