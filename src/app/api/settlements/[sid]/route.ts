import { q } from "@/lib/server/db";
import { getGroup, requireMember, settlementDTO } from "@/lib/server/groups";
import { json, notFound, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { getSettlement } from "@/lib/server/settlements";
import { getProfiles } from "@/lib/server/users";

export const dynamic = "force-dynamic";

export const GET = route<{ sid: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  const row = await getSettlement(params.sid);
  if (!row) throw notFound("Payment not found");
  // members of the group may view; so may the two parties even if they've left
  if (row.from_address !== s.address && row.to_address !== s.address) await requireMember(row.group_id, s.address);
  const group = await getGroup(row.group_id);
  const events = await q<{ from_status: string | null; to_status: string; tx_hash: string | null; detail: string | null; created_at: Date }>(
    `SELECT from_status, to_status, tx_hash, detail, created_at FROM split.settlement_events WHERE settlement_id = $1 ORDER BY id`,
    [row.id],
  );
  const profiles = await getProfiles([row.from_address, row.to_address]);
  return json({
    settlement: settlementDTO(row),
    groupName: group?.name ?? null,
    events: events.map((e) => ({ ...e, created_at: e.created_at.toISOString() })),
    profiles,
  });
});
