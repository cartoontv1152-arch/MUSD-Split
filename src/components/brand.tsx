import { cn } from "@/lib/client/cn";

/** The mark: one bill split in two — a blue share and a black share, joined by a white seam. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#002fa7" />
      <path d="M7 9h18v6H7z" fill="#fff" />
      <path d="M7 17h9v6H7z" fill="#fff" />
      <path d="M18 17h7v6h-7z" fill="#000" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="font-display text-[17px] font-semibold tracking-[-0.02em] whitespace-nowrap text-fg">
        MUSD <span className="font-normal text-fg-muted">Split</span>
      </span>
    </span>
  );
}
