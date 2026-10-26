"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HandCoins } from "lucide-react";
import { useState } from "react";
import { SignInGate } from "@/components/shell/gate";
import { RequestRow } from "@/components/group/people-tabs";
import { EmptyState, PageHeader, Panel, PanelHeader, Skeleton } from "@/components/ui/primitives";
import { useSession } from "@/components/providers/session";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/client/cn";
import type { PaymentRequest, Profiles } from "@/lib/client/types";

export default function RequestsPage() {
  return (
    <SignInGate title="Sign in to see payment requests">
      <Inner />
    </SignInGate>
  );
}

function Inner() {
  const { address } = useSession();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["requests"],
    queryFn: () => api<{ received: PaymentRequest[]; sent: PaymentRequest[]; profiles: Profiles }>("/api/requests"),
    refetchInterval: 20_000,
  });
  const [show, setShow] = useState<"pending" | "done">("pending");
  if (isLoading || !data) return <Skeleton className="h-96" />;
  const filt = (l: PaymentRequest[]) => l.filter((r) => (show === "pending" ? r.status === "pending" : r.status !== "pending"));
  const refresh = () => void qc.invalidateQueries({ queryKey: ["requests"] });
  const section = (title: string, list: PaymentRequest[], empty: string) => (
    <Panel>
      <PanelHeader title={title} description={`${list.length} ${show === "pending" ? "pending" : "completed or closed"}`} />
      {list.length === 0 ? (
        <EmptyState icon={<HandCoins className="size-5" />} title={empty} />
      ) : (
        <ul className="divide-y divide-line px-5 pb-3">
          {list.map((r) => (
            <RequestRow key={r.id} r={r} me={address!} profiles={data.profiles} onChanged={refresh} />
          ))}
        </ul>
      )}
    </Panel>
  );
  return (
    <>
      <PageHeader title="Payment requests" description="Requests are reminders. A request is only marked paid when a matching MUSD transfer is verified on-chain." />
      <div role="tablist" className="mb-5 inline-flex rounded-[10px] border border-line-strong bg-ink-900 p-0.5 text-[13.5px]">
        {(["pending", "done"] as const).map((v) => (
          <button key={v} role="tab" aria-selected={show === v} onClick={() => setShow(v)} className={cn("rounded-[8px] px-3.5 py-1.5", show === v ? "bg-ink-700 text-fg" : "text-fg-muted")}>
            {v === "pending" ? "Pending" : "Paid & closed"}
          </button>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {section("Requests to you", filt(data.received), show === "pending" ? "Nobody is waiting on you" : "No past requests")}
        {section("Requests you sent", filt(data.sent), show === "pending" ? "You haven't asked anyone to pay" : "No past requests")}
      </div>
    </>
  );
}
