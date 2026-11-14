import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand";
import { NetworkBadge } from "@/components/shell/app-shell";
import { WalletMenu } from "@/components/wallet/wallet-menu";

/** Header + footer for public pages (about, usage). */
export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper">
      <header className="sticky top-0 z-30 border-b border-line bg-paper">
        <div className="mx-auto flex h-16 max-w-[1240px] items-center gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="MUSD Split home">
            <Wordmark />
          </Link>
          <nav className="ml-6 hidden gap-6 text-[14px] text-fg-muted md:flex" aria-label="Site">
            <Link href="/#pay" className="hover:text-fg">
              Ways to pay
            </Link>
            <Link href="/about" className="hover:text-fg">
              About
            </Link>
            <Link href="/stats" className="hover:text-fg">
              Usage
            </Link>
            <Link href="/help" className="hover:text-fg">
              Help
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden sm:inline-flex">
              <NetworkBadge compact />
            </span>
            <WalletMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1240px] px-4 pt-12 pb-20 sm:px-6">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-4 px-4 py-8 text-[13px] text-fg-subtle sm:px-6">
          <span>MUSD Split runs on Mezo testnet. Testnet MUSD has no monetary value.</span>
          <nav className="flex flex-wrap gap-x-6 gap-y-2" aria-label="Footer">
            <Link href="/dashboard" className="hover:text-fg">
              Open the app
            </Link>
            <Link href="/help#risks" className="hover:text-fg">
              Risks
            </Link>
            <Link href="/legal" className="hover:text-fg">
              Terms and privacy
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
