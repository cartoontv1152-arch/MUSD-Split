import "server-only";
import { LIMITS } from "@/config/app";
import { q, q1, withTx } from "./db";
import { notify, recordActivity } from "./events";
import { isAdmin, requireMember } from "./groups";
import { ApiError, conflict, forbidden, notFound } from "./http";
import { ensureUser, getProfiles } from "./users";

export interface InviteRow {
  id: string;
  group_id: string;
  token: string;
  label: string | null;
  created_by: string;
  created_at: Date;
  expires_at: Date | null;
  max_uses: number | null;
  uses: number;
  revoked_at: Date | null;
}

/** 24 random bytes -> 32-char base64url token (192 bits; unguessable). */
export function newInviteToken(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Buffer.from(b).toString("base64url");
}

export function inviteState(i: InviteRow, now = new Date()): "active" | "revoked" | "expired" | "used_up" {
  if (i.revoked_at) return "revoked";
  if (i.expires_at && i.expires_at.getTime() <= now.getTime()) return "expired";
  if (i.max_uses !== null && i.uses >= i.max_uses) return "used_up";
  return "active";
}

export function inviteDTO(i: InviteRow) {
  return {
    id: i.id,
    token: i.token,
    label: i.label,
    createdBy: i.created_by,
    createdAt: i.created_at.toISOString(),
    expiresAt: i.expires_at?.toISOString() ?? null,
    maxUses: i.max_uses,
    uses: i.uses,
    revokedAt: i.revoked_at?.toISOString() ?? null,
    state: inviteState(i),
  };
}

export async function createInvite(
  groupId: string,
  actor: string,
  input: { expiresInHours?: number | null; maxUses?: number | null; label?: string | null },
) {
  const { group, membership } = await requireMember(groupId, actor);
  if (!isAdmin(membership.role) && !group.members_can_invite) throw forbidden("Only admins can invite people to this group");
  return withTx(async (c) => {
    const id = crypto.randomUUID();
    const row = await q1<InviteRow>(
      `INSERT INTO split.invites (id, group_id, token, label, created_by, expires_at, max_uses)
       VALUES ($1,$2,$3,$4,$5, CASE WHEN $6::int IS NULL THEN NULL ELSE now() + make_interval(hours => $6::int) END, $7)
       RETURNING *`,
      [id, groupId, newInviteToken(), input.label || null, actor, input.expiresInHours ?? null, input.maxUses ?? null],
      c,
    );
    await recordActivity(c, groupId, actor, "invite_created", { inviteId: id, expiresAt: row!.expires_at, maxUses: row!.max_uses });
    return row!;
  });
}

export async function listInvites(groupId: string, actor: string) {
  const { group, membership } = await requireMember(groupId, actor);
  const rows = await q<InviteRow>(`SELECT * FROM split.invites WHERE group_id = $1 ORDER BY created_at DESC LIMIT 50`, [groupId]);
  const canManage = isAdmin(membership.role);
  const canInvite = canManage || group.members_can_invite;
  // members see their own invites; admins see all
  return {
    canInvite,
    canManage,
    invites: rows.filter((r) => canManage || r.created_by === actor).map(inviteDTO),
  };
}

export async function revokeInvite(groupId: string, inviteId: string, actor: string) {
  const { membership } = await requireMember(groupId, actor);
  return withTx(async (c) => {
    const inv = await q1<InviteRow>(`SELECT * FROM split.invites WHERE id = $1 AND group_id = $2 FOR UPDATE`, [inviteId, groupId], c);
    if (!inv) throw notFound("Invite not found");
    if (!isAdmin(membership.role) && inv.created_by !== actor) throw forbidden("Only admins or the person who created this invite can revoke it");
    if (inv.revoked_at) return inv;
    const row = await q1<InviteRow>(
      `UPDATE split.invites SET revoked_at = now(), revoked_by = $2 WHERE id = $1 RETURNING *`,
      [inviteId, actor],
      c,
    );
    await recordActivity(c, groupId, actor, "invite_revoked", { inviteId });
    return row!;
  });
}

/** Public preview for the /join page: only what's needed to decide (no member addresses). */
export async function previewInvite(token: string) {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) throw notFound("This invite link isn't valid");
  const row = await q1<InviteRow & { name: string; description: string | null; icon: string; color: string; member_count: string; archived_at: Date | null }>(
    `SELECT i.*, g.name, g.description, g.icon, g.color, g.archived_at,
       (SELECT count(*) FROM split.group_members m WHERE m.group_id = g.id AND m.status = 'active')::text AS member_count
     FROM split.invites i JOIN split.groups g ON g.id = i.group_id WHERE i.token = $1`,
    [token],
  );
  if (!row) throw notFound("This invite link isn't valid");
  const profiles = await getProfiles([row.created_by]);
  return {
    group: { id: row.group_id, name: row.name, description: row.description, icon: row.icon, color: row.color, memberCount: Number(row.member_count) },
    invitedBy: profiles[row.created_by],
    expiresAt: row.expires_at?.toISOString() ?? null,
    state: row.archived_at ? "revoked" : inviteState(row),
  };
}

export async function acceptInvite(token: string, actor: string) {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) throw notFound("This invite link isn't valid");
  await ensureUser(actor);
  return withTx(async (c) => {
    const inv = await q1<InviteRow>(`SELECT * FROM split.invites WHERE token = $1 FOR UPDATE`, [token], c);
    if (!inv) throw notFound("This invite link isn't valid");
    const existing = await q1<{ status: string }>(
      `SELECT status FROM split.group_members WHERE group_id = $1 AND address = $2`,
      [inv.group_id, actor],
      c,
    );
    if (existing?.status === "active") return { groupId: inv.group_id, alreadyMember: true };
    const state = inviteState(inv);
    if (state !== "active") {
      const msg = { revoked: "This invite was revoked", expired: "This invite has expired", used_up: "This invite has reached its limit" }[state];
      throw new ApiError(410, `INVITE_${state.toUpperCase()}`, `${msg}. Ask a member for a new link.`);
    }
    const count = await q1<{ n: string }>(
      `SELECT count(*)::text AS n FROM split.group_members WHERE group_id = $1 AND status = 'active'`,
      [inv.group_id],
      c,
    );
    if (Number(count?.n ?? 0) >= LIMITS.maxGroupMembers) throw conflict("This group is full", "GROUP_FULL");
    const used = await q1(
      `UPDATE split.invites SET uses = uses + 1 WHERE id = $1 AND (max_uses IS NULL OR uses < max_uses) RETURNING id`,
      [inv.id],
      c,
    );
    if (!used) throw new ApiError(410, "INVITE_USED_UP", "This invite has reached its limit. Ask a member for a new link.");
    await q(
      `INSERT INTO split.group_members (group_id, address, role, status, invite_id)
       VALUES ($1, $2, 'member', 'active', $3)
       ON CONFLICT (group_id, address) DO UPDATE SET status = 'active', left_at = NULL, joined_at = now(), invite_id = EXCLUDED.invite_id`,
      [inv.group_id, actor, inv.id],
      c,
    );
    await recordActivity(c, inv.group_id, actor, "member_joined", { inviteId: inv.id, invitedBy: inv.created_by, rejoined: !!existing });
    const others = await q<{ address: string }>(
      `SELECT address FROM split.group_members WHERE group_id = $1 AND status = 'active' AND address <> $2`,
      [inv.group_id, actor],
      c,
    );
    const prof = await getProfiles([actor], c);
    const g = await q1<{ name: string }>(`SELECT name FROM split.groups WHERE id = $1`, [inv.group_id], c);
    const who = prof[actor]?.displayName || `${actor.slice(0, 6)}…${actor.slice(-4)}`;
    await notify(c, others.map((o) => o.address), {
      groupId: inv.group_id,
      type: "member_joined",
      title: `${who} joined ${g?.name ?? "your group"}`,
      href: `/groups/${inv.group_id}`,
    });
    return { groupId: inv.group_id, alreadyMember: false };
  });
}
