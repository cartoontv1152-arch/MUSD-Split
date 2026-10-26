import "server-only";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { attachDatabasePool } from "@vercel/functions";

/**
 * Postgres (Neon) access. All tables live in schema `split`.
 * Raw parameterized SQL only — no string interpolation of user input, ever.
 */

declare global {
  var __musdSplitPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured");
  const pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 });
  pool.on("error", (err: Error) => {
    console.error("[db] idle client error", err.message);
  });
  try {
    attachDatabasePool(pool);
  } catch {
    // not running on Vercel Fluid compute — fine
  }
  return pool;
}

export function getPool(): Pool {
  if (!globalThis.__musdSplitPool) globalThis.__musdSplitPool = createPool();
  return globalThis.__musdSplitPool;
}

export type Queryable = Pick<PoolClient, "query">;

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = [], client?: Queryable): Promise<T[]> {
  const res = await (client ?? getPool()).query(text, params);
  return res.rows as T[];
}

export async function q1<T = Record<string, unknown>>(text: string, params: unknown[] = [], client?: Queryable): Promise<T | null> {
  const rows = await q<T>(text, params, client);
  return rows[0] ?? null;
}

/** Run `fn` inside a transaction (BEGIN/COMMIT, ROLLBACK on error). */
export async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  const err = e as { code?: string; constraint?: string };
  return err?.code === "23505" && (!constraint || err.constraint === constraint);
}
