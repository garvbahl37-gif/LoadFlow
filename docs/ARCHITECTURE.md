# LoadFlow — Architecture & Domain Contract

> This is the **single source of truth** for the domain. Code must match this document.
> If code and this doc disagree, one of them is a bug.

---

## 1. Core principle: permissions, never roles

The authorization system is a **real engine**, not an `if (user.role === 'admin')` ladder.

```
User ──< UserRole >── Role ──< RolePermission >── Permission (fixed catalog)
                        │
                     scoped to an Org
```

* A **Permission** is a fixed, seeded capability key (e.g. `load.assign_carrier`). The catalog is code-defined and immutable at runtime.
* A **Role** is an admin-authored bundle of permissions, **owned by one Org**. Roles are created through the UI. Their *names are meaningless to the code*.
* A **User** holds zero or more Roles. Effective permissions = union of all their roles' permissions.
* **Every authorization check in the codebase is `can(session, 'some.permission')`.** Grepping the source for a role name used in a conditional should return nothing. This is enforced by a test.

The org's first admin gets a `isSystem` role ("Organization Administrator") holding every permission applicable to that org type. It is not special-cased in code — it is simply a role that happens to contain all the permissions. That is what makes an admin an admin.

### Permission catalog

| Key | Applies to | Guards |
|---|---|---|
| `load.create` | BROKER | Creating/editing/cancelling loads |
| `load.assign_carrier` | BROKER | Assigning a carrier to a load |
| `load.override_compliance_flag` | BROKER | Overriding a blocking compliance flag |
| `rate.confirm` | BROKER | Creating & confirming a rate confirmation version |
| `load.update_status` | BROKER, CARRIER | Advancing the load state machine |
| `staff.manage` | BROKER, CARRIER | Inviting staff, creating/editing roles, assigning roles |
| `pod.upload` | CARRIER | Uploading proof of delivery |
| `load.accept_decline` | CARRIER | Accepting/declining an assigned load |
| `compliance.manage` | BROKER, CARRIER | CRUD on carrier compliance records |
| `audit.view` | BROKER, CARRIER | Reading the audit log viewer |

The first seven are the brief's mandated catalog, verbatim. The last three (`load.accept_decline`, `compliance.manage`, `audit.view`) are additions the brief's own examples require — the brief describes a Carrier "Dispatch" role that accepts/declines, a carrier-compliance CRUD feature, and an audit-log viewer, none of which are expressible with the seven. They are documented as additions in the README, not smuggled in.

**Shippers have no roles and no permissions.** Their access is defined entirely by object-level scoping: they see loads where `load.shipperOrgId === session.orgId`, read-only. This is a deliberate modelling choice (brief: *"Shipper … no sub-roles"*), and the permission engine is never consulted for them.

### The three layers of access control

Every API request passes through all three. They are independent and all are enforced **server-side**:

1. **Authentication** — a valid session cookie resolving to a live session row.
2. **Permission** — `can(session, permission)` against the union of the user's roles. Failure → `403` + a `DENIED` audit row.
3. **Scope** — org-level and object-level. Failure → `404` (not `403`: we do not confirm the existence of records you may not see).

| Actor | Scope rule |
|---|---|
| Broker staff | Loads where `brokerOrgId === session.orgId`. Carrier compliance records: readable for any carrier (they must vet carriers), writable with `compliance.manage`. |
| Carrier staff | Loads where `carrierOrgId === session.orgId` **and** the load has actually been assigned to them. They never see the marketplace or other carriers' loads. Their own compliance record only. |
| Shipper | Loads where `shipperOrgId === session.orgId`. Read-only. No staff, no roles. |

Org scoping is applied **before and independently of** permissions: a Carrier user holding a hypothetical `load.create` permission still cannot touch a Broker's load, because the scope filter excludes it. Permissions can never widen scope.

---

## 2. Bootstrap & identity

| Path | Who | How |
|---|---|---|
| **Org bootstrap** | First Broker/Carrier Admin | Public `/signup` → creates the **Org** *and* its first user in one transaction. That user is granted the auto-created `isSystem` "Organization Administrator" role (all permissions for that org type). This is the only way an org comes into existence. |
| **Staff** | Broker/Carrier staff | **Cannot self-signup.** An admin (`staff.manage`) issues an **Invite** (token, email, pre-selected roles, 7-day expiry). The invitee opens `/invite/<token>`, sets a password, and is created inside that org with exactly the roles on the invite. |
| **Shipper** | Individual/business | Public `/signup` as a Shipper. Creates a `SHIPPER`-type org with a single user and no roles. |

Sessions are **database-backed** (a `Session` row + an `HttpOnly`, `SameSite=Lax` cookie holding the session id). DB-backed rather than a stateless JWT so that revoking a staff member's access — or an admin editing a role — takes effect on the *next request*, not whenever a token happens to expire. Passwords are `scrypt` (Node `crypto`, per-user random salt) — no native dependency to break the judges' `npm install`.

---

## 3. Data model

SQLite via Prisma. **SQLite has no native enum and no array type** — every enum-ish column is a `String` narrowed by a TypeScript union + a Zod schema, and every list is a child table or a JSON string column with a Zod parse at the boundary. The TS types are the enforcement layer.

```
Org (BROKER | CARRIER | SHIPPER)
 ├─ User ──< UserRole >── Role ──< RolePermission >── (permission key)
 ├─ Invite
 └─ CarrierCompliance (1:1, CARRIER orgs only)

Load
 ├─ shipperOrg  (who owns the freight)
 ├─ brokerOrg   (who brokered it)
 ├─ carrierOrg  (who hauls it — nullable until assigned)
 ├─< RateConfirmation  (versioned; load points at the one actually confirmed)
 ├─< ComplianceFlag    (open flags block progression)
 ├─< ProofOfDelivery
 └─< AuditLog          (the load's timeline)
```

### Load state machine

```
                          ┌────────────── carrier declines ──────────────┐
                          ▼                                              │
POSTED ──assign──► CARRIER_ASSIGNED ──rate.confirm──► RATE_CONFIRMED ──► DISPATCHED
                          │  ▲                                                │
                     [COMPLIANCE GATE]                                        ▼
                          │                                              IN_TRANSIT
                          │                                                   │
CANCELLED ◄── (any state before DISPATCHED)                                   ▼
                                                                          DELIVERED
                                                                              │
                                                              [POD required]  ▼
                                    CLOSED ◄── INVOICED ◄────────────── POD_VERIFIED
```

Each transition is a row in a declarative table (`src/lib/loads/state-machine.ts`) carrying: `from`, `to`, the **required permission**, the **actor org type**, and **guards**. Nothing may transition a load except through this table.

| From | To | Permission | Actor | Guards |
|---|---|---|---|---|
| POSTED | CARRIER_ASSIGNED | `load.assign_carrier` | BROKER | carrier exists; compliance evaluated on entry |
| CARRIER_ASSIGNED | POSTED | `load.accept_decline` | CARRIER | carrier declined → carrier is unassigned, flags cleared |
| CARRIER_ASSIGNED | RATE_CONFIRMED | `rate.confirm` | BROKER | **no OPEN compliance flags**; carrier accepted; a confirmed rate version exists |
| RATE_CONFIRMED | DISPATCHED | `load.update_status` | BROKER | **no OPEN compliance flags** |
| DISPATCHED | IN_TRANSIT | `load.update_status` | CARRIER | — |
| IN_TRANSIT | DELIVERED | `load.update_status` | CARRIER | — |
| DELIVERED | POD_VERIFIED | `load.update_status` | BROKER | **a POD has been uploaded** |
| POD_VERIFIED | INVOICED | `load.update_status` | BROKER | — |
| INVOICED | CLOSED | `load.update_status` | BROKER | — |
| any pre-DISPATCHED | CANCELLED | `load.create` | BROKER | — |

**The compliance gate is the heart of the brief.** A load cannot move past `CARRIER_ASSIGNED` while it has an OPEN `ComplianceFlag`. The only ways forward are (a) the carrier's compliance record is fixed, and re-evaluation resolves the flag, or (b) a user with `load.override_compliance_flag` overrides it *with a written reason*, which is recorded in the audit trail forever.

### Compliance evaluation

Runs on: carrier assignment, any edit to a carrier's compliance record (re-evaluates **every** affected non-terminal load), and load edits that change equipment/commodity. Produces flags:

| Code | Raised when |
|---|---|
| `INSURANCE_EXPIRED` | `insuranceExpiry < today` |
| `INSURANCE_EXPIRING_SOON` | expiry within 30 days — **warning, non-blocking** (drives the renewal-alerts feature) |
| `AUTHORITY_INACTIVE` | MC/DOT `authorityStatus !== ACTIVE` |
| `EQUIPMENT_NOT_APPROVED` | load's equipment not in carrier's approved equipment |
| `COMMODITY_NOT_APPROVED` | load's commodity not in carrier's approved commodities |
| `CARGO_INSURANCE_INSUFFICIENT` | cargo coverage < load's declared value |
| `NO_COMPLIANCE_RECORD` | carrier has no compliance record at all |

Flag lifecycle: `OPEN` → `RESOLVED` (the underlying fact was fixed) or `OVERRIDDEN` (a human with the permission accepted the risk, on the record). Only `OPEN` blocks.

### Rate confirmation versioning

`RateConfirmation` rows are **immutable once confirmed** and carry `(loadId, version)` — v1, v2, v3… A rate is a base rate plus a list of accessorials (`{code, label, amount}`), and a computed total.

* Confirming a new version marks the previous `CONFIRMED` one `SUPERSEDED` and repoints `Load.confirmedRateConfirmationId`.
* **`Load.confirmedRateConfirmationId` is the load's memory of what was actually agreed.** Once a load is `DISPATCHED`, no new versions may be created — the agreement is frozen. Old loads therefore keep the exact version that was confirmed for them, which is the brief's requirement, and the full version history stays readable.

### Audit trail — one spine for everything

A single `AuditLog` table records **business events and denied access attempts alike**:

`{ ts, actorUserId, actorOrgId, action, entityType, entityId, loadId?, outcome: ALLOWED|DENIED, permission?, fromStatus?, toStatus?, detail(JSON), ip, method, path }`

* A load's timeline = `AuditLog where loadId = X` → attributed and timestamped, satisfying the brief's audit requirement.
* A permission denial = `outcome: DENIED` with the permission that was missing → satisfies *"log permission-denied attempts"*, and is **queryable in the audit viewer**, not just dumped to a console.
* Denials are also written to stderr via the app logger, so `npm run dev` shows them live during the demo.

---

## 4. Layout

```
src/
├─ app/
│  ├─ (public)/       login, signup, invite/[token]
│  ├─ broker/         load board, load detail, compliance, staff+roles, audit
│  ├─ carrier/        assigned loads, status actions, POD, compliance, staff+roles, audit
│  ├─ shipper/        own loads (read-only)
│  └─ api/            REST — the enforcement boundary; curl-able
├─ lib/
│  ├─ auth/           password, session, bootstrap
│  ├─ authz/          permissions catalog, can(), requirePermission(), scope filters
│  ├─ loads/          state-machine, service
│  ├─ compliance/     evaluator
│  └─ audit/          logger
└─ generated/prisma/  (gitignored, generated)
```

**The API layer is the enforcement boundary.** UI pages call the same service functions the API routes call; both go through `requirePermission`. Hiding a button is a courtesy, never a control — every mutation is re-checked server-side, and `docs/RBAC-PROOF.md` contains curl commands demonstrating a lower-privileged account being blocked at the API even when it forges the request by hand.
