"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatUnits, parseUnits } from "viem";
import { Amount } from "@/components/money";
import { TxLink } from "@/components/identity";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { explorerAddressUrl } from "@/config/chains";
import { BTC_GAS_RESERVE, MEZO_POOLS, SWAP_TOKENS, type SwapTokenId } from "@/config/contracts";
import { cn } from "@/lib/client/cn";
import { mezoErrorMessage, quoteInputFor, quoteSwap, swapToMusd, waitForSuccess, type MezoPosition } from "@/lib/client/mezo";
import { useRefreshChain } from "@/lib/client/use-mezo";
import { toDecimalString } from "@/lib/engine/money";

const SLIPPAGE_BPS = 100n; // 1%

function parse(v: string): bigint | null {
  if (!/^\d*\.?\d*$/.test(v) || v === "" || v === ".") return null;
  try {
    return parseUnits(v, 18);
  } catch {
    return null;
  }
}

/**
 * Swap BTC or MEZO for MUSD on Mezo Pools. With `targetMusd`, it sizes the input so you receive at
 * least that much MUSD — used on the payment screen to cover a shortfall exactly.
 */
export function SwapPanel({ owner, position, targetMusd, onDone, className }: { owner: string; position?: MezoPosition; targetMusd?: bigint; onDone?: () => void; className?: string }) {
  const [token, setToken] = useState<SwapTokenId>("BTC");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const refresh = useRefreshChain();
  const t = SWAP_TOKENS[token];
  const balance = token === "BTC" ? position?.balances.btc : position?.balances.mezo;
  const spendable = balance === undefined ? undefined : token === "BTC" ? (balance > BTC_GAS_RESERVE ? balance - BTC_GAS_RESERVE : 0n) : balance;

  // target mode: compute the input needed for at least `targetMusd` (+0.5% buffer for slippage)
  const need = useQuery({
    queryKey: ["swap-need", token, targetMusd?.toString()],
    queryFn: () => quoteInputFor(token, (targetMusd! * 1005n) / 1000n),
    enabled: !!targetMusd && targetMusd > 0n,
    staleTime: 15_000,
  });
  const amountIn = targetMusd ? (need.data ?? null) : parse(input);
  const quote = useQuery({
    queryKey: ["swap-quote", token, amountIn?.toString()],
    queryFn: () => quoteSwap(token, amountIn!),
    enabled: !!amountIn && amountIn > 0n,
    staleTime: 10_000,
    refetchInterval: 20_000,
  });
  const out = quote.data;
  const minOut = out ? (out * (10_000n - SLIPPAGE_BPS)) / 10_000n : 0n;
  const tooMuch = amountIn !== null && spendable !== undefined && amountIn > spendable;
  const error = amountIn === null && input && !targetMusd ? "Enter an amount like 0.0005" : tooMuch ? `You can swap up to ${Number(formatUnits(spendable ?? 0n, 18)).toFixed(6)} ${t.symbol}${token === "BTC" ? " (some BTC is kept for gas)" : ""}` : null;

  async function swap() {
    if (!amountIn || !out) return;
    setBusy(true);
    setLastTx(null);
    try {
      const hash = await swapToMusd({ owner, token, amountIn, minOut, onStep: setStep });
      setLastTx(hash);
      setStep("Waiting for Mezo to confirm the swap…");
      await waitForSuccess(hash);
      toast.success("Swap confirmed", { description: `Received at least ${toDecimalString(minOut)} MUSD` });
      setInput("");
      await refresh();
      onDone?.();
    } catch (e) {
      toast.error("Swap not completed", { description: mezoErrorMessage(e) });
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  return (
    <div className={cn("space-y-4", className)}>
      <div role="radiogroup" aria-label="Pay with" className="inline-flex rounded-[var(--radius-control)] border border-line-strong p-0.5 text-[13px]">
        {(Object.keys(SWAP_TOKENS) as SwapTokenId[]).map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={token === id}
            onClick={() => setToken(id)}
            className={cn("rounded-[6px] px-3 py-1.5 font-medium", token === id ? "bg-fg text-white" : "text-fg-muted hover:text-fg")}
          >
            {SWAP_TOKENS[id].symbol}
          </button>
        ))}
      </div>
      {targetMusd ? (
        <div className="rounded-[var(--radius-card)] border border-line p-4">
          <div className="text-[12.5px] text-fg-muted">You swap</div>
          <div className="num mt-1 font-display text-[22px] font-semibold">{amountIn ? `${Number(formatUnits(amountIn, 18)).toFixed(token === "BTC" ? 6 : 4)} ${t.symbol}` : need.isError ? "No quote" : "…"}</div>
        </div>
      ) : (
        <Field
          label={`${t.name} to swap`}
          htmlFor="swap-in"
          error={error}
          hint={
            spendable !== undefined ? (
              <>
                Available {Number(formatUnits(spendable, 18)).toFixed(6)} {t.symbol}
                {token === "BTC" ? " after keeping some for gas" : ""}
              </>
            ) : undefined
          }
        >
          <div className="flex gap-2">
            <Input id="swap-in" inputMode="decimal" placeholder="0.0" value={input} aria-invalid={!!error} onChange={(e) => setInput(e.target.value.replace(/[^\d.]/g, ""))} className="num h-11 text-[17px]" />
            {spendable !== undefined && spendable > 0n && (
              <Button variant="secondary" className="h-11" onClick={() => setInput(formatUnits(spendable, 18))}>
                Max
              </Button>
            )}
          </div>
        </Field>
      )}
      {targetMusd && tooMuch && <p className="text-[12.5px] font-medium text-fg">{error}</p>}
      <div className="flex justify-center text-fg-subtle" aria-hidden="true">
        <ArrowDown className="size-4" />
      </div>
      <div className="rounded-[var(--radius-card)] border border-line bg-wash p-4">
        <div className="text-[12.5px] text-fg-muted">You receive about</div>
        <div className="num mt-1 font-display text-[22px] font-semibold">{out ? <Amount value={out} /> : quote.isFetching || need.isFetching ? "…" : "—"}</div>
        {out && (
          <p className="mt-1 text-[12.5px] text-fg-muted">
            At least <Amount value={minOut} /> with 1% slippage protection.
          </p>
        )}
      </div>
      <Button className="w-full" size="lg" disabled={!amountIn || !out || !!error || busy} loading={busy} onClick={swap}>
        {busy ? (step ?? "Working…") : `Swap ${t.symbol} for MUSD`}
      </Button>
      {lastTx && (
        <p className="flex items-center justify-between gap-2 text-[12.5px] text-fg-muted">
          Swap transaction <TxLink hash={lastTx} />
        </p>
      )}
      <p className="text-[12px] text-fg-subtle">
        Routed through the{" "}
        <a href={explorerAddressUrl(MEZO_POOLS.router)} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
          Mezo Pools router
        </a>
        . {token === "BTC" ? "BTC is Mezo's gas token; the first swap needs a one-time approval of the exact amount." : "The first swap needs an approval of the exact amount."}
      </p>
    </div>
  );
}
