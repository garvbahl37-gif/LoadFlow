import { createRequire } from "node:module";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Prisma 7 has NO built-in driver — PrismaClientOptions requires an explicit adapter.
 * Which one we need is decided by the connection string, so the same code runs on both:
 *
 *   file:./prisma/dev.db          -> SQLite  (local dev; zero config, no server)
 *   postgresql://... | postgres:// -> Postgres (deployment; survives a serverless disk)
 *
 * The adapters are loaded lazily via createRequire rather than imported at the top of
 * the file. better-sqlite3 is a NATIVE module: a static import would load its binding on
 * every cold start in production, where it is never used — and would hard-crash the
 * deployment if the prebuilt binary were unavailable for the host's Node version.
 * Only the adapter we are actually going to use is ever required.
 */
const require_ = createRequire(import.meta.url);

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";

  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    const { PrismaPg } = require_("@prisma/adapter-pg") as typeof import("@prisma/adapter-pg");
    return new PrismaClient({ adapter: new PrismaPg(url) });
  }

  const { PrismaBetterSqlite3 } = require_(
    "@prisma/adapter-better-sqlite3",
  ) as typeof import("@prisma/adapter-better-sqlite3");
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}

// Re-used across HMR reloads in dev so we don't leak connections.
export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
