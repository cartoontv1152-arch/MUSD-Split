"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { SignInGate } from "@/components/shell/gate";
import { GroupIcon, groupColorOptions, groupColorSwatch, groupIconOptions } from "@/components/group-icon";
import { Button } from "@/components/ui/button";
import { Field, Input, PageHeader, Panel, Textarea } from "@/components/ui/primitives";
import { errorMessage, post } from "@/lib/client/api";
import { cn } from "@/lib/client/cn";

export default function NewGroupPage() {
  return (
    <SignInGate title="Sign in to create a group">
      <NewGroup />
    </SignInGate>
  );
}

function NewGroup() {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("users");
  const [color, setColor] = useState("violet");
  const [membersCanInvite, setMembersCanInvite] = useState(true);
  const [simplifyDebts, setSimplifyDebts] = useState(true);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const { id } = await post<{ id: string }>("/api/groups", { name, description: description || null, icon, color, membersCanInvite, simplifyDebts });
      await qc.invalidateQueries({ queryKey: ["groups"] });
      toast.success("Group created", { description: "Invite people with a link next." });
      router.push(`/groups/${id}?tab=members&invite=1`);
    } catch (err) {
      toast.error("Couldn't create the group", { description: errorMessage(err) });
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Create a group" description="Name it after what you're sharing. You can invite members right after." />
      <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <Panel className="space-y-5 p-6">
          <Field label="Group name" htmlFor="name">
            <Input id="name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Goa trip, Flat 4B, Friday dinners…" autoFocus />
          </Field>
          <Field label="Description" htmlFor="desc" hint="Optional — what's this group for?">
            <Textarea id="desc" maxLength={280} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium">Icon</legend>
            <div className="flex flex-wrap gap-2">
              {groupIconOptions.map((i) => (
                <button
                  type="button"
                  key={i}
                  onClick={() => setIcon(i)}
                  aria-pressed={icon === i}
                  aria-label={`Icon ${i}`}
                  className={cn("rounded-[14px] p-0.5 ring-2", icon === i ? "ring-violet-400" : "ring-transparent")}
                >
                  <GroupIcon icon={i} color={color} size={40} />
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium">Colour</legend>
            <div className="flex gap-2">
              {groupColorOptions.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  aria-pressed={color === c}
                  aria-label={`Colour ${c}`}
                  className={cn("size-8 rounded-full ring-2 ring-offset-2 ring-offset-ink-850", color === c ? "ring-fg" : "ring-transparent")}
                  style={{ background: groupColorSwatch[c] }}
                />
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-3">
            <legend className="mb-1 text-[13px] font-medium">Invite settings</legend>
            <label className="flex items-start gap-3 text-[14px]">
              <input type="checkbox" checked={membersCanInvite} onChange={(e) => setMembersCanInvite(e.target.checked)} className="mt-1 size-4 accent-violet-500" />
              <span>
                Any member can invite people
                <span className="block text-[12.5px] text-fg-subtle">Otherwise only admins can create invite links.</span>
              </span>
            </label>
            <label className="flex items-start gap-3 text-[14px]">
              <input type="checkbox" checked={simplifyDebts} onChange={(e) => setSimplifyDebts(e.target.checked)} className="mt-1 size-4 accent-violet-500" />
              <span>
                Simplify debts
                <span className="block text-[12.5px] text-fg-subtle">Suggest the fewest payments that settle everyone. You can change this later.</span>
              </span>
            </label>
          </fieldset>
        </Panel>
        <div className="space-y-4">
          <Panel raised className="p-5">
            <div className="text-[12.5px] text-fg-subtle">Preview</div>
            <div className="mt-3 flex items-center gap-3">
              <GroupIcon icon={icon} color={color} size={48} />
              <div className="min-w-0">
                <div className="truncate font-display text-[18px] font-semibold">{name || "Your group"}</div>
                <div className="truncate text-[13px] text-fg-muted">{description || "1 member · you"}</div>
              </div>
            </div>
          </Panel>
          <Button type="submit" size="lg" className="w-full" loading={saving} disabled={!name.trim()}>
            Create group
          </Button>
        </div>
      </form>
    </>
  );
}
