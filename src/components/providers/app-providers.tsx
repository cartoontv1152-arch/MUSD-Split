"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { WagmiProvider, type State } from "wagmi";
import { wagmiConfig } from "@/lib/client/wagmi";
import { SessionProvider } from "./session";
import { ApiClientError } from "@/lib/client/api";

export function AppProviders({ children, initialState }: { children: ReactNode; initialState?: State }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: true,
            retry: (count, err) => !(err instanceof ApiClientError && err.status < 500) && count < 2,
          },
        },
      }),
  );
  return (
    <WagmiProvider config={wagmiConfig} initialState={initialState}>
      <QueryClientProvider client={qc}>
        <SessionProvider>{children}</SessionProvider>
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            classNames: {
              toast: "!bg-[#131a37] !border !border-[#2f3964] !text-[#eceeff] !rounded-[12px] !shadow-2xl",
              description: "!text-[#a6acd0]",
            },
          }}
        />
      </QueryClientProvider>
    </WagmiProvider>
  );
}
