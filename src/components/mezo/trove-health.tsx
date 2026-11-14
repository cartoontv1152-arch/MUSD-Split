"use client";

import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { Amount } from "@/components/money";
import { Badge, Skeleton } from "@/components/ui/primitives";
import { explorerAddressUrl } from "@/config/chains";
import { MEZO_PROTOCOL } from "@/config/mezo";
import { cn } from "@/lib/client/cn";
import type { MezoPosition } from "@/lib/client/mezo";
import { btc, pct, usd } from "@/lib/client/use-mezo";
import { ONE, healthBand } from "@/lib/mezo/trove-math";

const SCALE_MIN = 100n * 10n ** 16n; // 100%
const SCALE_MAX = 300n * 10n ** 16n; // 300%
const at = (r: bigint) => {
  const c = r < SCALE_MIN ? SCALE_MIN : r > SCALE_MAX ? SCALE_MAX : r;
  return Number(((c - SCALE_MIN) * 10000n) / (SCALE_MAX - SCALE_MIN)) / 100;
};

const BAND = {
  none: { label: "No debt", tone: "neutral" as const },
  healthy: { label: "Healthy", tone: "mint" as const },
  watch: { label: "Watch", tone: "sky" as const },
  risk: { label: "At risk", tone: "rose" as const },
};

/**
 * Collateral ratio on a 100–300% scale with the two protocol lines that matter: 110% (this trove
 * can be liquidated) and 150% (system recovery threshold). Optional projected marker shows the
 * ratio after a borrow / repay / deposit before the user signs.
 */
export function RatioScale({ ratio, projected, mcr, ccr }: { ratio: bigint | null; projected?: bigint | null; mcr: bigint; ccr: bigint }) {
  return (
    <div className="pt-6 pb-5" aria-hidden="true">
      <div className="relative h-2 rounded-full bg-wash">
        <div className="absolute inset-y-0 left-0 rounded-l-full bg-fg/15" style={{ width: `${at(mcr)}%` }} />
        {[
          [mcr, "110%"],
          [ccr, "150%"],
        ].map(([v, label]) => (
          <div key={String(label)} className="absolute -top-5 flex -translate-x-1/2 flex-col items-center" style={{ left: `${at(v as bigint)}%` }}>
            <span className="text-[10.5px] whitespace-nowrap text-fg-subtle">{label as string}</span>
            <span className="mt-0.5 h-5 w-px bg-fg/40" />
          </div>
        ))}
        {projected != null && projected !== ratio && (
          <div className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-blue-600 bg-paper" style={{ left: `${at(projected)}%` }} />
        )}
        {ratio != null && (
          <div className={cn("absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-paper", ratio < ccr ? "bg-fg" : "bg-blue-600")} style={{ left: `${at(ratio)}%` }} />
        )}
      </div>
      <div className="mt-2 flex justify-between gap-3 text-[10.5px] text-fg-subtle">
        <span>100%</span>
        <span className="text-center">Below 110% the trove can be liquidated. Below 150% Mezo limits new borrowing in recovery mode.</span>
        <span>300%+</span>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 text-[13.5px]">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="num text-right">{children}</dd>
    </div>
  );
}

export function TroveHealth({
  position,
  isLoading,
  projected,
  compact,
  className,
  footer,
}: {
  position?: MezoPosition;
  isLoading?: boolean;
  /** ratio + liquidation price after the action being previewed */
  projected?: { ratio: bigint | null; liquidationPrice: bigint | null; debt?: bigint; label: string } | null;
  compact?: boolean;
  className?: string;
  footer?: ReactNode;
}) {
  if (isLoading || !position) return <Skeleton className={cn("h-[220px]", className)} />;
  const { trove: t, params: p } = position;
  if (!t.active) {
    return (
      <div className={cn("surface rounded-[var(--radius-panel)] p-5", className)}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-[16px] font-semibold">No Mezo trove yet</h3>
            <p className="mt-1 max-w-[52ch] text-[13.5px] text-fg-muted">
              A trove locks BTC and lets you borrow MUSD against it at a fixed {(position.newTroveRateBps / 100).toFixed(2)}% APR. The smallest trove borrows{" "}
              <Amount value={p.minNetDebt} unit={false} /> MUSD, so it needs about {btc(((p.minNetDebt + p.gasCompensation) * 15n * ONE) / (10n * p.price), 4)} of BTC at a safe 150% ratio.
            </p>
          </div>
        </div>
        {footer}
      </div>
    );
  }
  const band = BAND[healthBand(t.ratio, p)];
  return (
    <div className={cn("surface rounded-[var(--radius-panel)] p-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[13px] text-fg-muted">Your trove&apos;s collateral ratio</div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="num font-display text-[34px] leading-none font-semibold tracking-[-0.02em]">{pct(t.ratio)}</span>
            {projected && (
              <span className="num text-[14px] text-blue-700">
                {projected.label} {pct(projected.ratio)}
              </span>
            )}
          </div>
        </div>
        <Badge tone={band.tone}>{band.label}</Badge>
      </div>
      <RatioScale ratio={t.ratio} projected={projected?.ratio} mcr={p.mcr} ccr={p.ccr} />
      <dl className="divide-y divide-line border-t border-line">
        <Row label="BTC locked">
          {btc(t.coll)} <span className="text-fg-subtle">({usd((t.coll * p.price) / ONE)})</span>
        </Row>
        <Row label="MUSD debt">
          <Amount value={t.debt} />
          {projected?.debt !== undefined && (
            <span className="block text-[12px] text-blue-700">
              {projected.label} <Amount value={projected.debt} unit={false} />
            </span>
          )}
        </Row>
        <Row label="Liquidated if BTC falls below">
          {t.liquidationPrice ? usd(t.liquidationPrice) : "—"}
          {projected?.liquidationPrice && <span className="block text-[12px] text-blue-700">{projected.label} {usd(projected.liquidationPrice)}</span>}
        </Row>
        {!compact && (
          <>
            <Row label="BTC price (Mezo oracle)">{usd(p.price)}</Row>
            <Row label="Interest rate">{(t.rateBps / 100).toFixed(2)}% APR, fixed</Row>
          </>
        )}
      </dl>
      {position.recoveryMode && (
        <p className="mt-3 border-l-4 border-fg pl-3 text-[12.5px] text-fg">Mezo is in recovery mode: new borrowing must keep your ratio above 150%.</p>
      )}
      <p className="mt-3 text-[12px] text-fg-subtle">
        Read live from Mezo&apos;s{" "}
        <a href={explorerAddressUrl(MEZO_PROTOCOL.TroveManager)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-blue-600 hover:underline">
          TroveManager <ExternalLink className="size-3" />
        </a>{" "}
        and price feed.
      </p>
      {footer}
    </div>
  );
}
