"use client";

import { forwardRef, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/client/cn";

export function Panel({ className, raised, ...p }: HTMLAttributes<HTMLDivElement> & { raised?: boolean }) {
  return <div className={cn(raised ? "surface-raised" : "surface", "rounded-[var(--radius-panel)]", className)} {...p} />;
}

export function PanelHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-3", className)}>
      <div className="min-w-0">
        <h2 className="font-display text-[17px] font-semibold tracking-[-0.01em] text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-fg-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2 text-[13px] text-fg-subtle">{eyebrow}</div>}
        <h1 className="font-display text-[28px] leading-[1.1] font-semibold tracking-[-0.025em] text-fg sm:text-[34px]">{title}</h1>
        {description && <p className="mt-2 max-w-[62ch] text-[15px] text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Tones, in three colours. Names are historical; meaning is what matters:
 *   mint   = verified / settled      -> solid blue
 *   violet = info / brand            -> blue tint
 *   cyan   = owed to you             -> blue outline
 *   sky    = pending / in progress   -> blue outline, dashed
 *   amber  = you owe / needs action  -> black outline
 *   rose   = failed / rejected       -> solid black
 *   neutral                          -> grey
 */
type Tone = "neutral" | "violet" | "cyan" | "amber" | "mint" | "rose" | "sky";
const tones: Record<Tone, string> = {
  neutral: "bg-wash text-fg-muted border-line",
  violet: "bg-blue-50 text-blue-700 border-blue-200",
  cyan: "bg-paper text-blue-700 border-blue-600",
  amber: "bg-paper text-fg border-fg",
  mint: "bg-blue-600 text-white border-blue-600",
  rose: "bg-fg text-white border-fg",
  sky: "bg-paper text-blue-700 border-blue-600 border-dashed",
};
const calloutTones: Record<Tone, string> = {
  neutral: "bg-wash border-line",
  violet: "bg-blue-50 border-blue-200",
  cyan: "bg-blue-50 border-blue-200",
  amber: "bg-paper border-fg",
  mint: "bg-blue-50 border-blue-600",
  rose: "bg-paper border-fg border-l-4",
  sky: "bg-blue-50 border-blue-200",
};

export function Badge({ tone = "neutral", className, children, ...p }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-px text-[12px] leading-5 font-medium whitespace-nowrap", tones[tone], className)}
      {...p}
    >
      {children}
    </span>
  );
}

export function Field({ label, hint, error, children, htmlFor, className }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-fg">
        {label}
      </label>
      {children}
      {error ? (
        <p className="flex items-center gap-1 text-[12.5px] font-medium text-fg" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12.5px] text-fg-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

const control =
  "w-full rounded-[var(--radius-control)] border border-line-strong bg-paper px-3 text-[14px] text-fg placeholder:text-fg-subtle transition-colors hover:border-fg-subtle focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20 disabled:bg-wash disabled:opacity-70 aria-[invalid=true]:border-2 aria-[invalid=true]:border-fg";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(control, "h-10", className)} {...p} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(control, "min-h-[84px] py-2 leading-relaxed", className)} {...p} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        control,
        "h-10 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23666666%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:14px] bg-[position:right_12px_center] bg-no-repeat pr-9",
        className,
      )}
      {...p}
    >
      {children}
    </select>
  );
});

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-[6px] bg-wash", className)} aria-hidden="true" />;
}

export function EmptyState({ icon, title, children, action, className }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      {icon && <div className="mb-4 grid size-12 place-items-center rounded-[var(--radius-card)] bg-blue-50 text-blue-600">{icon}</div>}
      <h3 className="font-display text-[17px] font-semibold text-fg">{title}</h3>
      {children && <div className="mt-1.5 max-w-[46ch] text-[14px] text-fg-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded-[5px] border border-line-strong bg-wash px-1.5 py-px font-sans text-[11px] text-fg-muted">{children}</kbd>;
}

export function StatRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 py-2.5 text-[14px]", className)}>
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-right text-fg">{children}</dd>
    </div>
  );
}

export function Callout({ tone = "violet", title, children, className, icon }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <div className={cn("flex gap-3 rounded-[var(--radius-card)] border px-4 py-3 text-[13.5px] text-fg", calloutTones[tone], className)} role="status">
      {icon && <div className="mt-0.5 shrink-0">{icon}</div>}
      <div className="min-w-0 text-fg-muted">
        {title && <div className="mb-0.5 font-medium text-fg">{title}</div>}
        {children}
      </div>
    </div>
  );
}
