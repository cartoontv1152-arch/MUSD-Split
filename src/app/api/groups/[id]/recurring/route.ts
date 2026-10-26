import { requireMember } from "@/lib/server/groups";
import { json, readJson, route } from "@/lib/server/http";
import { createRecurring, listRecurring, recurringDTO } from "@/lib/server/recurring";
import { requireSession } from "@/lib/server/session";
import { recurringCreateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  await requireMember(params.id, s.address);
  return json({ recurring: (await listRecurring(params.id)).map(recurringDTO) });
});

export const POST = route<{ id: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  const input = recurringCreateSchema.parse(await readJson(req));
  const id = await createRecurring(params.id, s.address, input);
  return json({ id }, { status: 201 });
});
