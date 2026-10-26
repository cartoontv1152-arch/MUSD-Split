import { NextResponse } from "next/server";
import { categoryLabel } from "@/config/app";
import { explorerTxUrl } from "@/config/chains";
import { toCsv, type Cell } from "@/lib/csv";
import { toDecimalString } from "@/lib/engine";
import { listExpenses, loadLedger, requireMember } from "@/lib/server/groups";
import { route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/session";
import { getProfiles } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** CSV export: expenses (incl. deleted, flagged), per-member shares, and verified settlements. */
export const GET = route<{ id: string }>(async (req, { params }) => {
  const s = await requireSession(req);
  const { group } = await requireMember(params.id, s.address);
  const loaded = await loadLedger(group);
  const all = await listExpenses(group.id, { includeDeleted: true });
  const addrs = new Set<string>(loaded.members.map((m) => m.address));
  for (const e of all) for (const p of e.participants) addrs.add(p.address);
  const prof = await getProfiles([...addrs]);
  const label = (a: string) => `${prof[a]?.displayName ?? ""} (${a})`.trim();
  const num = (v: string | bigint) => ({ raw: toDecimalString(BigInt(v)) });

  const rows: Cell[][] = [["MUSD Split export", group.name, `generated ${new Date().toISOString()}`, "amounts in MUSD"], []];
  rows.push(["Expenses"]);
  rows.push(["date", "title", "category", "amount", "paid by", "split method", "participant", "share", "status", "expense id"]);
  for (const e of all) {
    const status = e.deleted_at ? "deleted" : (loaded.ledger.coverage.get(e.id)?.status ?? "open");
    for (const p of e.participants) {
      rows.push([e.expense_date, e.title, categoryLabel(e.category), num(e.amount), label(e.payer), e.split_method, label(p.address), num(p.share), status, e.id]);
    }
  }
  rows.push([]);
  rows.push(["Settlements (only confirmed ones count toward balances)"]);
  rows.push(["created", "from", "to", "amount", "method", "status", "tx hash", "block", "explorer"]);
  for (const st of loaded.settlements.filter((x) => x.status !== "cancelled")) {
    const hash = st.tx_hash ?? st.rejected_tx_hash;
    rows.push([
      st.created_at.toISOString(),
      label(st.from_address),
      label(st.to_address),
      num(st.amount),
      st.method,
      st.status,
      hash ?? "",
      st.block_number ?? "",
      hash ? explorerTxUrl(hash) : "",
    ]);
  }
  rows.push([]);
  rows.push(["Balances (positive = should receive, negative = owes)"]);
  rows.push(["member", "net"]);
  for (const [a, v] of loaded.ledger.nets) rows.push([label(a), num(v)]);

  const safe = group.name.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 40) || "group";
  return new NextResponse(toCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="musd-split-${safe}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
});
