"use client";

import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { formatUnits } from "viem";
import { useSession } from "@/components/providers/session";
import { useNetworkActions } from "@/components/wallet/wallet-menu";
import { Button } from "@/components/ui/button";
import { useGasBalance, useMusdBalance, useWalletState } from "@/lib/client/hooks";
import { Amount } from "@/components/money";
import { FAUCET_URL } from "@/config/chains";

export interface PreflightState {
  ready: boolean;
  musdBalance: bigint | undefined;
  rows: Array<{ ok: boolean | null; label: ReactNode; action?: ReactNode }>;
}

/** The checks Feature 7 requires before any signature: wallet, network, identity, balance, gas. */
export function usePreflight(required: bigint): PreflightState {
  const { address: session, openConnect, signIn, signingIn } = useSession();
  const w = useWalletState();
  const net = useNetworkActions();
  const musd = useMusdBalance(w.address);
  const gas = useGasBalance(w.address);
  const sameAccount = !!w.address && w.address === session;
  const rows: PreflightState["rows"] = [
    {
      ok: w.isConnected,
      label: w.isConnected ? "Wallet connected" : "Connect your wallet",
      action: !w.isConnected && (
        <Button size="sm" onClick={openConnect}>
          Connect
        </Button>
      ),
    },
    {
      ok: w.isConnected ? w.onMezo : null,
      label: w.onMezo ? "On Mezo testnet (chain 31611)" : "Switch your wallet to Mezo testnet",
      action: w.isConnected && !w.onMezo && (
        <Button size="sm" onClick={() => net.switchToMezo()}>
          Switch network
        </Button>
      ),
    },
    {
      ok: w.isConnected ? sameAccount : null,
      label: sameAccount ? "Wallet matches your signed-in account" : "The connected wallet isn't the one you signed in with",
      action: w.isConnected && !sameAccount && (
        <Button size="sm" loading={signingIn} onClick={() => signIn()}>
          Sign in as this wallet
        </Button>
      ),
    },
    {
      ok: musd.data === undefined ? null : musd.data >= required,
      label:
        musd.data === undefined ? (
          "Checking MUSD balance…"
        ) : musd.data >= required ? (
          <>
            MUSD balance <Amount value={musd.data} /> is enough
          </>
        ) : (
          <>
            Not enough MUSD — you have <Amount value={musd.data} />
          </>
        ),
    },
    {
      ok: gas.data === undefined ? null : gas.data.value > 0n,
      label:
        gas.data === undefined ? (
          "Checking BTC for gas…"
        ) : gas.data.value > 0n ? (
          `BTC for gas: ${Number(formatUnits(gas.data.value, 18)).toFixed(6)}`
        ) : (
          <>
            No BTC for gas —{" "}
            <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="text-violet-300 underline">
              get some from the faucet
            </a>
          </>
        ),
    },
  ];
  return { ready: rows.every((r) => r.ok === true), musdBalance: musd.data, rows };
}

export function PreflightList({ rows }: { rows: PreflightState["rows"] }) {
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={i} className="flex min-h-9 items-center justify-between gap-3 text-[13.5px]">
          <span className="flex items-center gap-2.5">
            {r.ok === true ? (
              <CheckCircle2 className="size-4 shrink-0 text-mint-400" aria-label="OK" />
            ) : r.ok === false ? (
              <CircleAlert className="size-4 shrink-0 text-amber-300" aria-label="Needs attention" />
            ) : (
              <Loader2 className="size-4 shrink-0 animate-spin text-fg-subtle" aria-label="Checking" />
            )}
            <span className={r.ok === false ? "text-fg" : "text-fg-muted"}>{r.label}</span>
          </span>
          {r.action}
        </li>
      ))}
    </ul>
  );
}
