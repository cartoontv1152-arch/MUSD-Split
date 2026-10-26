import { groupBundle } from "@/lib/server/bundles";
import { q, withTx } from "@/lib/server/db";
import { recordActivity } from "@/lib/server/events";
import { requireAdmin } from "@/lib/server/groups";
import { json, readJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { groupUpdateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  return json(await groupBundle(params.id, s.address));
});

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  await requireAdmin(params.id, s.address);
  const input = groupUpdateSchema.parse(await readJson(req));
  await withTx(async (c) => {
    await q(
      `UPDATE split.groups SET
         name = COALESCE($2, name),
         description = CASE WHEN $3 THEN $4 ELSE description END,
         icon = COALESCE($5, icon), color = COALESCE($6, color),
         members_can_invite = COALESCE($7, members_can_invite),
         simplify_debts = COALESCE($8, simplify_debts),
         archived_at = CASE WHEN $9::boolean IS NULL THEN archived_at WHEN $9 THEN now() ELSE NULL END,
         updated_at = now()
       WHERE id = $1`,
      [
        params.id,
        input.name ?? null,
        input.description !== undefined,
        input.description || null,
        input.icon ?? null,
        input.color ?? null,
        input.membersCanInvite ?? null,
        input.simplifyDebts ?? null,
        input.archived ?? null,
      ],
      c,
    );
    await recordActivity(c, params.id, s.address, "group_updated", { changes: Object.keys(input) });
  });
  return json({ ok: true });
});
