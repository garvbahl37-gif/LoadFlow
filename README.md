# LoadFlow

**Freight brokerage operations — with a compliance gate that will not let you dispatch to an uninsured carrier.**

A broker is legally liable if it tenders freight to a carrier whose insurance has lapsed or whose operating authority has been revoked. LoadFlow makes that impossible to do by accident: the moment a carrier is assigned, its compliance record is evaluated, and a load with an open blocking flag **cannot move past `Carrier Assigned`** — not from the UI, not from `curl`, and not even for an administrator holding every permission in the system.

Everything else in the app exists to make that guarantee credible.

![The compliance gate holding a load](docs/screenshots/compliance-gate.png)

> *A Dispatcher looking at a blocked load. Four rules fired automatically the moment the carrier was tendered. Every override control is locked — and says **exactly which permission** it would take. The API says the same thing to `curl`.*

---

## Run it

Requires **Node 20+**. No database server, no Docker, no API keys.

```bash
git clone <this-repo>
cd loadflow
npm install
npm run setup     # migrate + generate client + seed a full demo world
npm run dev       # http://localhost:3000
```

Then sign in at `/login`. **Every password is `loadflow`**, and the login page lists every demo account with one click to fill the form.

```bash
npm test             # 29 unit tests — permission engine, state machine, compliance gate
npm run rbac:proof   # 24 assertions attacking the REST API directly over HTTP (server must be running)
npm run db:reset     # wipe and re-seed
```

### The demo world

| Account | Role | Why it's interesting |
|---|---|---|
| `admin@meridian.com` | Organization Administrator | Every broker permission. |
| `ops@meridian.com` | Ops Lead | **Can** override a compliance flag — on the record, with a written reason. |
| `dispatch@meridian.com` | Dispatcher | **Cannot** override. Try it: the API returns 403 and logs the attempt. |
| `billing@meridian.com` | Billing Clerk | **Zero** permissions. Sees the board; every mutation 403s. |
| `admin@ironline.com` … | Carrier (compliant) | The happy path. `dispatch@` accepts tenders but cannot update status; `driver@` is the exact reverse. |
| `admin@redline.com` … | Carrier — **insurance lapsed** | Holding load LF-1043. Renew the insurance and watch it unblock itself. |
| `admin@cobalt.com` … | Carrier — **authority revoked** | Holding LF-1044, with four separate blocking flags. |
| `shipper@cascade.com` | Shipper | No roles at all. Sees only its own freight, read-only. |

**The 60-second demo:** sign in as `dispatch@meridian.com` → open **LF-1044** → it is blocked, and every override control is locked, naming the permission you would need. Sign in as `ops@meridian.com` → same load → now you *can* override. Or don't: sign in as `admin@redline.com`, renew the lapsed insurance, and LF-1043 unblocks on its own.

---

## What it does

**RBAC, built as a system.** Roles are **admin-authored bundles of permissions**, created through the UI from a fixed 10-permission catalog. Role *names are meaningless to the code* — every check is `can(session, "load.assign_carrier")`. There is a test (`tests/no-role-names.test.ts`) that greps the source and **fails the build** if any conditional branches on a role name.

**Three independent layers of access control**, all server-side, all in [`src/lib/authz/guard.ts`](src/lib/authz/guard.ts):

1. **Authentication** — a DB-backed session, not a JWT, so revoking a user or editing a role takes effect on their *next request* rather than whenever a token happens to expire.
2. **Permission** — the union of the user's roles, **plus an org-type lock**: a forged `RolePermission` row granting a carrier `load.create` still fails, because that permission does not apply to carriers. Denial → `403` + a `DENIED` audit row.
3. **Scope** — org-level and object-level, `AND`ed into every query. A permission can widen what you may *do*; it can never widen what you may *see*. Out-of-scope reads return **404, not 403** — we do not confirm the existence of records you may not see.

**The load state machine** is a declarative table ([`state-machine.ts`](src/lib/loads/state-machine.ts)) of `from → to`, the permission required, which side of the deal may perform it, and its guards. Nothing in the codebase writes `Load.status` except `transitionLoad()`, so the machine cannot be sidestepped.

**The compliance gate** evaluates seven rules on assignment, and re-evaluates every affected live load whenever a carrier's record changes. Fixing a lapsed policy unblocks that carrier's held loads with no further clicks; letting it lapse stops tomorrow's dispatches. An override requires `load.override_compliance_flag` **and a written reason**, and stays on the record forever.

**One audit spine.** Business events and permission denials land in the same table, so "who did what" and "who *tried* what" sit side by side and are **queryable in the UI** — not merely printed to a console.

**Rate confirmations are versioned and immutable.** v2 supersedes v1; v1 is never edited and never deleted. `Load.confirmedRateConfirmationId` is the load's memory of what was *actually* agreed, and it freezes at dispatch — so a load closed months ago still shows the rate it closed on, not whatever was negotiated since.

### The RBAC console — roles are built here, at runtime

![The RBAC console](docs/screenshots/rbac-console.png)

> *The permission catalog on the right shows the **key the code actually checks** (`load.assign_carrier`) next to each capability. "Dispatcher" and "Ops Lead" differ by exactly one permission — `load.override_compliance_flag` — and that single difference is the whole demo.*

### The audit log — including every denial

![The audit log](docs/screenshots/audit-log.png)

> *Business events and permission denials in one table. The red rows are the "log permission-denied attempts" requirement — **queryable**, with the missing permission key in monospace, rather than dumped to a console.*

### Feature checklist

Every must-have, plus all three stretch goals.

| Must-have | Must-have |
|---|---|
| Yes - Auth for 3 account types; bootstrap vs. invited staff | Yes - Load CRUD + full state machine + audit trail |
| Yes - Admin-defined custom roles from a permission catalog | Yes - Carrier compliance record CRUD |
| Yes - Server-side enforcement; org + object-level scoping | Yes - Rate confirmation with versioning |
| Yes - Compliance auto-flagging blocks past `Carrier Assigned` | Yes - Broker / Carrier / Shipper dashboards |
| Yes - Search + filter on the broker load board | Yes - Permission-denied logging (queryable, not just console) |
| **Stretch** | **Stretch** |
| Yes - POD upload + inline viewer | Yes - Compliance expiry renewal alerts |
| Yes - Audit log viewer | |

---

## Stack

**Next.js 16 (App Router) · TypeScript · Prisma 7 · SQLite · Tailwind v4.**

One repo, one `npm run dev`, no external services — a reviewer can run it in 60 seconds. The API lives in Route Handlers under `src/app/api/**`, which makes the enforcement boundary a real, `curl`-able HTTP surface rather than a function call the UI could tiptoe around. SQLite because the brief allows it and it makes the whole app one portable file — POD documents included, since they're stored as bytes in the DB rather than assuming a writable filesystem or a blob store.

Passwords use Node's built-in `scrypt` rather than bcrypt/argon2: a native addon that fails to compile is the most common way a reviewer's `npm install` dies.

### Configuration

The app reads **one** environment variable:

```bash
DATABASE_URL="file:./prisma/dev.db"
```

There are no API keys. No Supabase, no auth provider, no object storage, and — because sessions are database rows rather than signed tokens — not even a session secret. `npm run setup` creates the database file.

### Deploying

It also runs on **Postgres** without a single code change: [`src/lib/db.ts`](src/lib/db.ts) selects its driver from the connection string, and the Postgres schema is *generated* from the SQLite one (`npm run db:sync-postgres`) so the two cannot drift. Set `DATABASE_PROVIDER=postgresql` plus a connection string and it targets Supabase/Neon on Vercel.

This is verified, not asserted: the full HTTP RBAC proof (24/24), the seed, and the POD byte round-trip through `BYTEA` were all re-run against a real Postgres instance. See **[docs/DEPLOY.md](docs/DEPLOY.md)**, which also covers running it as-is on SQLite on any host with a persistent disk, and explains why SQLite cannot work on a serverless filesystem.

---

## Documentation

| | |
|---|---|
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | The domain contract — RBAC model, state machine, compliance rules, audit design. |
| **[docs/RBAC-PROOF.md](docs/RBAC-PROOF.md)** | **Copy-paste `curl` commands** proving API-layer enforcement. |
| **[docs/API.md](docs/API.md)** | The REST contract. |
| **[docs/AI-USAGE.md](docs/AI-USAGE.md)** | How this was built with an AI coding tool — prompt style, review habits, what it got wrong. |
| **[docs/CONVENTIONS.md](docs/CONVENTIONS.md)** | Framework ground truth. Next 16 / Prisma 7 / Tailwind 4 all break older muscle memory. |
| **[docs/DEPLOY.md](docs/DEPLOY.md)** | Deploying on Postgres (verified), or on SQLite with a persistent disk. |

---

## Assumptions I made

* **A shipper is an Org.** The brief says a shipper has no sub-roles, so it's an org of type `SHIPPER` with a single user, zero roles, and access defined purely by object-level scoping. This keeps `Load` uniformly pointing at three orgs (shipper / broker / carrier) rather than special-casing one party.
* **The admin role is not special-cased.** "Organization Administrator" is simply the auto-created role that happens to hold every permission for that org type. It's flagged `isSystem` so it can't be edited or deleted — otherwise an org could rewrite the meaning of "administrator" out from under its own audit trail — but **no authorization check anywhere asks whether you are an admin.**
* **I added three permissions** beyond the brief's seven: `load.accept_decline`, `compliance.manage`, `audit.view`. The brief's own examples require them — a Carrier "Dispatch" role that accepts/declines, carrier-compliance CRUD, an audit-log viewer — and none are expressible with the seven given. They're additions, not substitutions; the original seven are present verbatim.
* **Invites are links, not emails.** No mail server, so an admin creating a staff invite gets a copy-able `/invite/<token>` URL in the UI.
* **Money is integer cents everywhere.** Never a float in the database.
* **The shipper is not told *why* their load is stalled.** They see "Carrier Assigned"; they do not see that their broker's carrier has lapsed insurance. That's the broker's commercial problem, and leaking it across the counterparty boundary felt wrong. It's a judgement call and it's reversible.

## What's incomplete, and what I'd do next

Honestly:

* **The carrier doesn't counter-sign the rate.** The broker issues and confirms a versioned rate confirmation; the carrier accepts the *tender*. A real rate con is signed by both parties. The versioning model already supports it — it needs a carrier-side accept/counter on the rate version and one state field.
* **No CSRF token.** Mutations are JSON-only (which a cross-site form cannot produce) and the session cookie is `SameSite=Lax`, so the JSON endpoints are already immune. The one exception — the `multipart/form-data` POD upload — is protected by an explicit `Sec-Fetch-Site`/`Origin` check. A production build should still use a proper double-submit token rather than relying on that reasoning.
* **No rate limiting on login.** Failed logins *are* audited, but nothing throttles them.
* **No pagination on the load board.** Fine at demo scale; it would fall over at 10,000 loads. The audit log does paginate.
* **Deployment is local.** SQLite on a filesystem doesn't survive a serverless platform's ephemeral disk. To ship it I'd point the Prisma datasource at Postgres — or Turso/libSQL to keep the SQLite dialect — which the driver-adapter architecture makes a config change rather than a rewrite, and move POD bytes to object storage.
* **Compliance re-evaluation is synchronous.** Editing a carrier with hundreds of live loads re-evaluates them all inside the request. That belongs in a job queue.
* **Tests cover the logic and the API boundary, not the UI.** 29 unit tests and 24 HTTP assertions. There are no component or browser tests; I drove the UI manually across every persona instead.

In priority order with more time: carrier-side rate acceptance → CSRF tokens + login throttling → Postgres/Turso + object storage so it can actually deploy → re-evaluation in a queue → browser tests in CI.
