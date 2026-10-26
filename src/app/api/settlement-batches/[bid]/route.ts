import { batchDTO } from "@/lib/server/batch-dto";
import { requireMember } from "@/lib/server/groups";
import { json, notFound, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { getBatch } from "@/lib/server/settlements";

export const dynamic = "force-dynamic";

export const GET = route<{ bid: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  const b = await getBatch(params.bid);
  if (!b) throw notFound("Batch not found");
  if (b.batch.payer !== s.address) await requireMember(b.batch.group_id, s.address);
  return json(batchDTO(b));
});
