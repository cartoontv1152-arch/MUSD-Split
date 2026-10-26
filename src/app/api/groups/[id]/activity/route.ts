import { activityDTO, groupActivity } from "@/lib/server/bundles";
import { requireMember } from "@/lib/server/groups";
import { json, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { getProfiles } from "@/lib/server/users";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  await requireMember(params.id, s.address);
  const before = req.nextUrl.searchParams.get("before");
  const rows = await groupActivity(params.id, before && /^\d+$/.test(before) ? before : null, 50);
  const profiles = await getProfiles(
    rows.flatMap((r) => [r.actor, r.data.from, r.data.to, r.data.payer].filter((x): x is string => typeof x === "string")),
  );
  return json({ activity: rows.map(activityDTO), profiles, nextBefore: rows.length === 50 ? String(rows[rows.length - 1].id) : null });
});
