import { acceptInvite } from "@/lib/server/invites";
import { json, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export const POST = route<{ token: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  return json(await acceptInvite(params.token, s.address));
});
