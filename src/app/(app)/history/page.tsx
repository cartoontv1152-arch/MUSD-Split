"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SignInGate } from "@/components/shell/gate";
import { Amount, SettlementStatusPill, methodLabel } from "@/components/money";
import { MemberName, TxLink } from "@/components/identity";
import { EmptyState, PageHeader, Panel, Select, Skeleton } from "@/components/ui/primitives";
import { useSession } from "@/components/providers/session";
import { api } from "@/lib/client/api";
import { formatDateTime } from "@/lib/client/cn";
import type { Profiles, Settlement } from "@/lib/client/types";

export default function HistoryPage() {
  return (
    <SignInGate title="Sign in to see your transactions">
      <Inner />
    </SignInGate>
  );
}

function Inner() {
  const { address: me } = useSession();
  const [status, setStatus] = useState("confirmed");
  const { data, isLoading } = useQuery({
    queryKey: ["history", status],
    queryFn: () => api<{ settlements: Settlement[]; profiles: Profiles }>(`/api/settlements${status ? `?status=${status}` : ""}`),
  });
  return (
    <>
      <PageHeader
        title="Transactions"
        description="Every MUSD settlement you sent or received, with its transaction hash and explorer link."
        actions={
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto">
            <option value="confirmed">Verified only</option>
            <option value="">All attempts</option>
            <option value="submitted">Pending</option>
            <option value="failed">Failed</option>
            <option value="rejected">Not accepted</option>
          </Select>
        }
      />
      {isLoading || !data ? (
        <Skeleton className="h-80" />
      ) : data.settlements.length === 0 ? (
        <Panel>
          <EmptyState icon={<ArrowLeftRight className="size-5" />} title="No transactions here">
            Settle a debt from any group and its verified receipt appears here.
          </EmptyState>
        </Panel>
      ) : (
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[12px] text-fg-subtle">
                <th className="px-5 py-3 font-medium">Payment</th>
                <th className="px-3 py-3 font-medium">Group</th>
                <th className="px-3 py-3 font-medium">Transaction</th>
                <th className="px-3 py-3 text-right font-medium">Amount</th>
                <th className="px-5 py-3 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.settlements.map((s) => {
                const out = s.from === me;
                return (
                  <tr key={s.id} className="hover:bg-ink-800/40">
                    <td className="px-5 py-3">
                      <Link href={`/settlements/${s.id}`} className="flex items-center gap-2">
                        {out ? <ArrowUpRight className="size-4 text-amber-300" /> : <ArrowDownLeft className="size-4 text-cyan-300" />}
                        <span>
                          {out ? "To " : "From "}
                          <MemberName address={out ? s.to : s.from} profiles={data.profiles} className="font-medium" />
                          <span className="block text-[12px] text-fg-subtle">
                            {formatDateTime(s.confirmedAt ?? s.createdAt)} · {methodLabel(s.method)}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-fg-muted">{s.groupName}</td>
                    <td className="px-3 py-3">{s.txHash || s.rejectedTxHash ? <TxLink hash={(s.txHash || s.rejectedTxHash)!} /> : <span className="text-fg-subtle">—</span>}</td>
                    <td className="px-3 py-3 text-right">
                      <Amount value={s.amount} tone={out ? "owe" : "owed"} />
                    </td>
                    <td className="px-5 py-3 text-right">
                      <SettlementStatusPill status={s.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
