"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { explorerAddressUrl, explorerTxUrl } from "@/config/chains";
import { cn, shortAddress } from "@/lib/client/cn";
import type { Profile, Profiles } from "@/lib/client/types";

/** Deterministic orb colours from the address — the same person looks the same everywhere. */
function orbColors(address: string): [string, string, number] {
  const h = parseInt(address.slice(2, 10) || "0", 16);
  const hues = [258, 268, 190, 200, 172, 285, 220, 32, 340];
  const a = hues[h % hues.length];
  const b = hues[(h >> 5) % hues.length];
  return [`hsl(${a} 82% 64%)`, `hsl(${b} 70% 38%)`, (h >> 9) % 360];
}

export function Avatar({ address, profile, size = 32, className, ring }: { address: string; profile?: Profile | null; size?: number; className?: string; ring?: boolean }) {
  const [a, b, rot] = orbColors(address.toLowerCase());
  const label = profile?.displayName || profile?.username || shortAddress(address);
  if (profile?.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={profile.avatarUrl}
        alt=""
        width={size}
        height={size}
        className={cn("shrink-0 rounded-full object-cover", ring && "ring-2 ring-ink-900", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("relative inline-block shrink-0 overflow-hidden rounded-full", ring && "ring-2 ring-ink-900", className)}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 32% 28%, rgb(255 255 255 / 0.55), transparent 32%), conic-gradient(from ${rot}deg, ${a}, ${b}, ${a})`,
        boxShadow: "inset 0 -4px 10px rgb(0 0 0 / 0.35)",
      }}
    />
  );
}

export function displayName(address: string, profiles?: Profiles | null, me?: string | null): string {
  const a = address.toLowerCase();
  if (me && a === me.toLowerCase()) return "You";
  const p = profiles?.[a];
  return p?.displayName || (p?.username ? `@${p.username}` : shortAddress(a));
}

export function MemberName({ address, profiles, me, className, withAvatar, size = 22 }: { address: string; profiles?: Profiles | null; me?: string | null; className?: string; withAvatar?: boolean; size?: number }) {
  const a = address.toLowerCase();
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)} title={a}>
      {withAvatar && <Avatar address={a} profile={profiles?.[a]} size={size} />}
      <span className="truncate">{displayName(a, profiles, me)}</span>
    </span>
  );
}

export function AvatarStack({ addresses, profiles, max = 5, size = 26 }: { addresses: string[]; profiles?: Profiles; max?: number; size?: number }) {
  const shown = addresses.slice(0, max);
  const rest = addresses.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((a, i) => (
        <span key={a} style={{ marginLeft: i === 0 ? 0 : -size * 0.3 }}>
          <Avatar address={a} profile={profiles?.[a]} size={size} ring />
        </span>
      ))}
      {rest > 0 && (
        <span
          className="grid place-items-center rounded-full bg-ink-700 text-[11px] font-medium text-fg-muted ring-2 ring-ink-900"
          style={{ width: size, height: size, marginLeft: -size * 0.3 }}
        >
          +{rest}
        </span>
      )}
    </div>
  );
}

export function CopyButton({ value, label = "Copy", className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        } catch {
          /* clipboard blocked */
        }
      }}
      className={cn("inline-flex items-center gap-1 rounded-md p-1 text-fg-subtle hover:bg-ink-750 hover:text-fg", className)}
      aria-label={done ? "Copied" : label}
      title={done ? "Copied" : label}
    >
      {done ? <Check className="size-3.5 text-mint-400" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function AddressChip({ address, full, className }: { address: string; full?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 font-mono text-[12.5px] text-fg-muted", className)}>
      <span className={cn(full ? "break-all" : "truncate")}>{full ? address : shortAddress(address)}</span>
      <CopyButton value={address} label="Copy address" />
      <a href={explorerAddressUrl(address)} target="_blank" rel="noreferrer" className="rounded-md p-1 text-fg-subtle hover:bg-ink-750 hover:text-fg" aria-label="Open address in explorer">
        <ExternalLink className="size-3.5" />
      </a>
    </span>
  );
}

export function TxLink({ hash, className, short = true }: { hash: string; className?: string; short?: boolean }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 font-mono text-[12.5px]", className)}>
      <a href={explorerTxUrl(hash)} target="_blank" rel="noreferrer" className="truncate text-cyan-300 underline-offset-2 hover:underline">
        {short ? shortAddress(hash, 10, 8) : hash}
      </a>
      <CopyButton value={hash} label="Copy transaction hash" />
    </span>
  );
}
