import { requireMember } from "@/lib/server/groups";
import { json, readJson, route } from "@/lib/server/http";
import { createRequest, getRequest, listRequestsForGroup, requestDTO } from "@/lib/server/requests";
import { requireSession } from "@/lib/server/session";
import { paymentRequestCreateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  await requireMember(params.id, s.address);
  return json({ requests: (await listRequestsForGroup(params.id)).map(requestDTO) });
});

export const POST = route<{ id: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  const input = paymentRequestCreateSchema.parse(await readJson(req));
  const id = await createRequest(params.id, s.address, input);
  return json({ request: requestDTO((await getRequest(id))!) }, { status: 201 });
});
