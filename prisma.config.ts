import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma forbids `provider = env(...)` in a datasource block, so one schema file can
 * only ever target one engine. We keep both:
 *
 *   local dev (the default)      -> prisma/schema.prisma           (SQLite)
 *   DATABASE_PROVIDER=postgresql -> prisma/postgres/schema.prisma  (Postgres)
 *
 * The Postgres schema is GENERATED from the SQLite one (`npm run db:sync-postgres`) and
 * differs only in its provider line, so the two cannot drift apart by hand.
 */
const usePostgres = process.env.DATABASE_PROVIDER === "postgresql";

export default defineConfig({
  schema: usePostgres ? "prisma/postgres/schema.prisma" : "prisma/schema.prisma",
  migrations: {
    path: usePostgres ? "prisma/postgres/migrations" : "prisma/migrations",
    // Prisma 7: seeding is configured HERE, not in package.json "prisma.seed".
    // The seed writes through src/lib/db.ts, which picks its driver from DATABASE_URL,
    // so one seed script populates either engine.
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // This URL is used by the CLI — i.e. by MIGRATIONS. The running app does not read it;
    // it builds its own adapter from DATABASE_URL in src/lib/db.ts.
    //
    // That distinction matters on Supabase (and Neon). Their pooled connection runs
    // through pgbouncer in transaction mode, which cannot run DDL or prepared statements,
    // so `migrate deploy` against the pooled port fails. Point DIRECT_DATABASE_URL at the
    // direct port (5432) for migrations, and let the serverless runtime use the pooled one.
    url: process.env["DIRECT_DATABASE_URL"] ?? process.env["DATABASE_URL"],
  },
});
