"use client";

import { useQueryClient } from "@tanstack/react-query";
import { FileUp, Paperclip, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { EXPENSE_CATEGORIES } from "@/config/app";
import { Amount } from "@/components/money";
import { MemberName } from "@/components/identity";
import { Button } from "@/components/ui/button";
import { Callout, Field, Input, Panel, Select, Textarea } from "@/components/ui/primitives";
import { ApiClientError, errorMessage, patch, post } from "@/lib/client/api";
import { cn } from "@/lib/client/cn";
import { computeSharesFromBody, storedToBody } from "@/lib/split-input";
import type { SplitBody } from "@/lib/validation";
import type { Expense, GroupBundle } from "@/lib/client/types";
import { formatBps } from "@/lib/engine/money";

type Method = SplitBody["method"];
const METHODS: Array<[Method, string, string]> = [
  ["equal", "Equally", "Everyone selected pays the same"],
  ["custom", "Exact amounts", "Type each person's share"],
  ["percentage", "Percentages", "Shares that add up to 100%"],
  ["shares", "Shares", "e.g. 2 shares vs 1 share"],
];

const today = () => new Date().toISOString().slice(0, 10);

export function ExpenseForm({ b, initial, mode }: { b: GroupBundle; initial?: Expense; mode: "create" | "edit" | "recurring" }) {
  const router = useRouter();
  const qc = useQueryClient();
  const active = b.members.filter((m) => m.status === "active").map((m) => m.address);
  const pool = useMemo(() => {
    const s = new Set(active);
    initial?.participants.forEach((p) => s.add(p.address));
    if (initial) s.add(initial.payer);
    return [...s];
  }, [active, initial]);

  const init = initial ? storedToBody(initial.splitInput) : null;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [amount, setAmount] = useState(initial ? (Number(BigInt(initial.amount) / 10n ** 16n) / 100).toFixed(2) : "");
  const [date, setDate] = useState(initial?.date ?? today());
  const [category, setCategory] = useState(initial?.category ?? "food");
  const [payer, setPayer] = useState(initial?.payer ?? b.me.address);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [method, setMethod] = useState<Method>(init?.method ?? "equal");
  const [selected, setSelected] = useState<string[]>(initial ? initial.participants.map((p) => p.address) : active);
  const [custom, setCustom] = useState<Record<string, string>>(init?.method === "custom" ? init.amounts : {});
  const [pct, setPct] = useState<Record<string, string>>(init?.method === "percentage" ? init.percentages : {});
  const [weights, setWeights] = useState<Record<string, string>>(init?.method === "shares" ? Object.fromEntries(Object.entries(init.shares).map(([k, v]) => [k, String(v)])) : {});
  const [receipt, setReceipt] = useState<{ id: string; name: string } | null>(initial?.receiptId ? { id: initial.receiptId, name: "Attached receipt" } : null);
  const [uploading, setUploading] = useState(false);
  const [reason, setReason] = useState("");
  const [needReason, setNeedReason] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cadence, setCadence] = useState<"monthly" | "weekly">("monthly");
  const [interval, setIntervalCount] = useState("1");
  const [endOn, setEndOn] = useState("");
  const [remind, setRemind] = useState("2");
  const [reqId] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `req-${Math.random().toString(36).slice(2)}`));

  const split: SplitBody = useMemo(() => {
    switch (method) {
      case "equal":
        return { method, participants: selected };
      case "custom":
        return { method, amounts: Object.fromEntries(selected.map((a) => [a, custom[a] ?? ""])) };
      case "percentage":
        return { method, percentages: Object.fromEntries(selected.map((a) => [a, pct[a] ?? ""])) };
      case "shares":
        return { method, shares: Object.fromEntries(selected.map((a) => [a, Number(weights[a] ?? "1") || 0])) };
    }
  }, [method, selected, custom, pct, weights]);

  const preview = useMemo(() => {
    if (!amount || selected.length === 0) return { shares: null, error: selected.length === 0 ? "Select at least one participant" : null };
    try {
      return { shares: computeSharesFromBody(amount, split, payer), error: null };
    } catch (e) {
      return { shares: null, error: (e as Error).message };
    }
  }, [amount, split, payer, selected.length]);

  const pctTotal = method === "percentage" ? selected.reduce((a, s) => a + (Number(pct[s]) || 0) * 100, 0) : 0;
  const customTotal =
    method === "custom"
      ? selected.reduce((a, s) => {
          const v = custom[s];
          if (!v || !/^\d+(\.\d{1,2})?$/.test(v)) return a;
          const [w, f = ""] = v.split(".");
          return a + BigInt(w) * 10n ** 18n + BigInt((f + "00").slice(0, 2)) * 10n ** 16n;
        }, 0n)
      : 0n;

  function toggle(a: string) {
    setSelected((s) => (s.includes(a) ? s.filter((x) => x !== a) : [...s, a]));
  }

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/groups/${b.group.id}/receipts`, { method: "POST", body: fd, credentials: "same-origin" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error?.message ?? "Upload failed");
      setReceipt({ id: j.receipt.id, name: file.name });
      toast.success("Receipt attached");
    } catch (e) {
      toast.error("Couldn't upload receipt", { description: (e as Error).message });
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!preview.shares) {
      toast.error(preview.error ?? "Check the split");
      return;
    }
    setSaving(true);
    const base = { title, amount, payer, category, split };
    try {
      if (mode === "recurring") {
        await post(`/api/groups/${b.group.id}/recurring`, {
          ...base,
          cadence,
          intervalCount: Number(interval) || 1,
          startOn: date,
          endOn: endOn || null,
          remindDaysBefore: Number(remind),
        });
        toast.success("Recurring bill scheduled", { description: "Members will be reminded before each run." });
        await qc.invalidateQueries({ queryKey: ["group", b.group.id] });
        router.push(`/groups/${b.group.id}?tab=recurring`);
        return;
      }
      const body = { ...base, date, notes: notes || null, receiptId: receipt?.id ?? null };
      if (mode === "create") {
        const r = await post<{ id: string }>(`/api/groups/${b.group.id}/expenses`, { ...body, clientRequestId: reqId });
        toast.success("Expense added", { description: "Balances updated for everyone in the group." });
        await qc.invalidateQueries({ queryKey: ["group", b.group.id] });
        router.push(`/groups/${b.group.id}/expenses/${r.id}`);
      } else {
        const r = await patch<{ adjustment: boolean }>(`/api/groups/${b.group.id}/expenses/${initial!.id}`, {
          ...body,
          expectedVersion: initial!.version,
          reason: reason || null,
        });
        toast.success(r.adjustment ? "Adjustment recorded" : "Expense updated");
        await qc.invalidateQueries();
        router.push(`/groups/${b.group.id}/expenses/${initial!.id}`);
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "REASON_REQUIRED") {
        setNeedReason(true);
        toast.message("Add a reason for this adjustment", { description: err.message });
      } else toast.error("Couldn't save", { description: errorMessage(err) });
      setSaving(false);
    }
  }

  const ownerOf = (a: string) => <MemberName address={a} profiles={b.profiles} me={b.me.address} withAvatar size={24} className="text-[14px]" />;

  return (
    <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        <Panel className="grid gap-4 p-6 sm:grid-cols-2">
          <Field label="What was it for?" htmlFor="ex-title" className="sm:col-span-2">
            <Input id="ex-title" required maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Dinner at Thalassa" autoFocus={mode !== "edit"} />
          </Field>
          <Field label="Total amount (MUSD)" htmlFor="ex-amt" hint="Up to 2 decimals. Settled in MUSD on Mezo.">
            <Input
              id="ex-amt"
              required
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="0.00"
              className="num text-[16px]"
            />
          </Field>
          <Field label={mode === "recurring" ? "First run on" : "Date"} htmlFor="ex-date">
            <Input id="ex-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Paid by" htmlFor="ex-payer">
            <select
              id="ex-payer"
              value={payer}
              onChange={(e) => setPayer(e.target.value)}
              className="h-10 w-full rounded-[var(--radius-control)] border border-line-strong bg-ink-950/60 px-3 text-[14px]"
            >
              {pool.map((a) => (
                <option key={a} value={a}>
                  {a === b.me.address ? "You" : b.profiles[a]?.displayName || a}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Category" htmlFor="ex-cat">
            <Select id="ex-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          {mode !== "recurring" && (
            <>
              <Field label="Notes" htmlFor="ex-notes" className="sm:col-span-2" hint="Optional">
                <Textarea id="ex-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <div className="mb-1.5 text-[13px] font-medium">Receipt</div>
                {receipt ? (
                  <div className="flex items-center gap-2 rounded-[10px] border border-line-strong bg-ink-900/60 px-3 py-2 text-[13.5px]">
                    <Paperclip className="size-4 text-violet-300" />
                    <a href={`/api/receipts/${receipt.id}`} target="_blank" rel="noreferrer" className="flex-1 truncate hover:underline">
                      {receipt.name}
                    </a>
                    <button type="button" onClick={() => setReceipt(null)} aria-label="Remove receipt" className="rounded p-1 text-fg-subtle hover:text-fg">
                      <X className="size-4" />
                    </button>
                  </div>
                ) : (
                  <label className="flex cursor-pointer items-center gap-3 rounded-[10px] border border-dashed border-line-strong px-4 py-3 text-[13.5px] text-fg-muted hover:border-violet-500/50">
                    <FileUp className="size-4 text-violet-300" />
                    {uploading ? "Uploading…" : "Attach a photo or PDF (max 2 MB) — only group members can see it"}
                    <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="sr-only" disabled={uploading} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                  </label>
                )}
              </div>
            </>
          )}
          {mode === "recurring" && (
            <>
              <Field label="Repeats" htmlFor="rc-cad">
                <Select id="rc-cad" value={cadence} onChange={(e) => setCadence(e.target.value as "weekly" | "monthly")}>
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                </Select>
              </Field>
              <Field label="Every" htmlFor="rc-int" hint={cadence === "monthly" ? "months" : "weeks"}>
                <Input id="rc-int" inputMode="numeric" value={interval} onChange={(e) => setIntervalCount(e.target.value.replace(/\D/g, ""))} />
              </Field>
              <Field label="Ends on" htmlFor="rc-end" hint="Optional">
                <Input id="rc-end" type="date" value={endOn} onChange={(e) => setEndOn(e.target.value)} />
              </Field>
              <Field label="Remind members" htmlFor="rc-rem">
                <Select id="rc-rem" value={remind} onChange={(e) => setRemind(e.target.value)}>
                  <option value="0">On the day</option>
                  <option value="1">1 day before</option>
                  <option value="2">2 days before</option>
                  <option value="7">A week before</option>
                </Select>
              </Field>
            </>
          )}
        </Panel>

        <Panel className="p-6">
          <div className="mb-3 text-[13px] font-medium">Split</div>
          <div role="radiogroup" aria-label="Split method" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {METHODS.map(([m, label, hint]) => (
              <button
                type="button"
                role="radio"
                aria-checked={method === m}
                key={m}
                onClick={() => setMethod(m)}
                className={cn(
                  "rounded-[12px] border px-3 py-2.5 text-left transition-colors",
                  method === m ? "border-violet-500 bg-violet-500/10" : "border-line-strong bg-ink-900/40 hover:border-[#3a4677]",
                )}
              >
                <div className="text-[14px] font-medium">{label}</div>
                <div className="text-[12px] text-fg-subtle">{hint}</div>
              </button>
            ))}
          </div>
          <div className="mt-5 mb-2 flex items-center justify-between text-[13px]">
            <span className="font-medium">Who took part</span>
            <span className="flex gap-3 text-fg-subtle">
              <button type="button" className="hover:text-fg" onClick={() => setSelected(pool)}>
                Everyone
              </button>
              <button type="button" className="hover:text-fg" onClick={() => setSelected([])}>
                Nobody
              </button>
            </span>
          </div>
          <ul className="divide-y divide-line rounded-[12px] border border-line-strong">
            {pool.map((a) => {
              const on = selected.includes(a);
              return (
                <li key={a} className="flex items-center gap-3 px-3 py-2.5">
                  <input type="checkbox" checked={on} onChange={() => toggle(a)} className="size-4 accent-violet-500" aria-label={`Include ${b.profiles[a]?.displayName ?? a}`} />
                  <div className={cn("min-w-0 flex-1", !on && "opacity-50")}>{ownerOf(a)}</div>
                  {on && method === "custom" && (
                    <Input
                      aria-label="Share amount"
                      inputMode="decimal"
                      value={custom[a] ?? ""}
                      onChange={(e) => setCustom({ ...custom, [a]: e.target.value.replace(/[^\d.]/g, "") })}
                      placeholder="0.00"
                      className="num h-9 w-28 text-right"
                    />
                  )}
                  {on && method === "percentage" && (
                    <div className="flex items-center gap-1">
                      <Input aria-label="Percentage" inputMode="decimal" value={pct[a] ?? ""} onChange={(e) => setPct({ ...pct, [a]: e.target.value.replace(/[^\d.]/g, "") })} placeholder="0" className="num h-9 w-20 text-right" />
                      <span className="text-fg-subtle">%</span>
                    </div>
                  )}
                  {on && method === "shares" && (
                    <div className="flex items-center gap-1">
                      <Input aria-label="Shares" inputMode="numeric" value={weights[a] ?? "1"} onChange={(e) => setWeights({ ...weights, [a]: e.target.value.replace(/\D/g, "") })} className="num h-9 w-16 text-right" />
                      <span className="text-[12px] text-fg-subtle">shares</span>
                    </div>
                  )}
                  {!on && <span className="text-[12px] text-fg-subtle">Not charged</span>}
                </li>
              );
            })}
          </ul>
          {method === "percentage" && (
            <p className={cn("mt-2 text-[12.5px]", pctTotal === 10000 ? "text-mint-400" : "text-amber-300")}>Total {formatBps(Math.round(pctTotal))}% of 100%</p>
          )}
          {method === "custom" && amount && (
            <p className="mt-2 text-[12.5px] text-fg-muted">
              Entered <Amount value={customTotal} /> of {amount} MUSD
            </p>
          )}
        </Panel>
      </div>

      <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <Panel raised className="p-5">
          <h2 className="font-display text-[16px] font-semibold">Breakdown</h2>
          <p className="mb-3 text-[12.5px] text-fg-subtle">Computed with the same engine the server uses. Leftover cents go to the payer first.</p>
          {preview.shares ? (
            <ul className="space-y-2">
              {preview.shares.map((s) => (
                <li key={s.member} className="flex items-center justify-between gap-2 text-[13.5px]">
                  <MemberName address={s.member} profiles={b.profiles} me={b.me.address} withAvatar size={20} />
                  <span className="text-right">
                    <Amount value={s.share} />
                    <span className="block text-[11.5px] text-fg-subtle">{s.member === payer ? "paid — keeps own share" : <>owes {ownerName(payer, b)}</>}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13.5px] text-fg-muted">{preview.error ?? "Enter an amount to see each person's share."}</p>
          )}
          {preview.shares && (
            <div className="mt-4 border-t border-line pt-3 text-[13px] text-fg-muted">
              {ownerName(payer, b)} {payer === b.me.address ? "are" : "is"} owed{" "}
              <Amount className="text-cyan-300" value={preview.shares.filter((s) => s.member !== payer).reduce((a, s) => a + s.share, 0n)} />
            </div>
          )}
        </Panel>
        {mode === "edit" && (needReason || initial?.status !== "open") && (
          <Panel className="p-5">
            <Field label="Reason for change" htmlFor="ex-reason" hint="This expense was already (partly) settled. Your change is recorded as an auditable adjustment; past payments are never rewritten.">
              <Textarea id="ex-reason" value={reason} maxLength={280} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </Panel>
        )}
        {mode === "recurring" && (
          <Callout tone="violet" title="No automatic payments">
            Each run only adds an expense record. Nobody&apos;s MUSD moves unless they approve a payment in their wallet.
          </Callout>
        )}
        <Button type="submit" size="lg" className="w-full" loading={saving} disabled={!preview.shares || !title.trim()}>
          {mode === "create" ? "Add expense" : mode === "edit" ? "Save changes" : "Schedule bill"}
        </Button>
      </div>
    </form>
  );
}

function ownerName(a: string, b: GroupBundle) {
  return a === b.me.address ? "You" : b.profiles[a]?.displayName || `${a.slice(0, 6)}…${a.slice(-4)}`;
}
