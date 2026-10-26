import { requireMember } from "@/lib/server/groups";
import { badRequest, json, readJson, route } from "@/lib/server/http";
import { runRecurring, setRecurringActive } from "@/lib/server/recurring";
import { requireSession } from "@/lib/server/session";
import { recurringUpdateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** PATCH {active} pauses/resumes a schedule. */
export const PATCH = route<{ id: string; rid: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  const { active } = recurringUpdateSchema.parse(await readJson(req));
  await setRecurringActive(params.id, params.rid, s.address, active);
  return json({ ok: true });
});

/** POST /api/groups/:id/recurring/run — "Check now": create any due expenses for this group. */
export const POST = route<{ id: string; rid: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  if (params.rid !== "run") throw badRequest("Unknown action");
  await requireMember(params.id, s.address);
  return json(await runRecurring({ groupId: params.id }));
});
