"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ExpenseForm } from "@/components/expense-form";
import { SignInGate } from "@/components/shell/gate";
import { PageHeader, Skeleton } from "@/components/ui/primitives";
import { useGroup } from "@/lib/client/hooks";

export default function NewExpensePage() {
  return (
    <SignInGate>
      <Suspense>
        <Inner />
      </Suspense>
    </SignInGate>
  );
}

function Inner() {
  const { id } = useParams<{ id: string }>();
  const recurring = useSearchParams().get("recurring") === "1";
  const { data: b, isLoading, error } = useGroup(id);
  if (isLoading) return <Skeleton className="h-96" />;
  if (error || !b) return <p className="text-rose-400">You need to be a member of this group to add expenses.</p>;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/groups/${id}`} className="hover:text-fg">
            ← {b.group.name}
          </Link>
        }
        title={recurring ? "Schedule a recurring bill" : "Add an expense"}
        description={recurring ? "Rent, internet, subscriptions — added to the ledger automatically on each date." : "Record what was spent, who paid and who took part."}
      />
      <ExpenseForm b={b} mode={recurring ? "recurring" : "create"} />
    </>
  );
}
