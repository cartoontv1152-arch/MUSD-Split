import { json, route } from "@/lib/server/http";
import { listRequestsForUser, requestDTO } from "@/lib/server/requests";
import { requireSession } from "@/lib/server/session";
import { getProfiles } from "@/lib/server/users";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const s = await requireSession(req);
  const rows = (await listRequestsForUser(s.address)).map(requestDTO);
  const profiles = await getProfiles(rows.flatMap((r) => [r.requester, r.payer]));
  return json({
    received: rows.filter((r) => r.payer === s.address),
    sent: rows.filter((r) => r.requester === s.address),
    profiles,
  });
});
