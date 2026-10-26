"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { GroupIcon } from "@/components/group-icon";
import { Avatar, displayName } from "@/components/identity";
import { Button } from "@/components/ui/button";
import { Panel, Skeleton } from "@/components/ui/primitives";
import { useSession } from "@/components/providers/session";
import { api, errorMessage, post } from "@/lib/client/api";
import { relativeTime } from "@/lib/client/cn";
import type { Profile } from "@/lib/client/types";

interface Preview {
  group: { id: string; name: string; description: string | null; icon: string; color: string; memberCount: number };
  invitedBy: Profile;
  expiresAt: string | null;
  state: "active" | "revoked" | "expired" | "used_up";
}

export default function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { address, openConnect, signIn, signingIn } = useSession();
  const [joining, setJoining] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ["invite", token], queryFn: () => api<Preview>(`/api/invites/${token}`), retry: false });

  async function join() {
    setJoining(true);
    try {
      const r = await post<{ groupId: string; alreadyMember: boolean }>(`/api/invites/${token}/accept`);
      await qc.invalidateQueries();
      toast.success(r.alreadyMember ? "You're already in this group" : `Welcome to ${data?.group.name}`);
      router.push(`/groups/${r.groupId}`);
    } catch (e) {
      toast.error("Couldn't join", { description: errorMessage(e) });
      setJoining(false);
    }
  }

  if (isLoading) return <Skeleton className="mx-auto mt-10 h-72 max-w-[520px]" />;
  if (error || !data) {
    return (
      <Panel className="mx-auto mt-10 max-w-[520px] p-8 text-center">
        <h1 className="font-display text-[22px] font-semibold">This invite link isn&apos;t valid</h1>
        <p className="mt-2 text-[14px] text-fg-muted">Check you copied the whole link, or ask a group member for a new one.</p>
      </Panel>
    );
  }
  const usable = data.state === "active";
  return (
    <Panel raised className="mx-auto mt-10 max-w-[520px] p-8 text-center">
      <div className="flex justify-center">
        <GroupIcon icon={data.group.icon} color={data.group.color} size={64} />
      </div>
      <p className="mt-5 flex items-center justify-center gap-2 text-[14px] text-fg-muted">
        <Avatar address={data.invitedBy.address} profile={data.invitedBy} size={22} /> {displayName(data.invitedBy.address, { [data.invitedBy.address]: data.invitedBy })} invited you to
      </p>
      <h1 className="mt-1 font-display text-[28px] font-semibold tracking-[-0.02em]">{data.group.name}</h1>
      {data.group.description && <p className="mt-2 text-[14.5px] text-fg-muted">{data.group.description}</p>}
      <p className="mt-2 text-[13px] text-fg-subtle">
        {data.group.memberCount} member{data.group.memberCount === 1 ? "" : "s"}
        {data.expiresAt && usable ? ` · link expires ${relativeTime(data.expiresAt)}` : ""}
      </p>
      <div className="mt-7">
        {!usable ? (
          <p className="text-[14px] text-amber-300">
            {data.state === "revoked" ? "This invite was revoked." : data.state === "expired" ? "This invite has expired." : "This invite has been used up."} Ask for a new link.
          </p>
        ) : !address ? (
          <div className="space-y-2">
            <Button size="lg" onClick={openConnect}>
              Connect wallet to join
            </Button>
            <p className="text-[12.5px] text-fg-subtle">Then sign a free message to prove the wallet is yours.</p>
            <button className="text-[12.5px] text-violet-300 hover:underline" onClick={() => signIn()} disabled={signingIn}>
              Already connected? Sign in
            </button>
          </div>
        ) : (
          <Button size="lg" loading={joining} onClick={join}>
            Join {data.group.name}
          </Button>
        )}
      </div>
    </Panel>
  );
}
