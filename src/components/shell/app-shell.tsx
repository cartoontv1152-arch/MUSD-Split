"use client";

import { Command } from "cmdk";
import { ArrowLeftRight, Bell, CircleHelp, HandCoins, LayoutDashboard, Plus, Search, Settings, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Wordmark } from "@/components/brand";
import { WalletMenu } from "@/components/wallet/wallet-menu";
import { NotificationBell } from "./notification-bell";
import { useSession } from "@/components/providers/session";
import { useNetwork } from "@/lib/client/hooks";
import { api } from "@/lib/client/api";
import type { GroupSummary } from "@/lib/client/types";
import { cn } from "@/lib/client/cn";
import { Kbd } from "@/components/ui/primitives";

const NAV = [
  { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/groups", label: "Groups", Icon: Users },
  { href: "/requests", label: "Requests", Icon: HandCoins },
  { href: "/history", label: "Transactions", Icon: ArrowLeftRight },
  { href: "/notifications", label: "Notifications", Icon: Bell },
];
const NAV2 = [
  { href: "/settings", label: "Settings", Icon: Settings },
  { href: "/help", label: "Help & about", Icon: CircleHelp },
];

export function NetworkBadge({ compact }: { compact?: boolean }) {
  const { data, isError } = useNetwork();
  const ok = !!data?.ok && !isError;
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/8 px-2.5 py-1 text-[12px] text-amber-300"
      title={ok ? `Mezo testnet · chain 31611 · block ${data?.blockNumber}` : "RPC unreachable"}
    >
      <span className={cn("size-1.5 rounded-full", ok ? "bg-mint-400" : "bg-rose-400")} aria-hidden="true" />
      <span className="font-medium">Testnet</span>
      {!compact && ok && <span className="num hidden text-fg-subtle md:inline">#{Number(data!.blockNumber).toLocaleString()}</span>}
    </span>
  );
}

function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { address } = useSession();
  const groups = useQuery({
    queryKey: ["groups"],
    queryFn: () => api<{ groups: GroupSummary[] }>("/api/groups"),
    enabled: open && !!address,
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpen);
    };
  }, []);
  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const itemCls = "flex cursor-pointer items-center gap-2.5 rounded-[8px] px-3 py-2 text-[14px] text-fg-muted data-[selected=true]:bg-ink-750 data-[selected=true]:text-fg";
  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      overlayClassName="fixed inset-0 z-50 bg-ink-950/70"
      contentClassName="surface-raised fixed top-[18vh] left-1/2 z-50 w-[calc(100vw-32px)] max-w-[560px] -translate-x-1/2 rounded-[16px]"
    >
      <div className="flex items-center gap-2 border-b border-line px-4">
        <Search className="size-4 text-fg-subtle" />
        <Command.Input placeholder="Jump to a group, page or action…" className="h-12 w-full bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-subtle" />
      </div>
      <Command.List className="max-h-[50vh] overflow-y-auto p-2">
        <Command.Empty className="px-3 py-6 text-center text-[13.5px] text-fg-muted">No matches.</Command.Empty>
        <Command.Group heading="Actions" className="text-[12px] text-fg-subtle [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
          <Command.Item className={itemCls} onSelect={() => go("/groups/new")}>
            <Plus className="size-4" /> Create a group
          </Command.Item>
          <Command.Item className={itemCls} onSelect={() => go("/groups?join=1")}>
            <Users className="size-4" /> Join a group with a code
          </Command.Item>
        </Command.Group>
        {(groups.data?.groups.length ?? 0) > 0 && (
          <Command.Group heading="Groups" className="text-[12px] text-fg-subtle [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
            {groups.data!.groups.map((g) => (
              <Command.Item key={g.id} value={`group ${g.name}`} className={itemCls} onSelect={() => go(`/groups/${g.id}`)}>
                <Users className="size-4" /> {g.name}
              </Command.Item>
            ))}
            {groups.data!.groups.map((g) => (
              <Command.Item key={g.id + "-add"} value={`add expense ${g.name}`} className={itemCls} onSelect={() => go(`/groups/${g.id}/expenses/new`)}>
                <Plus className="size-4" /> Add expense to {g.name}
              </Command.Item>
            ))}
          </Command.Group>
        )}
        <Command.Group heading="Pages" className="text-[12px] text-fg-subtle [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
          {[...NAV, ...NAV2].map((n) => (
            <Command.Item key={n.href} className={itemCls} onSelect={() => go(n.href)}>
              <n.Icon className="size-4" /> {n.label}
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}

function SessionBanner() {
  const { mismatch, signIn, signingIn } = useSession();
  if (!mismatch) return null;
  return (
    <div className="border-b border-amber-400/25 bg-amber-400/8 px-4 py-2 text-center text-[13px] text-amber-200">
      Your wallet switched to a different address than the one you&apos;re signed in with.{" "}
      <button onClick={() => signIn()} disabled={signingIn} className="font-medium text-amber-100 underline underline-offset-2">
        Sign in as the connected wallet
      </button>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const unread = 0;
  void unread;
  const navLink = (n: (typeof NAV)[number]) => {
    const active = pathname === n.href || (n.href !== "/dashboard" && pathname.startsWith(n.href));
    return (
      <Link
        key={n.href}
        href={n.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 rounded-[10px] px-3 py-2 text-[14px] transition-colors",
          active ? "bg-ink-750 text-fg shadow-[inset_2px_0_0_0_var(--color-violet-500)]" : "text-fg-muted hover:bg-ink-800 hover:text-fg",
        )}
      >
        <n.Icon className="size-[18px]" /> {n.label}
      </Link>
    );
  };
  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only z-50 rounded bg-violet-600 px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-[244px] flex-col border-r border-line bg-ink-950/70 px-3 py-4 backdrop-blur lg:flex">
        <Link href="/" className="mb-6 px-2" aria-label="MUSD Split home">
          <Wordmark />
        </Link>
        <nav className="flex flex-col gap-0.5" aria-label="Main">
          {NAV.map(navLink)}
        </nav>
        <div className="mt-auto flex flex-col gap-0.5">
          {NAV2.map(navLink)}
          <button
            onClick={() => window.dispatchEvent(new Event("open-command-palette"))}
            className="mt-3 flex items-center justify-between rounded-[10px] border border-line px-3 py-2 text-[13px] text-fg-subtle hover:text-fg"
          >
            <span className="flex items-center gap-2">
              <Search className="size-4" /> Quick jump
            </span>
            <span className="flex gap-1">
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
        </div>
      </aside>
      <div className="lg:pl-[244px]">
        <header className="no-print sticky top-0 z-20 border-b border-line bg-ink-900/80 backdrop-blur-md">
          <SessionBanner />
          <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
            <Link href="/" className="lg:hidden" aria-label="MUSD Split home">
              <Wordmark />
            </Link>
            <div className="ml-auto flex items-center gap-2">
              <NetworkBadge />
              <button
                onClick={() => window.dispatchEvent(new Event("open-command-palette"))}
                className="grid size-9 place-items-center rounded-[10px] text-fg-muted hover:bg-ink-800 hover:text-fg lg:hidden"
                aria-label="Search"
              >
                <Search className="size-[18px]" />
              </button>
              <NotificationBell />
              <WalletMenu />
            </div>
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1180px] px-4 pt-6 pb-28 sm:px-6 lg:pb-16">
          {children}
        </main>
      </div>
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-ink-950/90 backdrop-blur lg:hidden" aria-label="Mobile">
        {[NAV[0], NAV[1], NAV[2], NAV[3], NAV2[0]].map((n) => {
          const active = pathname === n.href || (n.href !== "/dashboard" && pathname.startsWith(n.href));
          return (
            <Link key={n.href} href={n.href} className={cn("flex flex-col items-center gap-0.5 py-2.5 text-[11px]", active ? "text-violet-300" : "text-fg-subtle")}>
              <n.Icon className="size-5" />
              {n.label}
            </Link>
          );
        })}
      </nav>
      <CommandPalette />
    </div>
  );
}
