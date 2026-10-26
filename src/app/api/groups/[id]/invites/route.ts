import { createInvite, inviteDTO, listInvites } from "@/lib/server/invites";
import { json, readJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { inviteCreateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  return json(await listInvites(params.id, s.address));
});

export const POST = route<{ id: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  const input = inviteCreateSchema.parse(await readJson(req));
  const row = await createInvite(params.id, s.address, input);
  return json({ invite: inviteDTO(row) }, { status: 201 });
});
