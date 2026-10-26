import { z } from "zod";
import { q } from "@/lib/server/db";
import { json, readJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const s = await requireSession(req);
  const rows = await q<{
    id: string;
    group_id: string | null;
    type: string;
    title: string;
    body: string | null;
    href: string | null;
    data: Record<string, unknown>;
    created_at: Date;
    read_at: Date | null;
    group_name: string | null;
  }>(
    `SELECT n.*, g.name AS group_name FROM split.notifications n LEFT JOIN split.groups g ON g.id = n.group_id
     WHERE n.recipient = $1 ORDER BY n.id DESC LIMIT 60`,
    [s.address],
  );
  const unread = await q<{ n: string }>(
    `SELECT count(*)::text AS n FROM split.notifications WHERE recipient = $1 AND read_at IS NULL`,
    [s.address],
  );
  return json({
    unread: Number(unread[0]?.n ?? 0),
    notifications: rows.map((r) => ({
      id: String(r.id),
      groupId: r.group_id,
      groupName: r.group_name,
      type: r.type,
      title: r.title,
      body: r.body,
      href: r.href,
      data: r.data,
      createdAt: r.created_at.toISOString(),
      readAt: r.read_at?.toISOString() ?? null,
    })),
  });
});

const markBody = z.object({ ids: z.array(z.string().regex(/^\d+$/)).max(200).optional(), all: z.boolean().optional() });

export const POST = route(async (req) => {
  const s = await requireSession(req);
  const { ids, all } = markBody.parse(await readJson(req));
  if (all) {
    await q(`UPDATE split.notifications SET read_at = now() WHERE recipient = $1 AND read_at IS NULL`, [s.address]);
  } else if (ids?.length) {
    await q(`UPDATE split.notifications SET read_at = now() WHERE recipient = $1 AND id = ANY($2::bigint[]) AND read_at IS NULL`, [
      s.address,
      ids,
    ]);
  }
  return json({ ok: true });
});
