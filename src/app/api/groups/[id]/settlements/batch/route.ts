import { json, readJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { createBatch } from "@/lib/server/settlements";
import { batchDTO } from "@/lib/server/batch-dto";
import { batchCreateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  const { method } = batchCreateSchema.parse(await readJson(req));
  const b = await createBatch(params.id, s.address, method);
  return json(batchDTO(b), { status: 201 });
});
