import "server-only";
import { q, q1 } from "./db";

/**
 * Public, aggregate usage numbers for /stats. No names, no group titles — only counts, totals
 * and the on-chain hashes of confirmed payments (which are public on the explorer anyway).
 * Groups created by our automated end-to-end runs ("E2E …") or by the team's own test wallets
 * (STATS_TEST_WALLETS, comma-separated public addresses) are reported separately, so the headline
 * numbers reflect real use only.
 */
const IS_TEST = `(g.name ILIKE 'e2e%' OR g.created_by = ANY($1::text[]))`;
const testWallets = () =>
  (process.env.STATS_TEST_WALLETS ?? "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter((a) => /^0x[0-9a-f]{40}$/.test(a));

export interface UsageStats {
  real: { people: number; groups: number; expenses: number; expenseVolume: string; payments: number; paymentVolume: string; payers: number };
  test: { groups: number; payments: number };
  byMethod: Array<{ method: string; payments: number; volume: string }>;
  recent: Array<{ txHash: string; amount: string; method: string; confirmedAt: string; blockNumber: string | null; test: boolean }>;
  weekly: Array<{ week: string; payments: number; volume: string }>;
  generatedAt: string;
}

export async function usageStats(): Promise<UsageStats> {
  const tw = testWallets();
  const [people, groups, expenses, payments, test, byMethod, recent, weekly] = await Promise.all([
    q1<{ n: string }>(
      `SELECT count(DISTINCT m.address)::text AS n FROM split.group_members m JOIN split.groups g ON g.id = m.group_id
       LEFT JOIN split.users u ON u.address = m.address
       WHERE NOT (${IS_TEST}) AND coalesce(u.display_name, '') NOT ILIKE '%e2e%'`, [tw]
    ),
    q1<{ n: string }>(`SELECT count(*)::text AS n FROM split.groups g WHERE NOT (${IS_TEST})`, [tw]),
    q1<{ n: string; v: string }>(
      `SELECT count(*)::text AS n, coalesce(sum(e.amount), 0)::text AS v FROM split.expenses e JOIN split.groups g ON g.id = e.group_id
       WHERE NOT (${IS_TEST}) AND e.deleted_at IS NULL`, [tw]
    ),
    q1<{ n: string; v: string; payers: string }>(
      `SELECT count(*)::text AS n, coalesce(sum(s.amount), 0)::text AS v, count(DISTINCT s.from_address)::text AS payers
       FROM split.settlements s JOIN split.groups g ON g.id = s.group_id WHERE s.status = 'confirmed' AND NOT (${IS_TEST})`, [tw]
    ),
    q1<{ groups: string; payments: string }>(
      `SELECT (SELECT count(*) FROM split.groups g WHERE ${IS_TEST})::text AS groups,
              (SELECT count(*) FROM split.settlements s JOIN split.groups g ON g.id = s.group_id WHERE s.status = 'confirmed' AND ${IS_TEST})::text AS payments`, [tw]
    ),
    q<{ method: string; n: string; v: string }>(
      `SELECT s.method, count(*)::text AS n, sum(s.amount)::text AS v FROM split.settlements s WHERE s.status = 'confirmed'
       GROUP BY s.method ORDER BY count(*) DESC`
    ),
    q<{ tx_hash: string; amount: string; method: string; confirmed_at: Date; block_number: string | null; test: boolean }>(
      `SELECT s.tx_hash, s.amount::text AS amount, s.method, coalesce(s.confirmed_at, s.updated_at) AS confirmed_at,
              s.block_number::text AS block_number, (${IS_TEST}) AS test
       FROM split.settlements s JOIN split.groups g ON g.id = s.group_id
       WHERE s.status = 'confirmed' AND s.tx_hash IS NOT NULL ORDER BY coalesce(s.confirmed_at, s.updated_at) DESC LIMIT 12`, [tw]
    ),
    q<{ week: Date; n: string; v: string }>(
      `SELECT date_trunc('week', coalesce(s.confirmed_at, s.updated_at)) AS week, count(*)::text AS n, sum(s.amount)::text AS v
       FROM split.settlements s WHERE s.status = 'confirmed' GROUP BY 1 ORDER BY 1 DESC LIMIT 8`
    ),
  ]);
  return {
    real: {
      people: Number(people?.n ?? 0),
      groups: Number(groups?.n ?? 0),
      expenses: Number(expenses?.n ?? 0),
      expenseVolume: expenses?.v ?? "0",
      payments: Number(payments?.n ?? 0),
      paymentVolume: payments?.v ?? "0",
      payers: Number(payments?.payers ?? 0),
    },
    test: { groups: Number(test?.groups ?? 0), payments: Number(test?.payments ?? 0) },
    byMethod: byMethod.map((r) => ({ method: r.method, payments: Number(r.n), volume: r.v })),
    recent: recent.map((r) => ({ txHash: r.tx_hash, amount: r.amount, method: r.method, confirmedAt: new Date(r.confirmed_at).toISOString(), blockNumber: r.block_number, test: r.test })),
    weekly: weekly.reverse().map((r) => ({ week: new Date(r.week).toISOString().slice(0, 10), payments: Number(r.n), volume: r.v })),
    generatedAt: new Date().toISOString(),
  };
}
