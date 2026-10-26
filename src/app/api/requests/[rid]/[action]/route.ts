import { badRequest, json, route } from "@/lib/server/http";
import { closeRequest } from "@/lib/server/requests";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export const POST = route<{ rid: string; action: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  if (params.action !== "cancel" && params.action !== "decline") throw badRequest("Unknown action");
  const status = await closeRequest(params.rid, s.address, params.action);
  return json({ status });
});
