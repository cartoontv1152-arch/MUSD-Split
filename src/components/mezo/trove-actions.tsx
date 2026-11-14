"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { formatUnits, parseUnits } from "viem";
import { Amount } from "@/components/money";
import { TxLink } from "@/components/identity";
import { Button } from "@/components/ui/button";
import { Callout, Field, Input } from "@/components/ui/primitives";
import { BTC_GAS_RESERVE } from "@/config/contracts";
import { MEZO_LINKS } from "@/config/mezo";
import { cn } from "@/lib/client/cn";
import { addCollateral, borrowToWallet, mezoErrorMessage, openTrove, repayDebt, waitForSuccess, type MezoPosition } from "@/lib/client/mezo";
import { btc, pct, useRefreshChain, usd } from "@/lib/client/use-mezo";
import { ONE, afterAddCollateral, afterBorrow, afterRepay, maxAdditionalBorrow, openTroveQuote } from "@/lib/mezo/trove-math";
import { TroveHealth } from "./trove-health";

type Action = "borrow" | "deposit" | "repay";

function parse(v: string): bigint | null {
  if (!/^\d*\.?\d*$/.test(v) || v === "" || v === ".") return null;
  try {
    return parseUnits(v, 18);
  } catch {
    return null;
  }
}

/** Ratio we suggest as the safe floor for new borrowing (the protocol allows down to 110%). */
const SAFE_RATIO = 150n * 10n ** 16n;

export function TroveManager({ owner, position, isLoading }: { owner: string; position?: MezoPosition; isLoading?: boolean }) {
  const [action, setAction] = useState<Action>("borrow");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const refresh = useRefreshChain();
  const amount = parse(value);

  const preview = useMemo(() => {
    if (!position?.trove.active || !amount) return null;
    const t = position.trove;
    const p = position.params;
    if (action === "borrow") {
      const a = afterBorrow(t, p, amount);
      return { ratio: a.ratio, liquidationPrice: a.liquidationPrice, debt: a.debt, label: "after" };
    }
    if (action === "deposit") {
      const a = afterAddCollateral(t, p, amount);
      return { ratio: a.ratio, liquidationPrice: a.liquidationPrice, label: "after" };
    }
    const a = afterRepay(t, p, amount);
    return { ratio: a.ratio, liquidationPrice: a.liquidationPrice, debt: a.debt, label: "after" };
  }, [position, amount, action]);

  if (!position?.trove.active) {
    return (
      <TroveHealth
        position={position}
        isLoading={isLoading}
        footer={position && <OpenTrove owner={owner} position={position} />}
      />
    );
  }
  const t = position.trove;
  const p = position.params;
  const minRatio = position.recoveryMode ? p.ccr : p.mcr;
  const maxBorrow = maxAdditionalBorrow(t, p, minRatio);
  const maxSafe = maxAdditionalBorrow(t, p, SAFE_RATIO);
  const btcSpendable = position.balances.btc > BTC_GAS_RESERVE ? position.balances.btc - BTC_GAS_RESERVE : 0n;
  const repayMax = position.balances.musd < t.debt ? position.balances.musd : t.debt;

  const error = (() => {
    if (value && amount === null) return "Enter a number";
    if (!amount) return null;
    if (action === "borrow" && amount > maxBorrow) return `At most ${formatUnits(maxBorrow, 18)} MUSD keeps you above ${pct(minRatio, 0)}`;
    if (action === "deposit" && amount > btcSpendable) return `You can add up to ${btc(btcSpendable)} (some BTC is kept for gas)`;
    if (action === "repay" && amount > repayMax) return `You can repay up to ${formatUnits(repayMax, 18)} MUSD from your wallet`;
    if (action === "repay" && t.debt - amount < p.minNetDebt + p.gasCompensation) return "A trove can't go below the minimum debt. Close it on the Mezo app instead.";
    return null;
  })();

  async function submit() {
    if (!amount || error || !position) return;
    setBusy(true);
    setLastTx(null);
    try {
      const hash =
        action === "borrow" ? await borrowToWallet(owner, amount, position) : action === "deposit" ? await addCollateral(owner, amount, position) : await repayDebt(owner, amount, position);
      setLastTx(hash);
      await waitForSuccess(hash);
      toast.success(action === "borrow" ? "Borrowed MUSD to your wallet" : action === "deposit" ? "BTC added to your trove" : "Debt repaid");
      setValue("");
      await refresh();
    } catch (e) {
      toast.error("Not completed", { description: mezoErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  const tabs: Array<[Action, string]> = [
    ["borrow", "Borrow MUSD"],
    ["deposit", "Add BTC"],
    ["repay", "Repay"],
  ];
  return (
    <div className="space-y-4">
      <TroveHealth position={position} projected={preview} />
      <div className="surface rounded-[var(--radius-panel)] p-5">
        <div role="tablist" aria-label="Trove action" className="inline-flex rounded-[var(--radius-control)] border border-line-strong p-0.5 text-[13px]">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={action === id}
              onClick={() => {
                setAction(id);
                setValue("");
              }}
              className={cn("rounded-[6px] px-3 py-1.5 font-medium", action === id ? "bg-fg text-white" : "text-fg-muted hover:text-fg")}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-4">
          <Field
            label={action === "deposit" ? "BTC to add" : action === "borrow" ? "MUSD to borrow into your wallet" : "MUSD to repay"}
            htmlFor="trove-amt"
            error={error}
            hint={
              action === "borrow" ? (
                <>
                  Up to <Amount value={maxSafe} /> keeps you at 150% or more. Borrowing adds a 0.1% fee to your debt.
                </>
              ) : action === "deposit" ? (
                `Available ${btc(btcSpendable)} after keeping some for gas.`
              ) : (
                <>
                  Wallet balance <Amount value={position.balances.musd} />.
                </>
              )
            }
          >
            <div className="flex gap-2">
              <Input id="trove-amt" inputMode="decimal" placeholder="0.00" value={value} aria-invalid={!!error} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))} className="num h-11 text-[17px]" />
              <Button
                variant="secondary"
                className="h-11"
                onClick={() => setValue(formatUnits(action === "borrow" ? maxSafe : action === "deposit" ? btcSpendable : repayMax, 18))}
              >
                {action === "borrow" ? "Safe max" : "Max"}
              </Button>
            </div>
          </Field>
        </div>
        {action === "borrow" && preview?.ratio && preview.ratio < SAFE_RATIO && !error && (
          <Callout tone="amber" className="mt-3">
            This leaves your ratio at {pct(preview.ratio)}. If BTC drops below {preview.liquidationPrice ? usd(preview.liquidationPrice) : "—"}, the trove can be liquidated.
          </Callout>
        )}
        <Button className="mt-4 w-full" size="lg" disabled={!amount || !!error || busy} loading={busy} onClick={submit}>
          {action === "borrow" ? "Borrow" : action === "deposit" ? "Add BTC" : "Repay"}
        </Button>
        {lastTx && (
          <p className="mt-3 flex items-center justify-between gap-2 text-[12.5px] text-fg-muted">
            Transaction <TxLink hash={lastTx} />
          </p>
        )}
      </div>
    </div>
  );
}

function OpenTrove({ owner, position }: { owner: string; position: MezoPosition }) {
  const p = position.params;
  const quoteMin = openTroveQuote(0n, p, SAFE_RATIO).minAmount;
  const [borrow, setBorrow] = useState(formatUnits(((quoteMin + ONE - 1n) / ONE) * ONE, 18));
  const [busy, setBusy] = useState(false);
  const [lastTx, setLastTx] = useState<string | null>(null);
  const refresh = useRefreshChain();
  const amount = parse(borrow);
  const q = amount ? openTroveQuote(amount, p, SAFE_RATIO) : null;
  const btcSpendable = position.balances.btc > BTC_GAS_RESERVE ? position.balances.btc - BTC_GAS_RESERVE : 0n;
  const error = !amount ? "Enter an amount" : !q!.meetsMinDebt ? `A trove must borrow at least ${formatUnits(quoteMin, 18).split(".")[0]} MUSD` : q!.collNeeded > btcSpendable ? `Needs ${btc(q!.collNeeded)} — you have ${btc(btcSpendable)} available` : null;

  async function submit() {
    if (!amount || !q || error) return;
    setBusy(true);
    try {
      const hash = await openTrove(owner, amount, q.collNeeded, position);
      setLastTx(hash);
      await waitForSuccess(hash);
      toast.success("Trove opened", { description: `${formatUnits(amount, 18)} MUSD is in your wallet` });
      await refresh();
    } catch (e) {
      toast.error("Trove not opened", { description: mezoErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-5 border-t border-line pt-5">
      <h4 className="text-[14px] font-medium">Open a trove</h4>
      <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <Field label="MUSD to borrow" htmlFor="open-amt" error={amount && error ? error : null}>
          <Input id="open-amt" inputMode="decimal" value={borrow} onChange={(e) => setBorrow(e.target.value.replace(/[^\d.]/g, ""))} className="num h-11 text-[17px]" />
        </Field>
        <Button size="lg" disabled={!!error || busy} loading={busy} onClick={submit}>
          Lock BTC and borrow
        </Button>
      </div>
      {q && (
        <dl className="mt-4 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
          <div className="flex justify-between gap-2">
            <dt className="text-fg-muted">BTC to lock (150%)</dt>
            <dd className="num">{btc(q.collNeeded)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-fg-muted">Total debt</dt>
            <dd className="num">
              <Amount value={q.totalDebt} />
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-fg-muted">Borrowing fee (0.1%)</dt>
            <dd className="num">
              <Amount value={q.fee} />
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-fg-muted">Liquidation reserve</dt>
            <dd className="num">
              <Amount value={p.gasCompensation} />
            </dd>
          </div>
        </dl>
      )}
      <p className="mt-3 text-[12px] text-fg-subtle">
        Need test BTC?{" "}
        <a href={MEZO_LINKS.faucet} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
          Mezo faucet
        </a>
        . The 200 MUSD liquidation reserve is returned when you close the trove.
      </p>
      {lastTx && (
        <p className="mt-2 flex items-center justify-between gap-2 text-[12.5px] text-fg-muted">
          Transaction <TxLink hash={lastTx} />
        </p>
      )}
    </div>
  );
}
