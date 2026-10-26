import { batchDTO } from "@/lib/server/batch-dto";
import { requireMember } from "@/lib/server/groups";
import { badRequest, json, notFound, readJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { getBatch, submitBatchTx, verifyBatch } from "@/lib/server/settlements";
import { txSubmitSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const POST = route<{ bid: string; action: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  if (params.action === "submit") {
    const { txHash } = txSubmitSchema.parse(await readJson(req));
    return json(batchDTO(await submitBatchTx(params.bid, s.address, txHash)));
  }
  if (params.action === "verify") {
    const b = await getBatch(params.bid);
    if (!b) throw notFound("Batch not found");
    if (b.batch.payer !== s.address) await requireMember(b.batch.group_id, s.address);
    return json(batchDTO(await verifyBatch(params.bid)));
  }
  throw badRequest("Unknown action");
});
