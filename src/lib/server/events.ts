import "server-only";
import { q, type Queryable } from "./db";

/**
 * Activity feed + notifications. Both are written in the same DB transaction as the event
 * they describe, so they always reflect real application events.
 */

export type ActivityType =
  | "group_created"
  | "group_updated"
  | "member_joined"
  | "member_left"
  | "member_removed"
  | "invite_created"
  | "invite_revoked"
  | "expense_added"
  | "expense_edited"
  | "expense_deleted"
  | "expense_adjusted"
  | "payment_requested"
  | "payment_request_cancelled"
  | "payment_request_declined"
  | "settlement_initiated"
  | "settlement_confirmed"
  | "settlement_failed"
  | "settlement_rejected"
  | "recurring_created"
  | "recurring_run";

export async function recordActivity(
  client: Queryable,
  groupId: string,
  actor: string | null,
  type: ActivityType,
  data: Record<string, unknown> = {},
): Promise<void> {
  await q(
    `INSERT INTO split.activity (group_id, actor, type, data) VALUES ($1, $2, $3, $4::jsonb)`,
    [groupId, actor, type, JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v))],
    client,
  );
}

export type NotificationType =
  | "expense_added"
  | "expense_changed"
  | "payment_requested"
  | "settlement_confirmed"
  | "settlement_received"
  | "settlement_failed"
  | "member_joined"
  | "recurring_reminder"
  | "recurring_created";

export async function notify(
  client: Queryable,
  recipients: string[],
  n: { groupId: string | null; type: NotificationType; title: string; body?: string; href?: string; data?: Record<string, unknown> },
): Promise<void> {
  const uniq = [...new Set(recipients.map((r) => r.toLowerCase()))];
  if (uniq.length === 0) return;
  await q(
    `INSERT INTO split.notifications (recipient, group_id, type, title, body, href, data)
     SELECT r, $2, $3, $4, $5, $6, $7::jsonb FROM unnest($1::text[]) AS r`,
    [uniq, n.groupId, n.type, n.title, n.body ?? null, n.href ?? null, JSON.stringify(n.data ?? {})],
    client,
  );
}
