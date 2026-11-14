"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { readMezoPosition, type MezoPosition } from "./mezo";

/** Live Mezo position for a wallet: trove (BTC collateral → MUSD debt), protocol params, balances. */
export function useMezoPosition(address?: string | null) {
  return useQuery<MezoPosition>({
    queryKey: ["mezo-position", address?.toLowerCase()],
    queryFn: () => readMezoPosition(address!),
    enabled: !!address,
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 2,
  });
}

/** Refresh every on-chain read after a transaction lands. */
export function useRefreshChain() {
  const qc = useQueryClient();
  return () =>
    qc.invalidateQueries({
      predicate: (q) => {
        const k = String(q.queryKey[0] ?? "");
        return k === "mezo-position" || k.includes("balance") || k === "readContract" || k === "readContracts";
      },
    });
}

export const pct = (ratio: bigint | null, digits = 1) => (ratio === null ? "—" : `${(Number(ratio / 10n ** 12n) / 1e4).toFixed(digits)}%`);
export const btc = (v: bigint, digits = 6) => `${(Number(v / 10n ** 10n) / 1e8).toFixed(digits)} BTC`;
export const usd = (v: bigint) => `$${Math.round(Number(v / 10n ** 16n) / 100).toLocaleString("en-US")}`;
