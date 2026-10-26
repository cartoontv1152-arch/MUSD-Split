"use client";

import { Tabs } from "radix-ui";
import { Download, Receipt, Settings2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SignInGate } from "@/components/shell/gate";
import { GroupIcon } from "@/components/group-icon";
import { AvatarStack } from "@/components/identity";
import { Amount, NetLabel } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Panel, PanelHeader, Skeleton, Textarea } from "@/components/ui/primitives";
import { ActivityFeed } from "@/components/group/activity-feed";
import { BalancesTab, ExpensesTab, SettlementsList, SuggestedSettlements } from "@/components/group/money-tabs";
import { MembersTab, RecurringTab, RequestsTab } from "@/components/group/people-tabs";
import { useGroup } from "@/lib/client/hooks";
import { ApiClientError, errorMessage, patch } from "@/lib/client/api";
import { formatDate } from "@/lib/client/cn";
import type { GroupBundle } from "@/lib/client/types";

const TABS = [
  ["overview", "Overview"],
  ["expenses", "Expenses"],
  ["balances", "Balances"],
  ["requests", "Requests"],
  ["activity", "Activity"],
  ["members", "Members"],
  ["recurring", "Recurring"],
] as const;

export default function GroupPage() {
  return (
    <SignInGate title="Sign in to open this group">
      <Suspense>
        <GroupInner />
      </Suspense>
    </SignInGate>
  );
}

function GroupSettings({ b, open, onOpenChange }: { b: GroupBundle; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(b.group.name);
  const [description, setDescription] = useState(b.group.description ?? "");
  const [membersCanInvite, setMCI] = useState(b.group.membersCanInvite);
  const [simplifyDebts, setSD] = useState(b.group.simplifyDebts);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Group settings"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await patch(`/api/groups/${b.group.id}`, { name, description: description || null, membersCanInvite, simplifyDebts });
                toast.success("Settings saved");
                onOpenChange(false);
                void qc.invalidateQueries({ queryKey: ["group", b.group.id] });
              } catch (e) {
                toast.error(errorMessage(e));
              } finally {
                setSaving(false);
              }
            }}
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" htmlFor="gs-name">
          <Input id="gs-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="gs-desc">
          <Textarea id="gs-desc" value={description} maxLength={280} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <label className="flex items-center gap-3 text-[14px]">
          <input type="checkbox" className="size-4 accent-violet-500" checked={membersCanInvite} onChange={(e) => setMCI(e.target.checked)} /> Any member can invite people
        </label>
        <label className="flex items-center gap-3 text-[14px]">
          <input type="checkbox" className="size-4 accent-violet-500" checked={simplifyDebts} onChange={(e) => setSD(e.target.checked)} /> Simplify debts (fewest payments)
        </label>
      </div>
    </Dialog>
  );
}

function GroupInner() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const tab = sp.get("tab") ?? "overview";
  const { data: b, isLoading, error } = useGroup(id);
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-24" />
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-72" />
      </div>
    );
  }
  if (error || !b) {
    const status = error instanceof ApiClientError ? error.status : 0;
    return (
      <Panel className="mx-auto max-w-[520px] p-8 text-center">
        <h1 className="font-display text-[22px] font-semibold">{status === 403 ? "You're not a member of this group" : status === 404 ? "Group not found" : "Couldn't load this group"}</h1>
        <p className="mt-2 text-[14px] text-fg-muted">
          {status === 403 ? "Ask a member for an invite link to join." : status === 404 ? "It may have been removed, or the link is wrong." : errorMessage(error)}
        </p>
        <Button className="mt-5" asChild>
          <Link href="/groups">Back to groups</Link>
        </Button>
      </Panel>
    );
  }
  const me = b.me.address;
  const myNet = BigInt(b.ledger.nets[me] ?? "0");
  const active = b.members.filter((m) => m.status === "active");
  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <GroupIcon icon={b.group.icon} color={b.group.color} size={56} />
          <div className="min-w-0">
            <h1 className="truncate font-display text-[28px] leading-tight font-semibold tracking-[-0.025em] sm:text-[32px]">{b.group.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-fg-muted">
              <AvatarStack addresses={active.map((m) => m.address)} profiles={b.profiles} size={22} />
              <span>{active.length} members</span>
              <span>·</span>
              <span>Since {formatDate(b.group.createdAt)}</span>
              <span>·</span>
              <span>
                <Amount value={b.ledger.totalSpent} /> spent
              </span>
            </div>
            {b.group.description && <p className="mt-1.5 max-w-[60ch] text-[14px] text-fg-muted">{b.group.description}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {b.me.isAdmin && (
            <Button variant="ghost" size="icon" aria-label="Group settings" onClick={() => setSettingsOpen(true)}>
              <Settings2 className="size-4" />
            </Button>
          )}
          <Button variant="secondary" asChild>
            <a href={`/api/groups/${b.group.id}/export`} download>
              <Download className="size-4" /> Export CSV
            </a>
          </Button>
          <Button asChild>
            <Link href={`/groups/${b.group.id}/expenses/new`}>
              <Receipt className="size-4" /> Add expense
            </Link>
          </Button>
        </div>
      </div>

      <Panel raised className="mb-6 flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div>
          <div className="text-[12.5px] text-fg-subtle">Your position in this group</div>
          <NetLabel net={myNet} className="font-display text-[22px] font-semibold" />
        </div>
        <div className="flex flex-wrap gap-2">
          {myNet < 0n && (
            <Button asChild>
              <Link href={`/groups/${b.group.id}?tab=balances`}>Settle up</Link>
            </Button>
          )}
          {myNet > 0n && (
            <Button variant="outline" asChild>
              <Link href={`/groups/${b.group.id}?tab=requests`}>Request payment</Link>
            </Button>
          )}
        </div>
      </Panel>

      <Tabs.Root value={tab} onValueChange={(v) => router.replace(`/groups/${id}?tab=${v}`, { scroll: false })}>
        <Tabs.List className="mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Group sections">
          {TABS.map(([v, label]) => (
            <Tabs.Trigger
              key={v}
              value={v}
              className="relative shrink-0 px-3 pt-1 pb-3 text-[14px] text-fg-muted transition-colors hover:text-fg data-[state=active]:text-fg data-[state=active]:after:absolute data-[state=active]:after:inset-x-2 data-[state=active]:after:bottom-[-1px] data-[state=active]:after:h-[2px] data-[state=active]:after:rounded-full data-[state=active]:after:bg-violet-500"
            >
              {label}
              {v === "requests" && b.requests.filter((r) => r.status === "pending" && r.payer === me).length > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-400/15 px-1.5 text-[11px] text-amber-300">{b.requests.filter((r) => r.status === "pending" && r.payer === me).length}</span>
              )}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="overview" className="space-y-5 focus:outline-none">
          <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
            <div className="space-y-5">
              <SuggestedSettlements b={b} />
              <SettlementsList b={b} />
            </div>
            <Panel>
              <PanelHeader
                title="Recent activity"
                action={
                  <Link href={`/groups/${id}?tab=activity`} className="text-[13px] text-violet-300 hover:underline">
                    Full feed
                  </Link>
                }
              />
              <ActivityFeed items={b.activity.slice(0, 8)} profiles={b.profiles} me={me} />
            </Panel>
          </div>
          <ExpensesTab b={b} />
        </Tabs.Content>
        <Tabs.Content value="expenses" className="focus:outline-none">
          <ExpensesTab b={b} />
        </Tabs.Content>
        <Tabs.Content value="balances" className="focus:outline-none">
          <BalancesTab b={b} />
        </Tabs.Content>
        <Tabs.Content value="requests" className="focus:outline-none">
          <RequestsTab b={b} ask={sp.get("ask")} askAmount={sp.get("amount")} />
        </Tabs.Content>
        <Tabs.Content value="activity" className="focus:outline-none">
          <Panel>
            <PanelHeader title="Activity" description="Every change to expenses, members and payments — with transaction references." />
            <ActivityFeed items={b.activity} profiles={b.profiles} me={me} />
          </Panel>
        </Tabs.Content>
        <Tabs.Content value="members" className="focus:outline-none">
          <MembersTab b={b} openInvite={sp.get("invite") === "1"} />
        </Tabs.Content>
        <Tabs.Content value="recurring" className="focus:outline-none">
          <RecurringTab b={b} />
        </Tabs.Content>
      </Tabs.Root>
      {b.me.isAdmin && settingsOpen && <GroupSettings b={b} open={settingsOpen} onOpenChange={setSettingsOpen} />}
    </>
  );
}
