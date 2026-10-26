import type { NextRequest } from "next/server";
import { LIMITS } from "@/config/app";
import { q } from "@/lib/server/db";
import { requireMember } from "@/lib/server/groups";
import { badRequest, json, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { readUpload } from "@/lib/server/uploads";

export const dynamic = "force-dynamic";

/** Upload a receipt (PNG/JPEG/WebP/PDF, max 2 MB). Stored in Postgres; served only to group members. */
export const POST = route<{ id: string }>(async (req: NextRequest, { params }) => {
  const s = await requireSession(req);
  await requireMember(params.id, s.address);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("Expected a file upload");
  }
  const f = await readUpload(form, "file", { maxBytes: LIMITS.receiptMaxBytes, allowed: LIMITS.receiptMime });
  const id = crypto.randomUUID();
  await q(
    `INSERT INTO split.receipts (id, group_id, uploader, mime, size, sha256, filename, data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, params.id, s.address, f.mime, f.size, f.sha256, f.name, Buffer.from(f.buf)],
  );
  return json({ receipt: { id, mime: f.mime, size: f.size, filename: f.name } }, { status: 201 });
});
