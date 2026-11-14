"use client";

import { ExternalLink, Plus } from "lucide-react";
import { useAccount } from "wagmi";
import { SignInGate } from "@/components/shell/gate";
import { useSession } from "@/components/providers/session";
import { Amount } from "@/components/money";
import { SwapPanel } from "@/components/mezo/swap-panel";
import { TroveManager } from "@/components/mezo/trove-actions";
import { Button } from "@/components/ui/button";
import { Callout, PageHeader, Panel, PanelHeader, Skeleton } from "@/components/ui/primitives";
import { explorerAddressUrl } from "@/config/chains";
import { MUSD } from "@/config/contracts";
import { MEZO_LINKS } from "@/config/mezo";
import { useNetworkActions } from "@/components/wallet/wallet-menu";
import { btc, useMezoPosition } from "@/lib/client/use-mezo";
import { formatUnits } from "viem";

export default function WalletPage() {
  return (
    <SignInGate title="Sign in to see your wallet and trove">
      <WalletInner />
    </SignInGate>
  );
}

function WalletInner() {
  const { address } = useSession();
  const { address: connected } = useAccount();
  const pos = useMezoPosition(address);
  const net = useNetworkActions();
  const mismatch = !!connected && connected.toLowerCase() !== address;
  const b = pos.data?.balances;
  return (
    <>
      <PageHeader
        title="Wallet and trove"
        description="Where your MUSD comes from. Swap BTC for MUSD on Mezo Pools, or borrow it against BTC in a Mezo trove, then pay anyone in your groups."
      />
      {mismatch && (
        <Callout tone="amber" className="mb-5" title="Different wallet connected">
          Your wallet is on {connected!.slice(0, 8)}…, but you&apos;re signed in as {address!.slice(0, 8)}…. Transactions here use the connected wallet, so switch accounts or sign in again first.
        </Callout>
      )}
      {pos.isError && (
        <Callout tone="rose" className="mb-5" title="Couldn't read from Mezo">
          The Mezo testnet RPC didn&apos;t answer. Your funds are safe; try again in a moment.
          <div className="mt-2">
            <Button size="sm" variant="secondary" onClick={() => pos.refetch()}>
              Try again
            </Button>
          </div>
        </Callout>
      )}
      <section aria-label="Balances" className="mb-6 grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-line bg-line sm:grid-cols-3">
        {[
          ["MUSD", b ? <Amount key="m" value={b.musd} unit={false} /> : null, "Spendable in your groups"],
          ["BTC", b ? btc(b.btc) : null, "Gas and collateral"],
          ["MEZO", b ? Number(formatUnits(b.mezo, 18)).toLocaleString("en-US", { maximumFractionDigits: 4 }) : null, "Swappable for MUSD"],
        ].map(([k, v, note]) => (
          <div key={k as string} className="bg-paper p-5">
            <div className="text-[13px] text-fg-muted">{k}</div>
            <div className="num mt-1 font-display text-[26px] font-semibold tracking-[-0.02em]">{v ?? <Skeleton className="h-8 w-32" />}</div>
            <div className="mt-1 text-[12.5px] text-fg-subtle">{note}</div>
          </div>
        ))}
      </section>
      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <h2 className="mb-3 font-display text-[18px] font-semibold">Your Mezo trove</h2>
          <TroveManager owner={address!} position={pos.data} isLoading={pos.isLoading} />
        </div>
        <div className="space-y-6">
          <Panel>
            <PanelHeader title="Swap for MUSD" description="Mezo Pools, priced live. 1% slippage protection." />
            <div className="px-5 pb-5">{pos.data ? <SwapPanel owner={address!} position={pos.data} /> : <Skeleton className="h-64" />}</div>
          </Panel>
          <Panel>
            <PanelHeader title="Get test funds" />
            <ul className="divide-y divide-line border-t border-line text-[14px]">
              <li className="flex items-center justify-between gap-3 px-5 py-3">
                <span>
                  Test BTC from the Mezo faucet
                  <span className="block text-[12.5px] text-fg-subtle">Pays gas and can be swapped or locked in a trove.</span>
                </span>
                <Button size="sm" variant="secondary" asChild>
                  <a href={MEZO_LINKS.faucet} target="_blank" rel="noreferrer">
                    Faucet <ExternalLink className="size-3.5" />
                  </a>
                </Button>
              </li>
              <li className="flex items-center justify-between gap-3 px-5 py-3">
                <span>
                  Show MUSD in your wallet
                  <span className="block text-[12.5px] text-fg-subtle">Adds the official token to MetaMask, Rabby and others.</span>
                </span>
                <Button size="sm" variant="secondary" onClick={() => net.addMusd()}>
                  <Plus className="size-3.5" /> Add MUSD
                </Button>
              </li>
              <li className="flex items-center justify-between gap-3 px-5 py-3">
                <span>
                  MUSD token contract
                  <span className="block text-[12.5px] text-fg-subtle">Official Mezo USD on testnet.</span>
                </span>
                <a href={explorerAddressUrl(MUSD.address)} target="_blank" rel="noreferrer" className="font-mono text-[12.5px] text-blue-600 hover:underline">
                  {MUSD.address.slice(0, 8)}…{MUSD.address.slice(-6)}
                </a>
              </li>
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
