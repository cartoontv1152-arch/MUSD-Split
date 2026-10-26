import { dashboardBundle } from "@/lib/server/bundles";
import { json, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const s = await requireSession(req);
  return json(await dashboardBundle(s.address));
});
