import { isInFlight } from "@/lib/engine";
import { q, withTx } from "@/lib/server/db";
import { recordActivity } from "@/lib/server/events";
import { loadLedger, requireMember } from "@/lib/server/groups";
import { conflict, json, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  const { group, membership } = await requireMember(params.id, s.address);
  const loaded = await loadLedger(group);
  if ((loaded.ledger.nets.get(s.address) ?? 0n) !== 0n) {
    throw conflict("Settle up before leaving — you still have an open balance in this group.", "OPEN_BALANCE");
  }
  if (loaded.settlements.some((x) => isInFlight(x.status) && (x.from_address === s.address || x.to_address === s.address))) {
    throw conflict("A payment involving you is still being confirmed", "PAYMENT_IN_FLIGHT");
  }
  const active = loaded.members.filter((m) => m.status === "active");
  if (membership.role === "owner" && active.length > 1 && active.filter((m) => m.role === "owner").length === 1) {
    throw conflict("Make someone else an owner before you leave", "LAST_OWNER");
  }
  await withTx(async (c) => {
    await q(`UPDATE split.group_members SET status='left', left_at=now() WHERE group_id=$1 AND address=$2`, [params.id, s.address], c);
    await recordActivity(c, params.id, s.address, "member_left", {});
  });
  return json({ ok: true });
});
