"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { explorerAddressUrl, explorerTxUrl } from "@/config/chains";
import { cn, shortAddress } from "@/lib/client/cn";
import type { Profile, Profiles } from "@/lib/client/types";

/**
 * Deterministic geometric mark from the address — the same person looks the same everywhere.
 * 4 colour pairs × 4 shapes × 4 rotations, all in the product's blue / black / white.
 */
const PAIRS: Array<[string, string]> = [
  ["#002fa7", "#ffffff"],
  ["#000000", "#ffffff"],
  ["#e3e9f7", "#002fa7"],
  ["#ffffff", "#000000"],
];
function markFor(address: string) {
  const h = parseInt(address.slice(2, 10) || "0", 16);
  return { pair: PAIRS[h % 4], shape: (h >> 2) % 4, rot: ((h >> 4) % 4) * 90 };
}

export function Avatar({ address, profile, size = 32, className, ring }: { address: string; profile?: Profile | null; size?: number; className?: string; ring?: boolean }) {
  const label = profile?.displayName || profile?.username || shortAddress(address);
  if (profile?.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={profile.avatarUrl}
        alt=""
        width={size}
        height={size}
        className={cn("shrink-0 rounded-full object-cover", ring && "ring-2 ring-paper", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  const { pair, shape, rot } = markFor(address.toLowerCase());
  const [bg, fg] = pair;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={cn("shrink-0 rounded-full", ring && "ring-2 ring-paper", className)}
      style={{ width: size, height: size }}
    >
      <circle cx="16" cy="16" r="16" fill={bg} />
      {bg === "#ffffff" && <circle cx="16" cy="16" r="15.5" fill="none" stroke="#c4c4c4" />}
      <g transform={`rotate(${rot} 16 16)`} fill={fg}>
        {shape === 0 && <path d="M16 0a16 16 0 0 1 0 32z" />}
        {shape === 1 && <path d="M16 16V0a16 16 0 0 1 16 16z" />}
        {shape === 2 && <circle cx="16" cy="16" r="6.5" />}
        {shape === 3 && <rect x="12" y="-2" width="8" height="36" transform="rotate(45 16 16)" />}
      </g>
    </svg>
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
          className="grid place-items-center rounded-full bg-wash-2 text-[11px] font-medium text-fg-muted ring-2 ring-paper"
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
      className={cn("inline-flex items-center gap-1 rounded-md p-1 text-fg-subtle hover:bg-wash-2 hover:text-fg", className)}
      aria-label={done ? "Copied" : label}
      title={done ? "Copied" : label}
    >
      {done ? <Check className="size-3.5 text-blue-600" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function AddressChip({ address, full, className }: { address: string; full?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 font-mono text-[12.5px] text-fg-muted", className)}>
      <span className={cn(full ? "break-all" : "truncate")}>{full ? address : shortAddress(address)}</span>
      <CopyButton value={address} label="Copy address" />
      <a href={explorerAddressUrl(address)} target="_blank" rel="noreferrer" className="rounded-md p-1 text-fg-subtle hover:bg-wash-2 hover:text-fg" aria-label="Open address in explorer">
        <ExternalLink className="size-3.5" />
      </a>
    </span>
  );
}

export function TxLink({ hash, className, short = true }: { hash: string; className?: string; short?: boolean }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 font-mono text-[12.5px]", className)}>
      <a href={explorerTxUrl(hash)} target="_blank" rel="noreferrer" className="truncate text-blue-600 underline-offset-2 hover:underline">
        {short ? shortAddress(hash, 10, 8) : hash}
      </a>
      <CopyButton value={hash} label="Copy transaction hash" />
    </span>
  );
}
