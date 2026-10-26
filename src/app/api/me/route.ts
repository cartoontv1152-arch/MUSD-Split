import { q } from "@/lib/server/db";
import { conflict, json, readJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { getMe } from "@/lib/server/users";
import { isUniqueViolation } from "@/lib/server/db";
import { profileUpdateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const s = await requireSession(req);
  return json({ user: await getMe(s.address) });
});

export const PATCH = route(async (req) => {
  const s = await requireSession(req);
  const input = profileUpdateSchema.parse(await readJson(req));
  try {
    await q(
      `UPDATE split.users SET
         display_name = CASE WHEN $2 THEN $3 ELSE display_name END,
         username     = CASE WHEN $4 THEN $5 ELSE username END,
         preferences  = CASE WHEN $6 THEN preferences || $7::jsonb ELSE preferences END,
         updated_at = now()
       WHERE address = $1`,
      [
        s.address,
        input.displayName !== undefined,
        input.displayName ?? null,
        input.username !== undefined,
        input.username ?? null,
        input.preferences !== undefined,
        JSON.stringify(input.preferences ?? {}),
      ],
    );
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("That username is taken", "USERNAME_TAKEN");
    throw e;
  }
  return json({ user: await getMe(s.address) });
});
