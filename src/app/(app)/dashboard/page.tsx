"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CalendarClock, CheckCircle2, Circle, HandCoins, Plus, Receipt, Users } from "lucide-react";
import Link from "next/link";
import { SignInGate } from "@/components/shell/gate";
import { Amount, NetLabel, SettlementStatusPill } from "@/components/money";
import { Avatar, AvatarStack, MemberName, TxLink } from "@/components/identity";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, PageHeader, Panel, PanelHeader, Skeleton } from "@/components/ui/primitives";
import { useSession } from "@/components/providers/session";
import { api } from "@/lib/client/api";
import { categoryLabel } from "@/config/app";
import { formatDate, relativeTime } from "@/lib/client/cn";
import { btc, pct, useMezoPosition, usd } from "@/lib/client/use-mezo";
import { healthBand } from "@/lib/mezo/trove-math";
import type { Expense, GroupSummary, PaymentRequest, Profiles, Recurring, Settlement } from "@/lib/client/types";

interface Dashboard {
  totals: { owes: string; owed: string; net: string; activeGroups: number };
  groups: GroupSummary[];
  recentExpenses: Array<Expense & { groupName: string; myShare: string | null }>;
  pendingRequests: PaymentRequest[];
  inFlight: Settlement[];
  recentSettlements: Array<Settlement & { groupName: string }>;
  myDebts: Array<{ groupId: string; groupName: string; to: string; amount: string }>;
  upcoming: Recurring[];
  profiles: Profiles;
}

export default function DashboardPage() {
  return (
    <SignInGate title="Sign in to see your balances">
      <DashboardInner />
    </SignInGate>
  );
}

function PositionStrip({ owes, owed }: { owes: bigint; owed: bigint }) {
  const total = owes + owed;
  const owePct = total === 0n ? 50 : Number((owes * 1000n) / total) / 10;
  return (
    <Panel raised className="overflow-hidden">
      <div className="grid gap-px bg-line sm:grid-cols-3">
        <div className="bg-wash px-6 py-5">
          <div className="text-[13px] text-fg-muted">You owe</div>
          <div className="mt-1 font-display text-[30px] leading-tight font-semibold text-fg">
            <Amount value={owes} />
          </div>
        </div>
        <div className="bg-wash px-6 py-5">
          <div className="text-[13px] text-fg-muted">Owed to you</div>
          <div className="mt-1 font-display text-[30px] leading-tight font-semibold text-blue-600">
            <Amount value={owed} />
          </div>
        </div>
        <div className="bg-wash px-6 py-5">
          <div className="text-[13px] text-fg-muted">Net position</div>
          <div className="mt-1 font-display text-[30px] leading-tight font-semibold">
            <Amount value={owed - owes} signed tone="auto" />
          </div>
        </div>
      </div>
      <div className="px-6 py-3">
        <div className="flex h-2 overflow-hidden rounded-full bg-wash-2" aria-hidden="true">
          {total > 0n && (
            <>
              <div className="bg-fg" style={{ width: `${owePct}%` }} />
              <div className="bg-blue-600" style={{ width: `${100 - owePct}%` }} />
            </>
          )}
        </div>
        <p className="mt-2 text-[12.5px] text-fg-subtle">Across all your groups. Only payments verified on Mezo testnet reduce these numbers.</p>
      </div>
    </Panel>
  );
}

/** The MUSD behind your payments: wallet balance and, if you have one, your Mezo trove's health. */
function MusdSource({ address, owes }: { address: string; owes: bigint }) {
  const { data: pos, isLoading, isError } = useMezoPosition(address);
  if (isError) return null;
  if (isLoading || !pos) return <Skeleton className="h-[96px]" />;
  const t = pos.trove;
  const band = healthBand(t.ratio, pos.params);
  const short = owes > pos.balances.musd ? owes - pos.balances.musd : 0n;
  return (
    <Panel>
      <div className="grid gap-px bg-line sm:grid-cols-[1fr_1fr_1.4fr]">
        <div className="bg-paper p-5">
          <div className="text-[13px] text-fg-muted">MUSD in your wallet</div>
          <div className="num mt-1 font-display text-[24px] font-semibold">
            <Amount value={pos.balances.musd} />
          </div>
          <div className="mt-1 text-[12.5px] text-fg-subtle">{short > 0n ? <>You&apos;re <Amount value={short} /> short of what you owe</> : "Enough to cover what you owe"}</div>
        </div>
        <div className="bg-paper p-5">
          <div className="text-[13px] text-fg-muted">BTC</div>
          <div className="num mt-1 font-display text-[24px] font-semibold">{btc(pos.balances.btc, 5)}</div>
          <div className="mt-1 text-[12.5px] text-fg-subtle">Swap it for MUSD on Mezo Pools</div>
        </div>
        <div className="flex items-start justify-between gap-3 bg-paper p-5">
          <div>
            <div className="text-[13px] text-fg-muted">Mezo trove</div>
            {t.active ? (
              <>
                <div className="num mt-1 font-display text-[24px] font-semibold">{pct(t.ratio)}</div>
                <div className="mt-1 text-[12.5px] text-fg-subtle">
                  {btc(t.coll, 4)} backs <Amount value={t.debt} unit={false} /> MUSD. Liquidation below {t.liquidationPrice ? usd(t.liquidationPrice) : "—"}.
                </div>
              </>
            ) : (
              <div className="mt-1 text-[13.5px] text-fg-muted">No trove. Lock BTC to borrow MUSD at {(pos.newTroveRateBps / 100).toFixed(2)}% APR.</div>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            {t.active && <Badge tone={band === "healthy" ? "mint" : band === "watch" ? "sky" : "rose"}>{band === "healthy" ? "Healthy" : band === "watch" ? "Watch" : "At risk"}</Badge>}
            <Link href="/wallet" className="text-[13px] font-medium text-blue-600 hover:underline">
              {t.active ? "Manage" : "Get MUSD"}
            </Link>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function Onboarding({ hasGroup }: { hasGroup: boolean }) {
  const steps = [
    { done: true, label: "Connect and sign in with your wallet" },
    { done: hasGroup, label: "Create a group or join one with an invite link", href: "/groups/new" },
    { done: false, label: "Add your first shared expense" },
    { done: false, label: "Settle a debt with a real MUSD transfer" },
  ];
  return (
    <Panel className="p-6">
      <h2 className="font-display text-[19px] font-semibold">Get set up in four steps</h2>
      <ol className="mt-4 space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-3 text-[14.5px]">
            {s.done ? <CheckCircle2 className="size-5 text-blue-600" /> : <Circle className="size-5 text-fg-subtle" />}
            <span className={s.done ? "text-fg-muted line-through decoration-fg-subtle/50" : "text-fg"}>{s.label}</span>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/groups/new">
            <Plus className="size-4" /> Create a group
          </Link>
        </Button>
        <Button variant="secondary" asChild>
          <Link href="/groups?join=1">Join with a code</Link>
        </Button>
      </div>
      <p className="mt-4 text-[13px] text-fg-subtle">
        Need testnet funds? Get test BTC for gas from the{" "}
        <a className="text-blue-600 hover:underline" href="https://faucet.test.mezo.org/" target="_blank" rel="noreferrer">
          Mezo faucet
        </a>
        , then borrow MUSD at testnet.mezo.org.
      </p>
    </Panel>
  );
}

function DashboardInner() {
  const { address } = useSession();
  const { data, isLoading, error } = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("/api/dashboard"), refetchInterval: 20_000 });
  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-40" />
        <div className="grid gap-5 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }
  if (error || !data) return <Panel className="p-6 text-fg">Couldn&apos;t load your dashboard. Refresh to try again.</Panel>;
  const p = data.profiles;
  const owes = BigInt(data.totals.owes);
  const owed = BigInt(data.totals.owed);
  const firstGroup = data.groups[0];
  return (
    <>
      <PageHeader
        title="Your balances"
        description={`${data.totals.activeGroups} active group${data.totals.activeGroups === 1 ? "" : "s"}`}
        actions={
          <>
            {firstGroup && (
              <Button variant="secondary" asChild>
                <Link href={`/groups/${firstGroup.id}/expenses/new`}>
                  <Receipt className="size-4" /> Add expense
                </Link>
              </Button>
            )}
            <Button asChild>
              <Link href="/groups/new">
                <Plus className="size-4" /> Create group
              </Link>
            </Button>
          </>
        }
      />
      {data.groups.length === 0 ? (
        <Onboarding hasGroup={false} />
      ) : (
        <div className="space-y-5">
          <PositionStrip owes={owes} owed={owed} />

          {data.inFlight.length > 0 && (
            <Panel className="border-blue-600/30">
              <PanelHeader title="Payments in progress" description="These need a signature, are waiting for confirmation, or need a re-check." />
              <ul className="divide-y divide-line px-5 pb-3">
                {data.inFlight.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <span className="flex items-center gap-2 text-[14px]">
                      <Amount value={s.amount} /> to <MemberName address={s.to} profiles={p} withAvatar />
                    </span>
                    <span className="flex items-center gap-3">
                      <SettlementStatusPill status={s.status} />
                      <Link href={`/settlements/${s.id}`} className="text-[13px] text-blue-600 hover:underline">
                        Open
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
            <Panel>
              <PanelHeader
                title="Settle up"
                description={data.myDebts.length ? "Suggested payments that clear what you owe." : undefined}
                action={
                  <Link href="/history" className="text-[13px] text-blue-600 hover:underline">
                    History
                  </Link>
                }
              />
              {data.myDebts.length === 0 ? (
                <EmptyState icon={<CheckCircle2 className="size-5" />} title="You're all settled">
                  You don&apos;t owe anyone right now.
                </EmptyState>
              ) : (
                <ul className="divide-y divide-line px-5 pb-4">
                  {data.myDebts.map((d) => (
                    <li key={d.groupId + d.to} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-[14.5px]">
                          Pay <MemberName address={d.to} profiles={p} withAvatar className="font-medium" />
                        </div>
                        <div className="text-[12.5px] text-fg-subtle">{d.groupName}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Amount value={d.amount} className="font-semibold text-fg" />
                        <Button size="sm" asChild>
                          <Link href={`/groups/${d.groupId}/settle?to=${d.to}&amount=${d.amount}`}>Pay</Link>
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel>
              <PanelHeader
                title="Requests for you"
                action={
                  <Link href="/requests" className="text-[13px] text-blue-600 hover:underline">
                    All requests
                  </Link>
                }
              />
              {data.pendingRequests.filter((r) => r.payer === address).length === 0 ? (
                <EmptyState icon={<HandCoins className="size-5" />} title="No pending requests">
                  When someone asks you to pay, it shows up here.
                </EmptyState>
              ) : (
                <ul className="divide-y divide-line px-5 pb-4">
                  {data.pendingRequests
                    .filter((r) => r.payer === address)
                    .slice(0, 5)
                    .map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                        <div className="min-w-0 text-[14px]">
                          <MemberName address={r.requester} profiles={p} withAvatar className="font-medium" />
                          <div className="truncate text-[12.5px] text-fg-subtle">
                            {r.groupName} · {relativeTime(r.createdAt)}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Amount value={r.amount} className="font-semibold" />
                          <Button size="sm" asChild>
                            <Link href={`/groups/${r.groupId}/settle?to=${r.requester}&amount=${r.amount}&request=${r.id}`}>Pay</Link>
                          </Button>
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </Panel>
          </div>

          {address && <MusdSource address={address} owes={owes} />}

          <Panel>
            <PanelHeader
              title="Groups"
              action={
                <Link href="/groups" className="text-[13px] text-blue-600 hover:underline">
                  All groups
                </Link>
              }
            />
            <ul className="divide-y divide-line px-5 pb-3">
              {data.groups.slice(0, 6).map((g) => (
                <li key={g.id}>
                  <Link href={`/groups/${g.id}`} className="-mx-2 flex items-center justify-between gap-3 rounded-[var(--radius-control)] px-2 py-3 hover:bg-wash">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-9 place-items-center rounded-[var(--radius-control)] border border-line bg-blue-50 text-blue-600">
                        <Users className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-[14.5px] font-medium">{g.name}</div>
                        <div className="text-[12.5px] text-fg-subtle">
                          <Amount value={g.totalSpent} /> spent · {g.memberCount} members
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="hidden sm:block">
                        <AvatarStack addresses={g.members} profiles={p} size={22} max={4} />
                      </span>
                      <NetLabel net={g.net} className="text-[13.5px]" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel>
              <PanelHeader title="Recent expenses" />
              {data.recentExpenses.length === 0 ? (
                <EmptyState icon={<Receipt className="size-5" />} title="No expenses yet">
                  Add the first shared cost in one of your groups.
                </EmptyState>
              ) : (
                <ul className="divide-y divide-line px-5 pb-3">
                  {data.recentExpenses.map((e) => (
                    <li key={e.id}>
                      <Link href={`/groups/${e.groupId}/expenses/${e.id}`} className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 hover:bg-wash/60">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar address={e.payer} profile={p[e.payer]} size={28} />
                          <div className="min-w-0">
                            <div className="truncate text-[14px] font-medium">{e.title}</div>
                            <div className="truncate text-[12.5px] text-fg-subtle">
                              {e.groupName} · {categoryLabel(e.category)} · {formatDate(e.date)}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <Amount value={e.amount} className="text-[14px]" />
                          {e.myShare && <div className="text-[12px] text-fg-subtle">your share {<Amount value={e.myShare} unit={false} />}</div>}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <div className="space-y-5">
              <Panel>
                <PanelHeader title="Recent confirmed settlements" />
                {data.recentSettlements.length === 0 ? (
                  <p className="px-5 pb-5 text-[14px] text-fg-muted">No verified payments yet.</p>
                ) : (
                  <ul className="divide-y divide-line px-5 pb-3">
                    {data.recentSettlements.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-3 py-2.5 text-[13.5px]">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <MemberName address={s.from} profiles={p} me={address} /> <ArrowUpRight className="size-3.5 text-fg-subtle" />
                            <MemberName address={s.to} profiles={p} me={address} />
                          </div>
                          {s.txHash && <TxLink hash={s.txHash} />}
                        </div>
                        <Link href={`/settlements/${s.id}`}>
                          <Amount value={s.amount} className="text-blue-600" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              <Panel>
                <PanelHeader title="Upcoming shared bills" />
                {data.upcoming.length === 0 ? (
                  <p className="px-5 pb-5 text-[14px] text-fg-muted">No recurring bills scheduled in the next 30 days.</p>
                ) : (
                  <ul className="divide-y divide-line px-5 pb-3">
                    {data.upcoming.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-[13.5px]">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <CalendarClock className="size-4 text-blue-600" />
                          <div className="min-w-0">
                            <div className="truncate font-medium">{r.title}</div>
                            <div className="text-[12px] text-fg-subtle">
                              {r.groupName} · {formatDate(r.nextRunOn)}
                            </div>
                          </div>
                        </div>
                        <Badge tone="violet">
                          <Amount value={r.amount} />
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
