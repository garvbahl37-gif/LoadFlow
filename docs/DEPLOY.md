# Deploying LoadFlow

**You do not need to deploy this.** The brief accepts *"deployed **or** clear run instructions"*, and locally it is `npm install && npm run setup && npm run dev` with a single environment variable pointing at a file. There is no database server to provision, no API key, and no account to create.

If you do want a live URL, there are two honest routes. They differ in one thing only: **where the database lives.**

| | Path A — Postgres on Vercel | Path B — SQLite on a disk |
|---|---|---|
| Host | Vercel (serverless) | Fly.io / Render / Railway / a VPS |
| Database | Supabase, Neon, any Postgres | The `prisma/dev.db` file, on a volume |
| Code changes | none (already in the repo) | none |
| Env vars | 3 | 1 |
| Verified end-to-end by me | **Yes** — see below | **No** — no Docker on the build machine |

---

## Why SQLite cannot run on Vercel

This is the whole reason Path A exists, and it is worth understanding rather than working around.

A Vercel function gets an **ephemeral, read-only filesystem**. SQLite is a *file*. So:

* writes either fail outright or land in `/tmp`, which is discarded when the function is recycled;
* two concurrent requests may be served by two different machines, each with a different `/tmp`;
* nothing you save survives the next deploy.

SQLite is not the problem — serverless is. Give SQLite a real disk and it is excellent, which is exactly what Path B does.

---

## Path A — Postgres on Vercel (verified)

### What is already done

`prisma/schema.prisma` stays SQLite and remains the single source of truth. `prisma/postgres/schema.prisma` is **generated** from it by `npm run db:sync-postgres` and differs only in its `provider` line, so the two cannot drift. Prisma forbids `provider = env(...)`, which is why there are two schema files rather than one.

At runtime, [`src/lib/db.ts`](../src/lib/db.ts) picks its driver from the connection string — `file:` gets the SQLite adapter, `postgresql://` gets the Postgres one — and loads only the adapter it needs. So the same commit runs on either engine.

### 1. Create the database

Supabase → **New project**. Then **Project Settings → Database → Connection string**, and copy **two** URLs:

* the **Transaction pooler** one (port `6543`) — for the running app
* the **Direct connection** one (port `5432`) — for migrations

> You need both. Supabase's pooled connection runs through pgbouncer in transaction mode, which **cannot execute DDL**, so `prisma migrate deploy` fails against it. Serverless functions, meanwhile, should use the pooler so they don't exhaust connections. [`prisma.config.ts`](../prisma.config.ts) reads `DIRECT_DATABASE_URL` for migrations and the app reads `DATABASE_URL` for queries, which is exactly this split.
>
> Neon works the same way. A plain Postgres box needs only one URL — set both variables to it.

### 2. Set the environment variables in Vercel

| Variable | Value |
|---|---|
| `DATABASE_PROVIDER` | `postgresql` |
| `DATABASE_URL` | the **Transaction pooler** string, port `6543`, with `?pgbouncer=true` |
| `DIRECT_URL` | the **Session pooler** string, port `5432` |

Three traps here, all of which cost real time if you hit them blind:

* **Do not use Supabase's "Direct connection"** (`db.<ref>.supabase.co:5432`). It is
  **IPv6-only** unless you buy the IPv4 add-on, so `migrate deploy` fails from most
  networks and from Vercel's build machines with a misleading "can't reach database
  server". Use the **Session pooler** (`...pooler.supabase.com:5432`) instead: it is
  IPv4 and, being session-mode, it can run DDL.
* **Do not point migrations at the Transaction pooler** (`:6543`). Transaction-mode
  pgbouncer cannot execute DDL or prepared statements. It is correct for the *running*
  app and wrong for migrations, which is exactly why these are two variables.
* **Percent-encode special characters in the password.** An `@` in the password must be
  written `%40`, or the URL parses the password as part of the hostname.

That is the complete list. There is no session secret (sessions are database rows, not signed tokens) and no storage credential (POD documents live in the database).

### 3. Deploy

Vercel's build command is already wired up in `package.json`:

```
vercel-build:  prisma generate && prisma migrate deploy && next build
```

`prisma generate` sees `DATABASE_PROVIDER=postgresql`, picks the Postgres schema, and emits a Postgres-flavoured client; `migrate deploy` creates the 15 tables and 9 enums over the direct connection; then Next builds.

```bash
npm i -g vercel
vercel link
vercel deploy --prod
```

### 3a. Turn OFF Vercel Authentication — or nobody can see it

New Vercel projects ship with **Deployment Protection** on, which puts the whole
deployment behind Vercel's SSO. The site returns HTTP 200, so it *looks* deployed — but
what is being served is a Vercel login page, and every API call comes back
`401 {"protection":{"vercel_auth_enabled":true}}`.

There is no CLI command for this. In the dashboard:

**Project → Settings → Deployment Protection → Vercel Authentication → Disabled → Save**

Then confirm it is genuinely public, from outside your session:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<your-app>.vercel.app/login   # expect 200
BASE_URL=https://<your-app>.vercel.app npx tsx scripts/rbac-proof.ts --no-seed  # expect 24/24
```

Running the RBAC proof against the live URL is the only thing that proves the deployment
actually *enforces* everything, rather than merely rendering.

### 4. Seed it once

The build deliberately does **not** seed — that would wipe the database on every deploy. Run it once from your machine, pointed at the production database:

```bash
DATABASE_PROVIDER=postgresql \
DATABASE_URL="<the DIRECT 5432 url>" \
npx prisma db seed
```

Now the demo world exists: the three carriers, the blocked loads, the Dispatcher who cannot override and the Ops Lead who can.

### What I actually ran

I did not want to hand you a deployment path I had only reasoned about, so I stood up a real Postgres 18 and ran the whole application against it:

```
migrate deploy   15 tables, 9 native enums, BYTEA for POD bytes, JSONB for accessorials
db seed          6 orgs, 15 users, 13 roles, 7 loads, 6 compliance flags — identical to SQLite
next build       compiled clean
rbac:proof       24 passed, 0 failed  (the full HTTP attack suite, against Postgres)
POD download     3,015 bytes out of BYTEA, valid %PDF-1.4 header
```

Then I switched back to SQLite and re-ran everything to be sure the local path was untouched: 29 unit tests pass, 24/24 proof, clean build.

One thing that only surfaced by running it: Prisma 7 renamed `migrate diff --to-schema-datamodel` to `--to-schema`. Reading the docs would not have told me; the command failing did.

---

## Path B — SQLite, unchanged, on a host with a disk

Zero code changes. This is byte-for-byte the app I verified locally; the only requirement is a persistent volume and a long-running Node process.

**I have not run this** — there is no Docker on the machine I built this on — so treat the Dockerfile below as a starting point rather than a tested artefact. Path A is the one I can vouch for.

Fly.io, roughly:

```bash
fly launch --no-deploy
fly volumes create data --size 1
```

`fly.toml` needs the volume mounted and the database pointed into it:

```toml
[env]
  DATABASE_URL = "file:/data/dev.db"

[mounts]
  source      = "data"
  destination = "/data"
```

Then deploy and seed once:

```bash
fly deploy
fly ssh console -C "npx prisma migrate deploy && npx prisma db seed"
```

The same shape works on Render (add a Disk) or Railway (add a Volume). Note this is a machine that stays up, not a serverless function — which costs a little, and in exchange the database is a single file you can `scp` off the box.

---

## Which would I pick?

For a hackathon submission where a judge might open the link at any hour: **neither is required, and the local run is the strongest story** — clone, one command, zero configuration, and it works. That is genuinely rarer than a deployed URL.

If you want the URL anyway, take **Path A**. It is the one I verified, it is the answer you would give in a real engineering conversation about running this in production, and Supabase's free tier covers it.
