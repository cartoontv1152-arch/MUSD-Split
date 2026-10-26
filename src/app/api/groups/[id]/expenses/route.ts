import { createExpense } from "@/lib/server/expenses";
import { expenseDTO, loadLedger, requireMember } from "@/lib/server/groups";
import { json, readJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { expenseCreateSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Filters: member, category, from, to (YYYY-MM-DD), status (open|partial|settled). */
export const GET = route<{ id: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  const { group } = await requireMember(params.id, s.address);
  const loaded = await loadLedger(group);
  const sp = req.nextUrl.searchParams;
  const member = sp.get("member")?.toLowerCase();
  const category = sp.get("category");
  const from = sp.get("from");
  const to = sp.get("to");
  const status = sp.get("status");
  const items = loaded.expenses
    .map((e) => {
      const c = loaded.ledger.coverage.get(e.id);
      return { ...expenseDTO(e), status: c?.status ?? "open", outstanding: (c?.outstanding ?? 0n).toString() };
    })
    .filter((e) => !member || e.payer === member || e.participants.some((p) => p.address === member))
    .filter((e) => !category || e.category === category)
    .filter((e) => !from || e.date >= from)
    .filter((e) => !to || e.date <= to)
    .filter((e) => !status || e.status === status);
  return json({ expenses: items });
});

export const POST = route<{ id: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  const input = expenseCreateSchema.parse(await readJson(req));
  const res = await createExpense(params.id, s.address, input);
  return json(res, { status: res.duplicate ? 200 : 201 });
});
