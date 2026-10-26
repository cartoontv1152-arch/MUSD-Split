import Link from "next/link";
import { Wordmark } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="max-w-[440px] text-center">
        <Wordmark />
        <h1 className="mt-10 font-display text-[40px] leading-tight font-semibold tracking-[-0.03em]">This page doesn&apos;t exist</h1>
        <p className="mt-3 text-[15px] text-fg-muted">The link may be broken, or the group or payment was removed.</p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/dashboard" className="rounded-[10px] bg-violet-600 px-4 py-2.5 text-[14px] font-medium text-white hover:bg-violet-500">Go to dashboard</Link>
          <Link href="/" className="rounded-[10px] border border-line-strong px-4 py-2.5 text-[14px] text-fg hover:bg-ink-800">Home</Link>
        </div>
      </div>
    </main>
  );
}
