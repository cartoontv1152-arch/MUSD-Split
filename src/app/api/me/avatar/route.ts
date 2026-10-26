import type { NextRequest } from "next/server";
import { LIMITS } from "@/config/app";
import { q, withTx } from "@/lib/server/db";
import { badRequest, json, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { readUpload } from "@/lib/server/uploads";
import { getMe } from "@/lib/server/users";

export const dynamic = "force-dynamic";

export const POST = route(async (req: NextRequest) => {
  const s = await requireSession(req);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("Expected a file upload");
  }
  const file = await readUpload(form, "file", { maxBytes: LIMITS.avatarMaxBytes, allowed: LIMITS.avatarMime });
  await withTx(async (c) => {
    await q(
      `INSERT INTO split.avatars (address, mime, size, data) VALUES ($1,$2,$3,$4)
       ON CONFLICT (address) DO UPDATE SET mime = EXCLUDED.mime, size = EXCLUDED.size, data = EXCLUDED.data, updated_at = now()`,
      [s.address, file.mime, file.size, Buffer.from(file.buf)],
      c,
    );
    await q(`UPDATE split.users SET avatar_updated_at = now(), updated_at = now() WHERE address = $1`, [s.address], c);
  });
  return json({ user: await getMe(s.address) });
});

export const DELETE = route(async (req: NextRequest) => {
  const s = await requireSession(req);
  await withTx(async (c) => {
    await q(`DELETE FROM split.avatars WHERE address = $1`, [s.address], c);
    await q(`UPDATE split.users SET avatar_updated_at = NULL WHERE address = $1`, [s.address], c);
  });
  return json({ user: await getMe(s.address) });
});
