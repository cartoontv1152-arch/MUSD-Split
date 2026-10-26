import { previewInvite } from "@/lib/server/invites";
import { json, route } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = route<{ token: string }>(async (_req, { params }) => {
  return json(await previewInvite(params.token));
});
