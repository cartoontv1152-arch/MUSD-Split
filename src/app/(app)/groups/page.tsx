"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Ticket, Users } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { SignInGate } from "@/components/shell/gate";
import { GroupIcon } from "@/components/group-icon";
import { AvatarStack } from "@/components/identity";
import { Amount, NetLabel } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, Field, Input, PageHeader, Panel, Select, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/client/api";
import { relativeTime } from "@/lib/client/cn";
import type { GroupSummary } from "@/lib/client/types";

export default function GroupsPage() {
  return (
    <SignInGate title="Sign in to see your groups">
      <Suspense>
        <GroupsInner />
      </Suspense>
    </SignInGate>
  );
}

function extractToken(input: string): string | null {
  const s = input.trim();
  const m = /\/join\/([A-Za-z0-9_-]{24,64})/.exec(s);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{24,64}$/.test(s) ? s : null;
}

function GroupsInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const [joinOpen, setJoinOpen] = useState(sp.get("join") === "1");
  const [code, setCode] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "owe" | "owed" | "settled">("all");
  const [sort, setSort] = useState<"recent" | "name" | "balance">("recent");
  const { data, isLoading } = useQuery({ queryKey: ["groups"], queryFn: () => api<{ groups: GroupSummary[] }>("/api/groups") });

  const list = useMemo(() => {
    let g = data?.groups ?? [];
    if (query) g = g.filter((x) => x.name.toLowerCase().includes(query.toLowerCase()) || x.description?.toLowerCase().includes(query.toLowerCase()));
    if (filter === "owe") g = g.filter((x) => BigInt(x.net) < 0n);
    if (filter === "owed") g = g.filter((x) => BigInt(x.net) > 0n);
    if (filter === "settled") g = g.filter((x) => x.settledUp);
    return [...g].sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : sort === "balance" ? (BigInt(a.net) < BigInt(b.net) ? -1 : 1) : b.lastActivityAt.localeCompare(a.lastActivityAt),
    );
  }, [data, query, filter, sort]);

  const token = extractToken(code);
  return (
    <>
      <PageHeader
        title="Groups"
        description="Trips, flats, dinners — each group keeps its own expenses and balances."
        actions={
          <>
            <Button variant="secondary" onClick={() => setJoinOpen(true)}>
              <Ticket className="size-4" /> Join with code
            </Button>
            <Button asChild>
              <Link href="/groups/new">
                <Plus className="size-4" /> Create group
              </Link>
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
          <Input aria-label="Search groups" placeholder="Search groups" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" />
        </div>
        <Select aria-label="Filter" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="w-auto">
          <option value="all">All groups</option>
          <option value="owe">I owe</option>
          <option value="owed">Owed to me</option>
          <option value="settled">Settled up</option>
        </Select>
        <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="w-auto">
          <option value="recent">Recent activity</option>
          <option value="name">Name</option>
          <option value="balance">Balance</option>
        </Select>
      </div>
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Users className="size-5" />}
            title={data?.groups.length ? "No groups match" : "No groups yet"}
            action={
              !data?.groups.length && (
                <Button asChild>
                  <Link href="/groups/new">Create your first group</Link>
                </Button>
              )
            }
          >
            {data?.groups.length ? "Try a different search or filter." : "Create a group for a trip, your flat or a dinner, then invite people with a link."}
          </EmptyState>
        </Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.map((g) => (
            <Link key={g.id} href={`/groups/${g.id}`} className="surface group block rounded-[var(--radius-panel)] p-5 transition-colors hover:border-violet-500/40">
              <div className="flex items-start gap-3">
                <GroupIcon icon={g.icon} color={g.color} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="truncate font-display text-[17px] font-semibold">{g.name}</h2>
                    {g.archivedAt && <span className="text-[12px] text-fg-subtle">Archived</span>}
                  </div>
                  <p className="truncate text-[13px] text-fg-muted">{g.description || `${g.memberCount} member${g.memberCount === 1 ? "" : "s"}`}</p>
                </div>
              </div>
              <div className="mt-5 flex items-end justify-between gap-3">
                <div>
                  <div className="text-[12px] text-fg-subtle">Your balance</div>
                  <NetLabel net={g.net} className="text-[15px] font-medium" />
                </div>
                <AvatarStack addresses={g.members} size={24} max={5} />
              </div>
              <div className="mt-4 flex justify-between border-t border-line pt-3 text-[12.5px] text-fg-subtle">
                <span>
                  <Amount value={g.totalSpent} /> total · {g.expenseCount} expense{g.expenseCount === 1 ? "" : "s"}
                </span>
                <span>{relativeTime(g.lastActivityAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
      <Dialog
        open={joinOpen}
        onOpenChange={setJoinOpen}
        title="Join a group"
        description="Paste the invite link or code someone shared with you."
        footer={
          <>
            <Button variant="ghost" onClick={() => setJoinOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!token} onClick={() => token && router.push(`/join/${token}`)}>
              Continue
            </Button>
          </>
        }
      >
        <Field label="Invite link or code" htmlFor="code" error={code && !token ? "That doesn't look like an invite link or code." : undefined}>
          <Input id="code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="https://…/join/AbC… or the code" />
        </Field>
      </Dialog>
    </>
  );
}
