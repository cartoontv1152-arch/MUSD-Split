import { NextResponse, type NextRequest } from "next/server";
import { q } from "@/lib/server/db";
import { runRecurring } from "@/lib/server/recurring";
import { expireRequests } from "@/lib/server/requests";
import { reverifyPending } from "@/lib/server/settlements";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Daily job (Vercel Cron, Hobby plan = once a day): creates due recurring expenses and reminders
 * (never moves funds), expires stale payment requests, re-verifies pending settlements and
 * cleans up old sign-in nonces. Protected by CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const recurring = await runRecurring().catch((e) => ({ error: (e as Error).message }));
  await expireRequests().catch(() => undefined);
  const reverify = await reverifyPending(40).catch((e) => ({ error: (e as Error).message }));
  await q(`DELETE FROM split.auth_nonces WHERE expires_at < now() - interval '1 day'`).catch(() => undefined);
  return NextResponse.json({ ok: true, recurring, reverify, ms: Date.now() - started });
}
