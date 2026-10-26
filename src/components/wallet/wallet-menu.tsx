"use client";

import { DropdownMenu } from "radix-ui";
import { ChevronDown, Coins, Copy, ExternalLink, LogOut, Network, PlugZap, Settings, Wallet } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useDisconnect, useSwitchChain, useWalletClient } from "wagmi";
import { CHAIN_ID, explorerAddressUrl } from "@/config/chains";
import { MUSD } from "@/config/contracts";
import { Amount } from "@/components/money";
import { Avatar, displayName } from "@/components/identity";
import { Button } from "@/components/ui/button";
import { useSession } from "@/components/providers/session";
import { useMusdBalance, useWalletState } from "@/lib/client/hooks";
import { errorMessage, isUserRejection } from "@/lib/client/api";
import { shortAddress } from "@/lib/client/cn";

export function useNetworkActions() {
  const { switchChainAsync } = useSwitchChain();
  const { data: wc } = useWalletClient();
  return {
    async switchToMezo() {
      try {
        await switchChainAsync({ chainId: CHAIN_ID });
        toast.success("Switched to Mezo testnet");
        return true;
      } catch (e) {
        if (!isUserRejection(e)) toast.error("Couldn't switch network", { description: errorMessage(e) });
        return false;
      }
    },
    async addMusd() {
      try {
        if (!wc) throw new Error("Connect a wallet first");
        await wc.watchAsset({ type: "ERC20", options: { address: MUSD.address, symbol: "MUSD", decimals: 18 } });
        toast.success("MUSD added to your wallet");
      } catch (e) {
        if (!isUserRejection(e)) toast.error("Couldn't add MUSD", { description: errorMessage(e) });
      }
    },
  };
}

const item = "flex cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-[13.5px] text-fg-muted outline-none data-[highlighted]:bg-ink-750 data-[highlighted]:text-fg";

export function WalletMenu() {
  const { address: session, user, signIn, signOut, openConnect, signingIn, mismatch } = useSession();
  const w = useWalletState();
  const { disconnectAsync } = useDisconnect();
  const bal = useMusdBalance(w.address ?? session);
  const net = useNetworkActions();

  if (!w.isConnected && !session) {
    return (
      <Button size="sm" onClick={openConnect}>
        <Wallet className="size-4" /> Connect wallet
      </Button>
    );
  }
  if (w.isConnected && (!session || mismatch)) {
    return (
      <Button size="sm" loading={signingIn} onClick={() => signIn()}>
        {mismatch ? "Sign in as this wallet" : "Sign in"}
      </Button>
    );
  }
  const addr = session ?? w.address!;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex h-9 items-center gap-2 rounded-[10px] border border-line-strong bg-ink-850 pr-2 pl-1.5 text-[13px] hover:border-violet-500/50">
          <Avatar address={addr} profile={user} size={24} />
          <span className="hidden font-medium text-fg sm:inline">{user?.displayName || shortAddress(addr)}</span>
          {!w.onMezo && w.isConnected && <span className="size-2 rounded-full bg-amber-400" aria-label="Wrong network" />}
          <ChevronDown className="size-3.5 text-fg-subtle" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={8} className="surface-raised z-50 w-[280px] rounded-[14px] p-1.5">
          <div className="px-2.5 pt-2 pb-3">
            <div className="flex items-center gap-2.5">
              <Avatar address={addr} profile={user} size={36} />
              <div className="min-w-0">
                <div className="truncate text-[14px] font-medium">{displayName(addr, user ? { [addr]: user } : undefined)}</div>
                <div className="font-mono text-[12px] text-fg-subtle">{shortAddress(addr, 8, 6)}</div>
              </div>
            </div>
            <div className="mt-3 rounded-[10px] border border-line bg-ink-900/60 px-3 py-2">
              <div className="text-[12px] text-fg-subtle">MUSD balance (on-chain)</div>
              <div className="text-[16px] font-semibold">{bal.data !== undefined ? <Amount value={bal.data} /> : bal.isError ? "Unavailable" : "Loading…"}</div>
            </div>
            {!w.isConnected && <p className="mt-2 text-[12px] text-amber-300">Wallet disconnected — reconnect to pay.</p>}
            {w.isConnected && !w.onMezo && <p className="mt-2 text-[12px] text-amber-300">Your wallet is on another network.</p>}
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          {w.isConnected && !w.onMezo && (
            <DropdownMenu.Item className={item} onSelect={() => net.switchToMezo()}>
              <Network className="size-4" /> Switch to Mezo testnet
            </DropdownMenu.Item>
          )}
          {!w.isConnected && (
            <DropdownMenu.Item className={item} onSelect={openConnect}>
              <PlugZap className="size-4" /> Reconnect wallet
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item className={item} onSelect={() => net.addMusd()}>
            <Coins className="size-4" /> Add MUSD to wallet
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={item}
            onSelect={() => {
              void navigator.clipboard.writeText(addr);
              toast.success("Address copied");
            }}
          >
            <Copy className="size-4" /> Copy address
          </DropdownMenu.Item>
          <DropdownMenu.Item className={item} asChild>
            <a href={explorerAddressUrl(addr)} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" /> View on explorer
            </a>
          </DropdownMenu.Item>
          <DropdownMenu.Item className={item} asChild>
            <Link href="/settings">
              <Settings className="size-4" /> Profile & settings
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <DropdownMenu.Item
            className={item}
            onSelect={async () => {
              await signOut();
              if (w.isConnected) await disconnectAsync().catch(() => undefined);
            }}
          >
            <LogOut className="size-4" /> Sign out & disconnect
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
