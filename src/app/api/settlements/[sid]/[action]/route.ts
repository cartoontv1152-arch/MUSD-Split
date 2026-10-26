import { settlementDTO } from "@/lib/server/groups";
import { badRequest, forbidden, json, notFound, readJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { cancelSettlement, getSettlement, recoverSettlement, submitSettlementTx, verifySettlement } from "@/lib/server/settlements";
import { requireMember } from "@/lib/server/groups";
import { txSubmitSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * POST /api/settlements/:id/submit  {txHash}  — record the broadcast tx hash (before waiting), then verify
 * POST /api/settlements/:id/verify            — re-check the chain (anyone in the group can trigger)
 * POST /api/settlements/:id/cancel            — abandon an attempt that never sent a tx
 * POST /api/settlements/:id/recover           — scan the chain for a payment whose hash was lost
 */
export const POST = route<{ sid: string; action: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  switch (params.action) {
    case "submit": {
      const { txHash } = txSubmitSchema.parse(await readJson(req));
      return json({ settlement: settlementDTO(await submitSettlementTx(params.sid, s.address, txHash)) });
    }
    case "verify": {
      const row = await getSettlement(params.sid);
      if (!row) throw notFound("Payment not found");
      if (row.from_address !== s.address && row.to_address !== s.address) await requireMember(row.group_id, s.address);
      return json({ settlement: settlementDTO(await verifySettlement(params.sid)) });
    }
    case "cancel":
      return json({ settlement: settlementDTO(await cancelSettlement(params.sid, s.address)) });
    case "recover": {
      const row = await getSettlement(params.sid);
      if (!row) throw notFound("Payment not found");
      if (row.from_address !== s.address) throw forbidden("Only the payer can do this");
      return json({ settlement: settlementDTO(await recoverSettlement(params.sid, s.address)) });
    }
    default:
      throw badRequest("Unknown action");
  }
});
