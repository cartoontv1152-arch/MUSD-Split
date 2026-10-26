import { z } from "zod";
import { isInFlight } from "@/lib/engine";
import { q, withTx } from "@/lib/server/db";
import { recordActivity } from "@/lib/server/events";
import { getMembership, loadLedger, requireAdmin } from "@/lib/server/groups";
import { badRequest, conflict, forbidden, json, notFound, readJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const roleBody = z.object({ role: z.enum(["owner", "admin", "member"]) });

export const PATCH = route<{ id: string; address: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  const { membership } = await requireAdmin(params.id, s.address);
  const target = params.address.toLowerCase();
  const { role } = roleBody.parse(await readJson(req));
  const m = await getMembership(params.id, target);
  if (!m || m.status !== "active") throw notFound("Member not found");
  if ((role === "owner" || m.role === "owner") && membership.role !== "owner") throw forbidden("Only an owner can change ownership");
  if (m.role === "owner" && role !== "owner") {
    const owners = await q<{ n: string }>(
      `SELECT count(*)::text AS n FROM split.group_members WHERE group_id=$1 AND role='owner' AND status='active'`,
      [params.id],
    );
    if (Number(owners[0]?.n ?? 0) <= 1) throw conflict("A group needs at least one owner", "LAST_OWNER");
  }
  await withTx(async (c) => {
    await q(`UPDATE split.group_members SET role=$3 WHERE group_id=$1 AND address=$2`, [params.id, target, role], c);
    await recordActivity(c, params.id, s.address, "group_updated", { member: target, role });
  });
  return json({ ok: true });
});

/** Remove a member (admins). Only allowed when the member is fully settled up. */
export const DELETE = route<{ id: string; address: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  const { group, membership } = await requireAdmin(params.id, s.address);
  const target = params.address.toLowerCase();
  if (target === s.address) throw badRequest("Use “Leave group” to remove yourself");
  const m = await getMembership(params.id, target);
  if (!m || m.status !== "active") throw notFound("Member not found");
  if (m.role === "owner" && membership.role !== "owner") throw forbidden("Only an owner can remove another owner");
  const loaded = await loadLedger(group);
  if ((loaded.ledger.nets.get(target) ?? 0n) !== 0n) {
    throw conflict("This member still has an open balance. Settle up before removing them.", "OPEN_BALANCE");
  }
  if (loaded.settlements.some((x) => isInFlight(x.status) && (x.from_address === target || x.to_address === target))) {
    throw conflict("A payment involving this member is still being confirmed", "PAYMENT_IN_FLIGHT");
  }
  await withTx(async (c) => {
    await q(`UPDATE split.group_members SET status='removed', left_at=now() WHERE group_id=$1 AND address=$2`, [params.id, target], c);
    await recordActivity(c, params.id, s.address, "member_removed", { member: target });
  });
  return json({ ok: true });
});
