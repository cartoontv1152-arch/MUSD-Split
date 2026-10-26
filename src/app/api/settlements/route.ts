import { q } from "@/lib/server/db";
import { SETTLEMENT_SELECT, settlementDTO, type SettlementRow } from "@/lib/server/groups";
import { json, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { getProfiles } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** Transaction history: every settlement I sent or received (status filter optional). */
export const GET = route(async (req) => {
  const s = await requireSession(req);
  const status = req.nextUrl.searchParams.get("status");
  const rows = await q<SettlementRow & { group_name: string }>(
    `${SETTLEMENT_SELECT.replace("FROM split.settlements s", ", g.name AS group_name FROM split.settlements s JOIN split.groups g ON g.id = s.group_id")}
     WHERE (s.from_address = $1 OR s.to_address = $1) AND s.status <> 'cancelled'
       AND ($2::text IS NULL OR s.status = $2)
     ORDER BY s.created_at DESC LIMIT 300`,
    [s.address, status],
  );
  const profiles = await getProfiles(rows.flatMap((r) => [r.from_address, r.to_address]));
  return json({ settlements: rows.map((r) => ({ ...settlementDTO(r), groupName: r.group_name })), profiles });
});
