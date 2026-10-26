import "server-only";
import { q, type Queryable } from "./db";

export interface ProfileDTO {
  address: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
}

interface UserRow {
  address: string;
  display_name: string | null;
  username: string | null;
  avatar_updated_at: Date | null;
}

export function toProfile(r: UserRow): ProfileDTO {
  return {
    address: r.address,
    displayName: r.display_name,
    username: r.username,
    avatarUrl: r.avatar_updated_at ? `/api/avatars/${r.address}?v=${r.avatar_updated_at.getTime()}` : null,
  };
}

export async function ensureUser(address: string, client?: Queryable): Promise<void> {
  await q(
    `INSERT INTO split.users (address, last_seen_at) VALUES ($1, now())
     ON CONFLICT (address) DO UPDATE SET last_seen_at = now()`,
    [address.toLowerCase()],
    client,
  );
}

export async function getProfiles(addresses: string[], client?: Queryable): Promise<Record<string, ProfileDTO>> {
  const uniq = [...new Set(addresses.map((a) => a.toLowerCase()))];
  if (uniq.length === 0) return {};
  const rows = await q<UserRow>(
    `SELECT address, display_name, username, avatar_updated_at FROM split.users WHERE address = ANY($1::text[])`,
    [uniq],
    client,
  );
  const out: Record<string, ProfileDTO> = {};
  for (const a of uniq) out[a] = { address: a, displayName: null, username: null, avatarUrl: null };
  for (const r of rows) out[r.address] = toProfile(r);
  return out;
}

export async function getMe(address: string) {
  const rows = await q<UserRow & { preferences: Record<string, unknown>; created_at: Date }>(
    `SELECT address, display_name, username, avatar_updated_at, preferences, created_at FROM split.users WHERE address = $1`,
    [address],
  );
  const r = rows[0];
  if (!r) return null;
  return { ...toProfile(r), preferences: r.preferences ?? {}, createdAt: r.created_at.toISOString() };
}
