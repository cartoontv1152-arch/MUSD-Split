/**
 * Applies db/migrations/*.sql (idempotent) to the Neon database, inside schema `split` only.
 *   npm run db:migrate
 * Reads DATABASE_URL_UNPOOLED / DATABASE_URL from the environment or .env.local.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "@neondatabase/serverless";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (run `vercel env pull .env.local`)");
  const pool = new Pool({ connectionString: url });
  const dir = path.resolve("db/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  try {
    for (const f of files) {
      const sql = readFileSync(path.join(dir, f), "utf8");
      if (/\b(public|rescue|escrowflow|yieldproof|payguard)\./i.test(sql)) {
        throw new Error(`${f} references a schema other than split — refusing to run`);
      }
      const started = Date.now();
      await pool.query(sql);
      await pool.query("INSERT INTO split.schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [f]);
      console.log(`applied ${f} (${Date.now() - started} ms)`);
    }
    const { rows } = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'split' ORDER BY table_name",
    );
    console.log(`schema split: ${rows.length} tables -> ${rows.map((r) => r.table_name).join(", ")}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
