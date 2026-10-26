"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import Link from "next/link";
import { SignInGate } from "@/components/shell/gate";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Panel, Skeleton } from "@/components/ui/primitives";
import { post } from "@/lib/client/api";
import { useNotifications } from "@/lib/client/hooks";
import { cn, formatDateTime, relativeTime } from "@/lib/client/cn";

export default function NotificationsPage() {
  return (
    <SignInGate>
      <Inner />
    </SignInGate>
  );
}

function Inner() {
  const { data, isLoading } = useNotifications();
  const qc = useQueryClient();
  const markAll = async () => {
    await post("/api/notifications", { all: true });
    void qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  return (
    <>
      <PageHeader
        title="Notifications"
        description="Based on real events in your groups: new expenses, requests, confirmed or failed payments and new members."
        actions={
          (data?.unread ?? 0) > 0 && (
            <Button variant="secondary" onClick={markAll}>
              Mark all as read
            </Button>
          )
        }
      />
      {isLoading ? (
        <Skeleton className="h-80" />
      ) : (data?.notifications.length ?? 0) === 0 ? (
        <Panel>
          <EmptyState icon={<Bell className="size-5" />} title="You're all caught up" />
        </Panel>
      ) : (
        <Panel>
          <ul className="divide-y divide-line">
            {data!.notifications.map((n) => (
              <li key={n.id}>
                <Link
                  href={n.href ?? "#"}
                  onClick={() => !n.readAt && post("/api/notifications", { ids: [n.id] }).then(() => qc.invalidateQueries({ queryKey: ["notifications"] }))}
                  className="flex gap-3 px-5 py-3.5 hover:bg-ink-800/50"
                >
                  <span className={cn("mt-2 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-violet-400")} aria-label={n.readAt ? undefined : "Unread"} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-[14.5px]", n.readAt ? "text-fg-muted" : "font-medium text-fg")}>{n.title}</span>
                    {n.body && <span className="mt-0.5 block text-[13px] text-fg-muted">{n.body}</span>}
                    <span className="mt-0.5 block text-[12px] text-fg-subtle" title={formatDateTime(n.createdAt)}>
                      {n.groupName ? `${n.groupName} · ` : ""}
                      {relativeTime(n.createdAt)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
