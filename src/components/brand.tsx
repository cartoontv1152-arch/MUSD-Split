import { cn } from "@/lib/client/cn";

/** Two member orbs joined by a single settled thread — the product in one mark. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden="true">
      <defs>
        <linearGradient id="lm-thread" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a68fff" />
          <stop offset="1" stopColor="#46ddeb" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="#131a37" />
      <path d="M9.5 21.5C13 21.5 13.5 10.5 22.5 10.5" stroke="url(#lm-thread)" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <circle cx="9.5" cy="21.5" r="4" fill="#8a6cff" />
      <circle cx="22.5" cy="10.5" r="4" fill="#46ddeb" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="font-display text-[17px] font-semibold tracking-[-0.02em] text-fg">
        MUSD <span className="font-normal text-fg-muted">Split</span>
      </span>
    </span>
  );
}
