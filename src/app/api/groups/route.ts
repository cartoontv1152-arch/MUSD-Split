import { myGroups } from "@/lib/server/bundles";
import { q, withTx } from "@/lib/server/db";
import { recordActivity } from "@/lib/server/events";
import { json, readJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { ensureUser } from "@/lib/server/users";
import { groupCreateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const s = await requireSession(req);
  const groups = (await myGroups(s.address)).map(({ _loaded, ...g }) => {
    void _loaded;
    return g;
  });
  return json({ groups });
});

export const POST = route(async (req) => {
  const s = await requireSession(req);
  const input = groupCreateSchema.parse(await readJson(req));
  await ensureUser(s.address);
  const id = crypto.randomUUID();
  await withTx(async (c) => {
    await q(
      `INSERT INTO split.groups (id, name, description, icon, color, created_by, members_can_invite, simplify_debts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, input.name, input.description || null, input.icon, input.color, s.address, input.membersCanInvite, input.simplifyDebts],
      c,
    );
    await q(`INSERT INTO split.group_members (group_id, address, role) VALUES ($1, $2, 'owner')`, [id, s.address], c);
    await recordActivity(c, id, s.address, "group_created", { name: input.name });
  });
  return json({ id }, { status: 201 });
});
