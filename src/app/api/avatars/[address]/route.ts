import { NextResponse } from "next/server";
import { q1 } from "@/lib/server/db";
import { forbidden, notFound, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Profile images are visible to the owner and to people who share a group with them — not public. */
export const GET = route<{ address: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  const address = params.address.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) throw notFound();
  if (address !== s.address) {
    const shared = await q1(
      `SELECT 1 FROM split.group_members a JOIN split.group_members b ON a.group_id = b.group_id
       WHERE a.address = $1 AND b.address = $2 LIMIT 1`,
      [s.address, address],
    );
    if (!shared) throw forbidden();
  }
  const row = await q1<{ mime: string; data: Buffer }>(`SELECT mime, data FROM split.avatars WHERE address = $1`, [address]);
  if (!row) throw notFound();
  return new NextResponse(new Uint8Array(row.data), {
    headers: {
      "content-type": row.mime,
      "cache-control": "private, max-age=86400",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
});
