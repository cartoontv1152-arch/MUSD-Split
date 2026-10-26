"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { getAddress } from "viem";
import { createSiweMessage } from "viem/siwe";
import { useAccount, useSignMessage } from "wagmi";
import { toast } from "sonner";
import { CHAIN_ID } from "@/config/chains";
import { api, errorMessage, isUserRejection, post } from "@/lib/client/api";
import type { Me } from "@/lib/client/types";
import { ConnectModal } from "@/components/wallet/connect-modal";

interface SessionValue {
  address: string | null;
  user: Me | null;
  loading: boolean;
  signingIn: boolean;
  /** wallet connected with an address different from the signed-in one */
  mismatch: boolean;
  signIn: (address?: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  /** opens the wallet picker; signs in afterwards */
  openConnect: () => void;
  refresh: () => void;
}

const Ctx = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession must be used inside <SessionProvider>");
  return v;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { address: walletAddress, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [signingIn, setSigningIn] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const inFlight = useRef(false);

  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => api<{ address: string | null; user: Me | null }>("/api/auth/session"),
    staleTime: 60_000,
  });

  const signIn = useCallback(
    async (addr?: string): Promise<boolean> => {
      const account = addr ?? walletAddress;
      if (!account) {
        setConnectOpen(true);
        return false;
      }
      if (inFlight.current) return false;
      inFlight.current = true;
      setSigningIn(true);
      try {
        const { nonce } = await api<{ nonce: string }>("/api/auth/nonce");
        const now = new Date();
        const message = createSiweMessage({
          domain: window.location.host,
          address: getAddress(account),
          statement: "Sign in to MUSD Split. This signature proves you own this wallet. It does not move funds or cost gas.",
          uri: window.location.origin,
          version: "1",
          chainId: CHAIN_ID,
          nonce,
          issuedAt: now,
          expirationTime: new Date(now.getTime() + 10 * 60_000),
        });
        const signature = await signMessageAsync({ message, account: getAddress(account) });
        await post("/api/auth/verify", { message, signature });
        await qc.invalidateQueries();
        toast.success("Signed in", { description: `${account.slice(0, 6)}…${account.slice(-4)}` });
        return true;
      } catch (e) {
        if (isUserRejection(e)) toast.message("Sign-in cancelled", { description: "No signature was made." });
        else toast.error("Couldn't sign in", { description: errorMessage(e) });
        return false;
      } finally {
        inFlight.current = false;
        setSigningIn(false);
      }
    },
    [walletAddress, signMessageAsync, qc],
  );

  const signOut = useCallback(async () => {
    await post("/api/auth/logout").catch(() => undefined);
    qc.clear();
    await qc.invalidateQueries({ queryKey: ["session"] });
  }, [qc]);

  const address = session.data?.address ?? null;
  const value = useMemo<SessionValue>(
    () => ({
      address,
      user: session.data?.user ?? null,
      loading: session.isLoading,
      signingIn,
      mismatch: !!address && isConnected && !!walletAddress && walletAddress.toLowerCase() !== address,
      signIn,
      signOut,
      openConnect: () => setConnectOpen(true),
      refresh: () => void session.refetch(),
    }),
    [address, session, signingIn, isConnected, walletAddress, signIn, signOut],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <ConnectModal
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onConnected={(acct) => {
          setConnectOpen(false);
          if (!address || address !== acct.toLowerCase()) void signIn(acct);
        }}
      />
    </Ctx.Provider>
  );
}
