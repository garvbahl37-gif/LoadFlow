/**
 * Prisma does not allow `provider = env(...)` in a datasource block — one schema means
 * one database engine. But the two things we want are both worth having:
 *
 *   - local dev stays zero-config SQLite (clone, `npm run setup`, done)
 *   - deployment runs on Postgres, which survives a serverless filesystem
 *
 * So `prisma/schema.prisma` (SQLite) stays the single source of truth, and this script
 * derives the Postgres schema from it. The ONLY difference between them is the provider
 * line — every model, enum, index and relation is identical, which is why they can share
 * one generated client and one set of application queries.
 *
 * Run it after any schema change:  npm run db:sync-postgres
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SOURCE = resolve("prisma/schema.prisma");
const TARGET = resolve("prisma/postgres/schema.prisma");

const HEADER = `// ─────────────────────────────────────────────────────────────────────────────
// GENERATED FILE — DO NOT EDIT.
//
// Derived from prisma/schema.prisma by \`npm run db:sync-postgres\`.
// The only difference is the datasource provider: SQLite for local development,
// Postgres for deployment. Edit the SQLite schema and re-run the script.
// ─────────────────────────────────────────────────────────────────────────────

`;

const source = readFileSync(SOURCE, "utf8");

if (!/provider\s*=\s*"sqlite"/.test(source)) {
  console.error("prisma/schema.prisma no longer declares the sqlite provider — aborting.");
  process.exit(1);
}

const postgres = HEADER + source
  // The datasource provider is the one and only substantive change.
  .replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"')
  // The generated client must land in the same place, so app code is unchanged.
  .replace(/output\s*=\s*"\.\.\/src\/generated\/prisma"/, 'output   = "../../src/generated/prisma"')
  // Drop the SQLite-specific commentary; it would be misleading here.
  // ([\s\S] rather than the /s flag, which this tsconfig target does not allow.)
  .replace(
    /\/\/ Prisma 7 \+ SQLite:[\s\S]*?\(CLI\) and from the driver adapter in src\/lib\/db\.ts \(runtime\)\.\n/,
    "// The datasource carries no `url`: it comes from prisma.config.ts (CLI) and from\n" +
      "// the driver adapter in src/lib/db.ts (runtime).\n",
  );

mkdirSync(dirname(TARGET), { recursive: true });
writeFileSync(TARGET, postgres);

console.log(`Wrote ${TARGET}`);
console.log("  provider: postgresql (derived from the sqlite schema)");
