import { json, route } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";
import { getMe } from "@/lib/server/users";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const s = await getSession(req);
  if (!s) return json({ address: null, user: null });
  const user = await getMe(s.address);
  if (!user) return json({ address: null, user: null });
  return json({ address: s.address, user });
});
