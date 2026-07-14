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
    // This URL is used by the CLI — i.e. by MIGRATIONS. The running app never reads it;
    // it builds its own adapter from DATABASE_URL in src/lib/db.ts.
    //
    // That distinction matters on Supabase and Neon. Their TRANSACTION-mode pooler
    // (port 6543) is what serverless functions should use, but it cannot execute DDL or
    // prepared statements — so `migrate deploy` against it fails. Migrations must go
    // through a session-mode or direct connection (port 5432) instead.
    //
    // `DIRECT_URL` is the name Supabase itself puts in the connection strings it hands
    // you; DIRECT_DATABASE_URL is accepted too so neither name is a trap. If neither is
    // set (e.g. local SQLite), migrations just use DATABASE_URL.
    //
    // Avoid Supabase's "Direct connection" (db.<ref>.supabase.co): it is IPv6-only unless
    // you buy the IPv4 add-on, and it will fail from most networks and CI. Use the
    // SESSION-mode pooler on 5432, which is IPv4 and supports DDL.
    url:
      process.env["DIRECT_URL"] ??
      process.env["DIRECT_DATABASE_URL"] ??
      process.env["DATABASE_URL"],
  },
});
