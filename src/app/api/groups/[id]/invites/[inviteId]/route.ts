import { inviteDTO, revokeInvite } from "@/lib/server/invites";
import { json, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export const DELETE = route<{ id: string; inviteId: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  const row = await revokeInvite(params.id, params.inviteId, s.address);
  return json({ invite: inviteDTO(row) });
});
