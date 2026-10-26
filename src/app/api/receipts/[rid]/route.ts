import { NextResponse } from "next/server";
import { q1 } from "@/lib/server/db";
import { requireMember } from "@/lib/server/groups";
import { notFound, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export const GET = route<{ rid: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  if (!/^[0-9a-f-]{36}$/i.test(params.rid)) throw notFound("Receipt not found");
  const meta = await q1<{ group_id: string }>(`SELECT group_id FROM split.receipts WHERE id = $1`, [params.rid]);
  if (!meta) throw notFound("Receipt not found");
  await requireMember(meta.group_id, s.address);
  const row = await q1<{ mime: string; data: Buffer; filename: string | null }>(
    `SELECT mime, data, filename FROM split.receipts WHERE id = $1`,
    [params.rid],
  );
  if (!row) throw notFound("Receipt not found");
  const download = req.nextUrl.searchParams.get("download") === "1";
  const safeName = (row.filename ?? "receipt").replace(/[^A-Za-z0-9._-]/g, "_");
  return new NextResponse(new Uint8Array(row.data), {
    headers: {
      "content-type": row.mime,
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"`,
    },
  });
});
