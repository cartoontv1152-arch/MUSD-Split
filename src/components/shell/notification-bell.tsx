"use client";

import { Popover } from "radix-ui";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { post } from "@/lib/client/api";
import { useNotifications } from "@/lib/client/hooks";
import { cn, relativeTime } from "@/lib/client/cn";

export function NotificationBell() {
  const { data } = useNotifications();
  const qc = useQueryClient();
  const unread = data?.unread ?? 0;
  const markAll = async () => {
    await post("/api/notifications", { all: true }).catch(() => undefined);
    void qc.invalidateQueries({ queryKey: ["notifications"] });
  };
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          className="relative grid size-9 place-items-center rounded-[10px] text-fg-muted hover:bg-ink-800 hover:text-fg"
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <Bell className="size-[18px]" />
          {unread > 0 && (
            <span className="num absolute -top-0.5 -right-0.5 min-w-[18px] rounded-full bg-violet-500 px-1 text-center text-[10.5px] leading-[18px] font-semibold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="surface-raised z-50 w-[360px] max-w-[calc(100vw-24px)] rounded-[14px]">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="font-display text-[15px] font-semibold">Notifications</span>
            {unread > 0 && (
              <button onClick={markAll} className="text-[12.5px] text-violet-300 hover:underline">
                Mark all as read
              </button>
            )}
          </div>
          <ul className="max-h-[380px] overflow-y-auto py-1">
            {(data?.notifications ?? []).slice(0, 12).map((n) => (
              <li key={n.id}>
                <Popover.Close asChild>
                  <Link
                    href={n.href ?? "/notifications"}
                    onClick={() => !n.readAt && post("/api/notifications", { ids: [n.id] }).then(() => qc.invalidateQueries({ queryKey: ["notifications"] }))}
                    className="flex gap-3 px-4 py-2.5 hover:bg-ink-750"
                  >
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-violet-400")} />
                    <span className="min-w-0">
                      <span className="block text-[13.5px] leading-snug text-fg">{n.title}</span>
                      {n.body && <span className="mt-0.5 block truncate text-[12.5px] text-fg-muted">{n.body}</span>}
                      <span className="mt-0.5 block text-[11.5px] text-fg-subtle">
                        {n.groupName ? `${n.groupName} · ` : ""}
                        {relativeTime(n.createdAt)}
                      </span>
                    </span>
                  </Link>
                </Popover.Close>
              </li>
            ))}
            {(data?.notifications.length ?? 0) === 0 && <li className="px-4 py-8 text-center text-[13.5px] text-fg-muted">Nothing yet. Activity in your groups shows up here.</li>}
          </ul>
          <div className="border-t border-line px-4 py-2.5 text-right">
            <Popover.Close asChild>
              <Link href="/notifications" className="text-[12.5px] text-violet-300 hover:underline">
                Open notification centre
              </Link>
            </Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
