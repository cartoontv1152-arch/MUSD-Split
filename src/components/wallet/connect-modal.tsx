"use client";

import { ExternalLink, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { useConnect, useConnectors, type Connector } from "wagmi";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/button";
import { errorMessage, isUserRejection } from "@/lib/client/api";
import { FAUCET_URL } from "@/config/chains";

export function ConnectModal({
  open,
  onOpenChange,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConnected: (address: string) => void;
}) {
  const connectors = useConnectors();
  const { connectAsync } = useConnect();
  const [pending, setPending] = useState<string | null>(null);

  // EIP-6963 wallets announce themselves (with an icon); the generic injected connector is a fallback.
  const list = useMemo(() => {
    const discovered = connectors.filter((c) => c.icon && c.id !== "injected");
    if (discovered.length) return discovered;
    const hasProvider = typeof window !== "undefined" && "ethereum" in window;
    return hasProvider ? connectors.filter((c) => c.id === "injected") : [];
  }, [connectors]);

  async function connect(c: Connector) {
    setPending(c.uid);
    try {
      const res = await connectAsync({ connector: c });
      const acct = res.accounts[0];
      if (acct) onConnected(acct);
    } catch (e) {
      if (!isUserRejection(e)) toast.error("Couldn't connect", { description: errorMessage(e) });
      else toast.message("Connection cancelled");
    } finally {
      setPending(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Connect a wallet"
      description="Your wallet is your account. You'll sign a message to prove it's yours — no gas, no funds move."
    >
      {list.length === 0 ? (
        <div className="rounded-[12px] border border-line-strong bg-ink-900/60 p-4 text-[14px] text-fg-muted">
          <p className="font-medium text-fg">No browser wallet detected</p>
          <p className="mt-1">Install an EVM wallet such as MetaMask or Rabby, then reload this page.</p>
          <div className="mt-3 flex flex-wrap gap-3 text-[13px]">
            <a className="inline-flex items-center gap-1 text-violet-300 hover:underline" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
              MetaMask <ExternalLink className="size-3" />
            </a>
            <a className="inline-flex items-center gap-1 text-violet-300 hover:underline" href="https://rabby.io/" target="_blank" rel="noreferrer">
              Rabby <ExternalLink className="size-3" />
            </a>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((c) => (
            <li key={c.uid}>
              <button
                type="button"
                onClick={() => connect(c)}
                disabled={!!pending}
                className="flex w-full items-center gap-3 rounded-[12px] border border-line-strong bg-ink-900/50 px-4 py-3 text-left transition-colors hover:border-violet-500/60 hover:bg-ink-800 disabled:opacity-60"
              >
                {c.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.icon} alt="" className="size-8 rounded-lg" />
                ) : (
                  <span className="grid size-8 place-items-center rounded-lg bg-ink-700">
                    <Wallet className="size-4 text-violet-300" />
                  </span>
                )}
                <span className="flex-1">
                  <span className="block text-[15px] font-medium text-fg">{c.id === "injected" ? "Browser wallet" : c.name}</span>
                  <span className="block text-[12.5px] text-fg-subtle">Injected · EIP-6963</span>
                </span>
                {pending === c.uid && <Spinner className="size-4 text-violet-300" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-[12.5px] leading-relaxed text-fg-subtle">
        MUSD Split runs on <span className="text-fg-muted">Mezo testnet</span>. Need test BTC for gas? Use the{" "}
        <a href={FAUCET_URL} target="_blank" rel="noreferrer" className="text-violet-300 hover:underline">
          Mezo faucet
        </a>
        . We never ask for your seed phrase or private key.
      </p>
    </Dialog>
  );
}
