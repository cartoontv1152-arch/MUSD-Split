"use client";

import { useEffect } from "react";

export default function GlobalRouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="grid min-h-[70dvh] place-items-center px-6">
      <div className="max-w-[460px] text-center">
        <h1 className="font-display text-[30px] font-semibold tracking-[-0.02em]">Something broke on this page</h1>
        <p className="mt-3 text-[15px] text-fg-muted">
          Your funds and records are safe — nothing is changed by a page error. Try again, or reload the page.
          {error.digest ? ` (ref ${error.digest})` : ""}
        </p>
        <button onClick={reset} className="mt-6 rounded-[10px] bg-violet-600 px-4 py-2.5 text-[14px] font-medium text-white hover:bg-violet-500">Try again</button>
      </div>
    </main>
  );
}
