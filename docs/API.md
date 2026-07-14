# LoadFlow REST API — the enforcement boundary

Every mutation in the product goes through these routes. The UI is a client of this
API and has no privileged path around it. **This is the contract**: the API agents
implement it, the UI agents consume it.

Auth is a session cookie (`lf_session`, HttpOnly). Errors are always
`{ "error": string, "detail"?: unknown }` with the status codes from
`src/lib/api/http.ts`:

| Code | Meaning |
|---|---|
| 401 | not signed in |
| 403 | signed in, but missing the required permission (writes a `DENIED` audit row) |
| 404 | out of scope — we never confirm the existence of a record you may not see |
| 409 | illegal state transition, or blocked by the compliance gate |
| 422 | validation failed (`{ error, detail: { fieldErrors } }`) |

Every route must: `requireSession()` → `authorize(session, permission)` → apply the
**scope filter** → act → `audit(...)`. Skipping any step is a bug.

---

## Auth & bootstrap

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | — | `{email,password}` → `{user, home}`, sets cookie. 401 on bad creds (never say *which* field was wrong). |
| POST | `/api/auth/logout` | — | Deletes the session row and clears the cookie. |
| POST | `/api/auth/signup` | — | `signupSchema` from `lib/auth/bootstrap`. Creates **org + founding admin**. Signs them in. |
| GET | `/api/auth/me` | — | Current session (incl. `permissions`), or 401. |
| GET | `/api/invites/[token]` | — (public) | `previewInvite` — safe summary for the accept page. |
| POST | `/api/invites/[token]/accept` | — (public) | `{password}` → creates the user with the invite's roles, signs them in. |
| POST | `/api/invites` | `staff.manage` | `{name,email,roleIds[]}` → `{invite, acceptUrl}`. Returns the link (no mail server in a hackathon). |
| GET | `/api/invites` | `staff.manage` | Pending invites for **your org only**. |
| POST | `/api/invites/[token]/revoke` | `staff.manage` | Must belong to your org, else 404. |

## Loads

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/loads` | — (scope only) | Filters: `?q=` (ref/lane/commodity), `?status=`, `?carrierOrgId=`, `?flagged=true`. **Always** ANDed with `loadScope(session)`. |
| POST | `/api/loads` | `load.create` | Broker only. Auto-generates `reference` (`LF-####`). |
| GET | `/api/loads/[id]` | — (scope only) | Detail + flags + rate versions + POD metadata + `availableTransitions` for *this* session. |
| PATCH | `/api/loads/[id]` | `load.create` | Editable only while `POSTED`/`CARRIER_ASSIGNED`; changing equipment/commodity **re-runs `evaluateLoad`**. |
| POST | `/api/loads/[id]/assign` | `load.assign_carrier` | `{carrierOrgId}` → `assignCarrier()`. Returns the compliance evaluation, so the UI can say *"tendered, but blocked"* in one round trip. |
| POST | `/api/loads/[id]/transition` | *from the transition table* | `{to, note?}` → `transitionLoad()`. **Never accept a permission from the client** — look it up in `TRANSITIONS`. |
| POST | `/api/loads/[id]/respond` | `load.accept_decline` | `{accept: boolean}` → `respondToTender()`. |
| POST | `/api/loads/[id]/flags/[flagId]/override` | `load.override_compliance_flag` | `{reason}` (≥10 chars) → `overrideFlag()`. |
| GET | `/api/loads/[id]/audit` | — (scope only) | That load's timeline, newest first. |

## Rates

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/loads/[id]/rates` | — (scope only) | All versions, newest first. |
| POST | `/api/loads/[id]/rates` | `rate.confirm` | `rateInputSchema` → `confirmRate()`. Creates **v(N+1)**, supersedes the old one, repoints `Load.confirmedRate`. 409 once dispatched. |

## Proof of delivery

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/api/loads/[id]/pod` | `pod.upload` | `multipart/form-data`: `file` (+ optional `notes`). Accept PNG/JPEG/WebP/PDF, **max 5 MB**. Bytes go in SQLite. Carrier must be the one assigned. |
| GET | `/api/pods/[podId]/file` | — (scope only) | Streams the bytes with the right `Content-Type`. Resolve the POD **through its load's scope filter** — a rival carrier guessing a POD id must get a 404. |

## Carriers & compliance

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/carriers` | — | Broker: every carrier org + compliance summary (they must vet carriers). Carrier: **only itself**. Shipper: 403. |
| GET | `/api/carriers/[orgId]/compliance` | — | Broker: any carrier. Carrier: only its own `orgId`, else 404. |
| PUT | `/api/carriers/[orgId]/compliance` | `compliance.manage` | Upsert. **Must call `reevaluateCarrier()`** afterwards — fixing insurance has to unblock that carrier's live loads with no further clicks, and letting it lapse has to stop them. Return `{ compliance, reevaluated: n }`. |
| GET | `/api/compliance/alerts` | — | Expired + expiring-within-30-days. Broker: all carriers. Carrier: own. Drives the dashboard alert strip. |

## RBAC administration

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/permissions` | `staff.manage` | The catalog filtered by **your org type** — a carrier admin must never even be *offered* `load.create`. |
| GET | `/api/roles` | `staff.manage` | Your org's roles + their permissions + member counts. |
| POST | `/api/roles` | `staff.manage` | `{name, description?, permissionKeys[]}`. **Reject any key not applicable to your org type (422)** — defence in depth behind the UI filter. |
| PATCH | `/api/roles/[id]` | `staff.manage` | Rename / re-bundle permissions. **409 if `isSystem`.** Must belong to your org, else 404. |
| DELETE | `/api/roles/[id]` | `staff.manage` | 409 if `isSystem` or if any user still holds it. |
| GET | `/api/staff` | `staff.manage` | Your org's users, their roles, and their effective permissions. |
| PATCH | `/api/staff/[userId]` | `staff.manage` | `{roleIds?, status?}`. **409 if this would leave the org with no active holder of `staff.manage`** — an org must never lock itself out. Must be in your org, else 404. |

## Audit

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/api/audit` | `audit.view` | **Scoped to `actorOrgId === session.orgId`.** Filters: `?outcome=DENIED`, `?loadId=`, `?action=`, `?q=`, `?limit=` (default 100, max 500). Newest first. |

---

## Reference implementation — copy this shape exactly

```ts
// src/app/api/loads/[id]/transition/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { LoadStatus } from "@/generated/prisma/enums";
import { handler, parseBody } from "@/lib/api/http";
import { requestMeta } from "@/lib/audit/log";
import { requireSession } from "@/lib/authz/guard";
import { transitionLoad } from "@/lib/loads/service";

const bodySchema = z.object({
  to: z.enum(LoadStatus),
  note: z.string().max(300).optional(),
});

//                                            params is a PROMISE in Next 16
export const POST = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const meta = requestMeta(req);
  const session = await requireSession();          // 401 if absent
  const body = await parseBody(req, bodySchema);   // 422 if malformed

  // transitionLoad() does the rest: scope check (404), permission lookup from the
  // TRANSITION TABLE + authorize() (403 + DENIED audit row), guard evaluation
  // including the compliance gate (409), the write, and the ALLOWED audit row.
  const load = await transitionLoad(session, id, body.to, meta, body.note);

  return NextResponse.json({ load });
});
```

Rules that are not negotiable:

1. **`await ctx.params`.** It is a Promise in Next 16.
2. **Never trust a permission, org id, or actor sent by the client.** Derive everything from the session.
3. **Never hand-roll a status change.** Call `transitionLoad()`; it is the only thing allowed to write `Load.status`.
4. **Never skip the scope filter.** Use `loadInScopeOrThrow()` / `loadScope()`.
5. Do not write `export const dynamic = "force-dynamic"` — route handlers are already dynamic.
