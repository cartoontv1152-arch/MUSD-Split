"use client";

import { useNetwork } from "@/lib/client/hooks";
import { formatAmount } from "@/lib/engine/money";
import { explorerAddressUrl } from "@/config/chains";
import { MUSD, SETTLEMENT_CONTRACT } from "@/config/contracts";

export function LiveStrip() {
  const { data, isError } = useNetwork();
  const items: Array<[string, React.ReactNode]> = [
    ["Latest Mezo testnet block", data?.ok ? `#${Number(data.blockNumber).toLocaleString()}` : isError ? "unavailable" : "…"],
    ["MUSD in circulation on testnet", data?.ok ? `${formatAmount(BigInt(data.musdTotalSupply), { fractionDigits: 0 })} MUSD` : "…"],
    ["Gas price", data?.ok ? `${Number(data.gasPriceWei).toLocaleString()} wei` : "…"],
    [
      "Settlement contract",
      <a key="c" href={explorerAddressUrl(SETTLEMENT_CONTRACT.address)} target="_blank" rel="noreferrer" className="font-mono text-cyan-300 hover:underline">
        {SETTLEMENT_CONTRACT.address.slice(0, 8)}…{SETTLEMENT_CONTRACT.address.slice(-6)}
      </a>,
    ],
    [
      "MUSD token",
      <a key="m" href={explorerAddressUrl(MUSD.address)} target="_blank" rel="noreferrer" className="font-mono text-cyan-300 hover:underline">
        {MUSD.address.slice(0, 8)}…{MUSD.address.slice(-6)}
      </a>,
    ],
  ];
  return (
    <section aria-label="Live network data" className="border-y border-line bg-ink-950/50">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-10 gap-y-4 px-4 py-5 sm:px-6">
        <span className="flex items-center gap-2 text-[12.5px] text-fg-subtle">
          <span className={data?.ok ? "size-1.5 animate-pulse-soft rounded-full bg-mint-400" : "size-1.5 rounded-full bg-fg-subtle"} /> Live from chain
        </span>
        {items.map(([k, v]) => (
          <div key={k}>
            <div className="text-[12px] text-fg-subtle">{k}</div>
            <div className="num text-[14.5px] text-fg">{v}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
