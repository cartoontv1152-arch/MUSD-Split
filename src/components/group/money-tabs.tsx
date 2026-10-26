"use client";

import { ArrowRight, Download, Filter, Layers, Receipt } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Amount, BalanceBar, ExpenseStatusPill, NetLabel, SettlementStatusPill } from "@/components/money";
import { Avatar, MemberName, TxLink } from "@/components/identity";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Input, Panel, PanelHeader, Select } from "@/components/ui/primitives";
import { DebtMap } from "./debt-map";
import { EXPENSE_CATEGORIES, categoryLabel } from "@/config/app";
import { formatDate, relativeTime } from "@/lib/client/cn";
import type { GroupBundle } from "@/lib/client/types";

export function SuggestedSettlements({ b }: { b: GroupBundle }) {
  const me = b.me.address;
  const route = b.group.simplifyDebts ? b.ledger.simplified : b.ledger.pairwise;
  const mine = route.filter((t) => t.from === me);
  const inFlight = b.settlements.filter((s) => s.status === "submitted" || s.status === "delayed");
  return (
    <Panel>
      <PanelHeader
        title="Suggested settlements"
        description={b.group.simplifyDebts ? "Fewest payments that bring everyone to zero. Nothing moves until a payer approves it." : "Direct debts between each pair, as recorded."}
        action={
          mine.length > 1 ? (
            <Button size="sm" variant="cyan" asChild>
              <Link href={`/groups/${b.group.id}/settle-all`}>
                <Layers className="size-4" /> Settle all in one tx
              </Link>
            </Button>
          ) : null
        }
      />
      {route.length === 0 ? (
        <EmptyState title="Everyone is settled up">No payments needed right now.</EmptyState>
      ) : (
        <ul className="divide-y divide-line px-5 pb-4">
          {route.map((t) => {
            const isMine = t.from === me;
            const flying = inFlight.find((s) => s.from === t.from && s.to === t.to);
            return (
              <li key={t.from + t.to} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="flex min-w-0 items-center gap-2 text-[14px]">
                  <MemberName address={t.from} profiles={b.profiles} me={me} withAvatar className="font-medium" />
                  <ArrowRight className="size-4 shrink-0 text-cyan-400" aria-label="pays" />
                  <MemberName address={t.to} profiles={b.profiles} me={me} withAvatar className="font-medium" />
                </div>
                <div className="flex items-center gap-3">
                  <Amount value={t.amount} className="font-semibold" />
                  {flying ? (
                    <Link href={`/settlements/${flying.id}`}>
                      <SettlementStatusPill status={flying.status} />
                    </Link>
                  ) : isMine ? (
                    <Button size="sm" asChild>
                      <Link href={`/groups/${b.group.id}/settle?to=${t.to}&amount=${t.amount}`}>Pay</Link>
                    </Button>
                  ) : t.to === me ? (
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/groups/${b.group.id}?tab=requests&ask=${t.from}&amount=${t.amount}`}>Request</Link>
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function BalancesTab({ b }: { b: GroupBundle }) {
  const members = b.members.filter((m) => m.status === "active" || BigInt(m.net) !== 0n);
  const max = members.reduce((a, m) => {
    const v = BigInt(m.net) < 0n ? -BigInt(m.net) : BigInt(m.net);
    return v > a ? v : a;
  }, 0n);
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
      <div className="space-y-5">
        <Panel>
          <PanelHeader title="Balances" description="Positive means the member should get money back; negative means they owe." />
          <ul className="space-y-1 px-5 pb-5">
            {members.map((m) => {
              const net = BigInt(m.net);
              return (
                <li key={m.address} className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-x-4 gap-y-1.5 py-2 sm:grid-cols-[minmax(0,1fr)_160px_150px]">
                  <MemberName address={m.address} profiles={b.profiles} me={b.me.address} withAvatar size={26} className="text-[14px] font-medium" />
                  <BalanceBar net={net} max={max} className="order-3 col-span-2 sm:order-none sm:col-span-1" />
                  <div className="text-right text-[13.5px]">
                    <NetLabel net={net} />
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-line px-5 py-3 text-[12.5px] text-fg-subtle">
            <span>
              Spent <Amount value={b.ledger.totalSpent} className="text-fg-muted" />
            </span>
            <span>
              Settled on-chain <Amount value={b.ledger.totalSettled} className="text-fg-muted" />
            </span>
            <span>
              Outstanding <Amount value={b.ledger.outstanding} className="text-fg-muted" />
            </span>
          </div>
        </Panel>
        <SuggestedSettlements b={b} />
      </div>
      <Panel className="p-5">
        <h2 className="mb-1 font-display text-[17px] font-semibold">Debt map</h2>
        <p className="mb-4 text-[13px] text-fg-muted">Every arrow is money owed. Simplifying keeps everyone&apos;s final balance identical.</p>
        <DebtMap
          members={b.members.filter((m) => m.status === "active" || BigInt(m.net) !== 0n).map((m) => m.address)}
          pairwise={b.ledger.pairwise}
          simplified={b.ledger.simplified}
          profiles={b.profiles}
          me={b.me.address}
        />
      </Panel>
    </div>
  );
}

export function ExpensesTab({ b }: { b: GroupBundle }) {
  const [member, setMember] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const list = useMemo(
    () =>
      b.expenses.filter(
        (e) =>
          (!member || e.payer === member || e.participants.some((p) => p.address === member)) &&
          (!category || e.category === category) &&
          (!status || e.status === status) &&
          (!from || e.date >= from) &&
          (!to || e.date <= to) &&
          (!q || e.title.toLowerCase().includes(q.toLowerCase())),
      ),
    [b.expenses, member, category, status, from, to, q],
  );
  const filtered = member || category || status || from || to || q;
  return (
    <Panel>
      <PanelHeader
        title="Expenses"
        description={`${b.expenses.length} recorded · ${filtered ? `${list.length} shown` : "newest first"}`}
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" asChild>
              <a href={`/api/groups/${b.group.id}/export`} download>
                <Download className="size-4" /> CSV
              </a>
            </Button>
            <Button size="sm" asChild>
              <Link href={`/groups/${b.group.id}/expenses/new`}>
                <Receipt className="size-4" /> Add expense
              </Link>
            </Button>
          </div>
        }
      />
      <div className="grid gap-2 px-5 pb-4 sm:grid-cols-2 lg:grid-cols-6">
        <Input aria-label="Search expenses" placeholder="Search title" value={q} onChange={(e) => setQ(e.target.value)} className="lg:col-span-2" />
        <Select aria-label="Member" value={member} onChange={(e) => setMember(e.target.value)}>
          <option value="">Any member</option>
          {b.members.map((m) => (
            <option key={m.address} value={m.address}>
              {b.profiles[m.address]?.displayName || m.address.slice(0, 10)}
            </option>
          ))}
        </Select>
        <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Any category</option>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
        <Select aria-label="Settlement status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          <option value="open">Open</option>
          <option value="partial">Partly settled</option>
          <option value="settled">Settled</option>
        </Select>
        <div className="flex gap-2">
          <Input aria-label="From date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input aria-label="To date" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      {list.length === 0 ? (
        <EmptyState
          icon={filtered ? <Filter className="size-5" /> : <Receipt className="size-5" />}
          title={filtered ? "No expenses match these filters" : "No expenses yet"}
          action={
            !filtered && (
              <Button asChild>
                <Link href={`/groups/${b.group.id}/expenses/new`}>Add the first expense</Link>
              </Button>
            )
          }
        >
          {filtered ? "Clear a filter to see more." : "Record who paid for what — the split and balances are worked out for you."}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {list.map((e) => {
            const mine = e.participants.find((p) => p.address === b.me.address);
            return (
              <li key={e.id}>
                <Link href={`/groups/${b.group.id}/expenses/${e.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-ink-800/50">
                  <div className="hidden w-12 shrink-0 text-center sm:block">
                    <div className="text-[11px] text-fg-subtle uppercase">{formatDate(e.date, { month: "short" })}</div>
                    <div className="num font-display text-[18px] leading-tight font-semibold">{formatDate(e.date, { day: "numeric" })}</div>
                  </div>
                  <Avatar address={e.payer} profile={b.profiles[e.payer]} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[14.5px] font-medium">{e.title}</span>
                      {e.recurringId && <Badge tone="violet">Recurring</Badge>}
                    </div>
                    <div className="truncate text-[12.5px] text-fg-subtle">
                      <MemberName address={e.payer} profiles={b.profiles} me={b.me.address} /> paid · {categoryLabel(e.category)} · {e.participants.length} people · {e.splitMethod}
                    </div>
                  </div>
                  <div className="text-right">
                    <Amount value={e.amount} className="text-[14.5px] font-medium" />
                    <div className="mt-0.5 flex items-center justify-end gap-2 text-[12px] text-fg-subtle">
                      {mine && e.payer !== b.me.address && <span>you: <Amount value={mine.share} unit={false} /></span>}
                      <ExpenseStatusPill status={e.status} />
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function SettlementsList({ b }: { b: GroupBundle }) {
  const list = b.settlements.filter((s) => s.status !== "cancelled" && s.status !== "created");
  if (list.length === 0) return null;
  return (
    <Panel>
      <PanelHeader title="Payments in this group" description="Only confirmed payments count toward balances." />
      <ul className="divide-y divide-line px-5 pb-3">
        {list.slice(0, 8).map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-[13.5px]">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <MemberName address={s.from} profiles={b.profiles} me={b.me.address} className="font-medium" />
                <ArrowRight className="size-3.5 text-fg-subtle" />
                <MemberName address={s.to} profiles={b.profiles} me={b.me.address} className="font-medium" />
                <span className="text-fg-subtle">· {relativeTime(s.createdAt)}</span>
              </div>
              {(s.txHash || s.rejectedTxHash) && <TxLink hash={(s.txHash || s.rejectedTxHash)!} />}
            </div>
            <Link href={`/settlements/${s.id}`} className="flex items-center gap-3">
              <Amount value={s.amount} />
              <SettlementStatusPill status={s.status} />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
