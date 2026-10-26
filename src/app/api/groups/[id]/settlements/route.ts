import { listSettlements, requireMember, settlementDTO } from "@/lib/server/groups";
import { json, readJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { createSettlementIntent } from "@/lib/server/settlements";
import { settlementCreateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  await requireMember(params.id, s.address);
  return json({ settlements: (await listSettlements(params.id)).map(settlementDTO) });
});

/** Step 1 of a payment: record the intent (no money moves). Returns the settlement id/key. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  const input = settlementCreateSchema.parse(await readJson(req));
  const row = await createSettlementIntent(params.id, s.address, input);
  return json({ settlement: settlementDTO(row) }, { status: 201 });
});
