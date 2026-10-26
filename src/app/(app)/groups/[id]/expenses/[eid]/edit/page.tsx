"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ExpenseForm } from "@/components/expense-form";
import { SignInGate } from "@/components/shell/gate";
import { PageHeader, Skeleton } from "@/components/ui/primitives";
import { useGroup } from "@/lib/client/hooks";

export default function EditExpensePage() {
  return (
    <SignInGate>
      <Inner />
    </SignInGate>
  );
}

function Inner() {
  const { id, eid } = useParams<{ id: string; eid: string }>();
  const { data: b, isLoading } = useGroup(id);
  if (isLoading) return <Skeleton className="h-96" />;
  const e = b?.expenses.find((x) => x.id === eid);
  if (!b || !e) return <p className="text-fg-muted">This expense can&apos;t be edited (it may have been deleted).</p>;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/groups/${id}/expenses/${eid}`} className="hover:text-fg">
            ← {e.title}
          </Link>
        }
        title="Edit expense"
        description={e.status !== "open" ? "Part of this expense was already settled. Saving records an auditable adjustment." : "Balances are recalculated for everyone when you save."}
      />
      <ExpenseForm b={b} initial={e} mode="edit" />
    </>
  );
}
