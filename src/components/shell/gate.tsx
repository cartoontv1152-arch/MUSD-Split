"use client";

import { ShieldCheck, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { useAccount } from "wagmi";
import { useSession } from "@/components/providers/session";
import { Button } from "@/components/ui/button";
import { Panel, Skeleton } from "@/components/ui/primitives";

/** Pages that need an authenticated wallet render this until the user signs in. */
export function SignInGate({ children, title = "Connect your wallet to continue" }: { children: ReactNode; title?: string }) {
  const { address, loading, openConnect, signIn, signingIn } = useSession();
  const { isConnected } = useAccount();
  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (address) return <>{children}</>;
  return (
    <Panel className="mx-auto mt-10 max-w-[520px] px-8 py-10 text-center">
      <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl border border-line-strong bg-ink-800 text-violet-300">
        <Wallet className="size-6" />
      </div>
      <h1 className="font-display text-[22px] font-semibold tracking-[-0.02em]">{title}</h1>
      <p className="mx-auto mt-2 max-w-[42ch] text-[14.5px] text-fg-muted">
        Your wallet address is your account. Signing in uses a one-time message signature — it&apos;s free and moves no funds.
      </p>
      <div className="mt-6 flex justify-center">
        {isConnected ? (
          <Button size="lg" loading={signingIn} onClick={() => signIn()}>
            <ShieldCheck className="size-4" /> Sign in with wallet
          </Button>
        ) : (
          <Button size="lg" onClick={openConnect}>
            <Wallet className="size-4" /> Connect wallet
          </Button>
        )}
      </div>
    </Panel>
  );
}
