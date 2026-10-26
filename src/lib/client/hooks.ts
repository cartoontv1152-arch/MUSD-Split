"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { CHAIN_ID } from "@/config/chains";
import { MUSD, musdAbi } from "@/config/contracts";
import { api } from "./api";
import type { GroupBundle, Notification } from "./types";
import { useSession } from "@/components/providers/session";

export function useMusdBalance(address?: string | null) {
  return useReadContract({
    address: MUSD.address,
    abi: musdAbi,
    functionName: "balanceOf",
    args: address ? [address as `0x${string}`] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
}

export function useGasBalance(address?: string | null) {
  return useBalance({ address: address as `0x${string}` | undefined, chainId: CHAIN_ID, query: { enabled: !!address, refetchInterval: 20_000 } });
}

export function useWalletState() {
  const { address, isConnected, chainId, connector } = useAccount();
  return { address: address?.toLowerCase() ?? null, isConnected, chainId, onMezo: chainId === CHAIN_ID, connector };
}

export function useGroup(id: string | undefined, opts: { poll?: boolean } = {}) {
  const { address } = useSession();
  return useQuery({
    queryKey: ["group", id],
    queryFn: () => api<GroupBundle>(`/api/groups/${id}`),
    enabled: !!id && !!address,
    refetchInterval: opts.poll ? 8_000 : 30_000,
  });
}

export function useNotifications() {
  const { address } = useSession();
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ unread: number; notifications: Notification[] }>("/api/notifications"),
    enabled: !!address,
    refetchInterval: 20_000,
  });
}

export interface NetworkInfo {
  ok: boolean;
  chainId: number;
  blockNumber: string;
  blockTime: string;
  musdTotalSupply: string;
  gasPriceWei: string;
}

export function useNetwork() {
  return useQuery({
    queryKey: ["network"],
    queryFn: () => api<NetworkInfo>("/api/network"),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}
