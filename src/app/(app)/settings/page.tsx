"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Coins, Network, Upload } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SignInGate } from "@/components/shell/gate";
import { useSession } from "@/components/providers/session";
import { useNetworkActions } from "@/components/wallet/wallet-menu";
import { AddressChip, Avatar } from "@/components/identity";
import { Amount } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Field, Input, PageHeader, Panel, PanelHeader, Select, StatRow } from "@/components/ui/primitives";
import { api, errorMessage, patch } from "@/lib/client/api";
import { useMusdBalance, useNetwork, useWalletState } from "@/lib/client/hooks";
import { MUSD, SETTLEMENT_CONTRACT } from "@/config/contracts";

export default function SettingsPage() {
  return (
    <SignInGate>
      <Inner />
    </SignInGate>
  );
}

function Inner() {
  const { user, address, refresh } = useSession();
  const qc = useQueryClient();
  const w = useWalletState();
  const net = useNetworkActions();
  const network = useNetwork();
  const bal = useMusdBalance(address);
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [method, setMethod] = useState(user?.preferences?.defaultSettlementMethod ?? "direct");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await patch("/api/me", { displayName: displayName.trim() || null, username: username.trim() || null, preferences: { defaultSettlementMethod: method } });
      toast.success("Profile saved");
      refresh();
      void qc.invalidateQueries();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function upload(f: File) {
    const fd = new FormData();
    fd.append("file", f);
    const res = await fetch("/api/me/avatar", { method: "POST", body: fd, credentials: "same-origin" });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      toast.error(j?.error?.message ?? "Upload failed");
      return;
    }
    toast.success("Profile picture updated");
    refresh();
    void qc.invalidateQueries();
  }

  return (
    <>
      <PageHeader title="Profile & settings" description="Your name and picture show up in your groups. Your wallet address stays the identity behind every payment." />
      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Panel>
          <PanelHeader title="Profile" />
          <div className="space-y-5 px-5 pb-6">
            <div className="flex items-center gap-4">
              <Avatar address={address!} profile={user} size={64} />
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[10px] border border-line-strong px-3 text-[13px] hover:bg-ink-800">
                  <Upload className="size-4" /> Upload picture
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                </label>
                {user?.avatarUrl && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await api("/api/me/avatar", { method: "DELETE" });
                      refresh();
                    }}
                  >
                    Use generated orb
                  </Button>
                )}
              </div>
            </div>
            <Field label="Display name" htmlFor="dn" hint="What your group sees, e.g. “Alice”.">
              <Input id="dn" maxLength={40} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </Field>
            <Field label="Username" htmlFor="un" hint="Optional. 3–20 characters: a–z, 0–9, _">
              <Input id="un" maxLength={20} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="alice" />
            </Field>
            <Field label="Preferred payment method" htmlFor="pm">
              <Select id="pm" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                <option value="direct">Direct MUSD transfer</option>
                <option value="contract_permit">Settlement contract (permit)</option>
                <option value="contract">Settlement contract (approve + settle)</option>
              </Select>
            </Field>
            <Button loading={saving} onClick={save}>
              Save profile
            </Button>
          </div>
        </Panel>
        <div className="space-y-5">
          <Panel>
            <PanelHeader title="Connected wallet" />
            <dl className="divide-y divide-line px-5 pb-4">
              <StatRow label="Signed in as">
                <AddressChip address={address!} />
              </StatRow>
              <StatRow label="Wallet">{w.isConnected ? (w.connector?.name ?? "Connected") : "Not connected"}</StatRow>
              <StatRow label="MUSD balance">{bal.data !== undefined ? <Amount value={bal.data} /> : "—"}</StatRow>
            </dl>
            <div className="flex flex-wrap gap-2 px-5 pb-5">
              <Button size="sm" variant="secondary" onClick={() => net.switchToMezo()} disabled={!w.isConnected}>
                <Network className="size-4" /> Add / switch to Mezo testnet
              </Button>
              <Button size="sm" variant="secondary" onClick={() => net.addMusd()} disabled={!w.isConnected}>
                <Coins className="size-4" /> Add MUSD to wallet
              </Button>
            </div>
          </Panel>
          <Panel>
            <PanelHeader title="Network status" />
            <dl className="divide-y divide-line px-5 pb-4">
              <StatRow label="Network">Mezo testnet · chain 31611</StatRow>
              <StatRow label="Your wallet">{!w.isConnected ? "—" : w.onMezo ? "On Mezo testnet" : <span className="text-amber-300">Other network ({w.chainId})</span>}</StatRow>
              <StatRow label="RPC">{network.data?.ok ? <span className="text-mint-400">Healthy</span> : network.isError ? <span className="text-rose-400">Unreachable</span> : "Checking…"}</StatRow>
              <StatRow label="Latest block">{network.data?.blockNumber ? <span className="num">{Number(network.data.blockNumber).toLocaleString()}</span> : "—"}</StatRow>
              <StatRow label="MUSD token">
                <AddressChip address={MUSD.address} />
              </StatRow>
              <StatRow label="Settlement contract">
                <AddressChip address={SETTLEMENT_CONTRACT.address} />
              </StatRow>
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}
