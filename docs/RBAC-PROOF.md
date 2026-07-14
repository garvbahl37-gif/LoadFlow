# RBAC proof — enforcement is in the API, not the UI

> *"API-layer enforcement mandatory — not just UI hiding. A lower-privileged account hitting a restricted endpoint directly must be blocked."*

Hiding a button proves nothing. Everything below is a raw HTTP request with a session cookie, exactly as an attacker holding a valid login would send it. **No UI is involved.**

Run the whole thing automatically:

```bash
npm run dev          # terminal 1
npm run rbac:proof   # terminal 2  → 24 assertions, exits non-zero on any failure
```

Or reproduce it by hand with `curl`. Start the server, then:

```bash
BASE=http://localhost:3000

# Sign in as the Dispatcher and keep the session cookie.
login() { curl -s -c "/tmp/$1.jar" -X POST "$BASE/api/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"loadflow\"}" > /dev/null; }

as() { curl -s -b "/tmp/$1.jar" -w '\n→ HTTP %{http_code}\n' "${@:2}"; }

login dispatch@meridian.com
login ops@meridian.com
login billing@meridian.com
login admin@meridian.com
login driver@ironline.com
login admin@ironline.com
login shipper@cascade.com
```

---

## 1. A user without the permission is refused — even though the UI would never show them the button

`billing@meridian.com` is a **Billing Clerk**: a real role, with **zero** permissions. They can read the board (that's scope, not permission). They can do nothing else.

```bash
as billing@meridian.com -X POST "$BASE/api/loads" \
  -H 'content-type: application/json' \
  -d '{"commodity":"Produce"}'
```
```
{"error":"Permission denied: you do not have \"load.create\".","detail":{"permission":"load.create"}}
→ HTTP 403
```

Same account, the staff endpoint:

```bash
as billing@meridian.com "$BASE/api/staff"
```
```
{"error":"Permission denied: you do not have \"staff.manage\".", ...}
→ HTTP 403
```

## 2. Two people in the same org, on the same load, with different bundles

The Dispatcher and the Ops Lead differ by exactly one permission: `load.override_compliance_flag`.

```bash
# Find the blocked load and its open flag (as an admin who can see both).
LOAD=$(as admin@meridian.com "$BASE/api/loads" | grep -o '"id":"[^"]*","reference":"LF-1043"' | cut -d'"' -f4)
FLAG=$(as admin@meridian.com "$BASE/api/loads/$LOAD" | python3 -c \
  'import sys,json;d=json.load(sys.stdin);print(next(f["id"] for f in d["load"]["complianceFlags"] if f["status"]=="OPEN"))')

# Dispatcher tries to override →  REFUSED
as dispatch@meridian.com -X POST "$BASE/api/loads/$LOAD/flags/$FLAG/override" \
  -H 'content-type: application/json' \
  -d '{"reason":"I would simply like to dispatch this load anyway."}'
```
```
{"error":"Permission denied: you do not have \"load.override_compliance_flag\".", ...}
→ HTTP 403
```
```bash
# Ops Lead overrides the SAME flag on the SAME load →  ALLOWED
as ops@meridian.com -X POST "$BASE/api/loads/$LOAD/flags/$FLAG/override" \
  -H 'content-type: application/json' \
  -d '{"reason":"Carrier emailed a binder for the renewed policy; broker accepts the risk."}'
```
```
{"overridden":true, ...}
→ HTTP 200
```

The same asymmetry exists **inside a carrier**: `driver@ironline.com` holds `load.update_status` + `pod.upload`; `dispatch@ironline.com` holds `load.accept_decline`. Each is refused the other's endpoints — on a load where the transition is otherwise perfectly legal, so a 403 can only mean the permission was refused.

## 3. The compliance gate outranks every permission

`admin@meridian.com` holds **all ten** broker permissions. It still cannot move a load the gate has stopped:

```bash
LOAD=$(as admin@meridian.com "$BASE/api/loads" | grep -o '"id":"[^"]*","reference":"LF-1044"' | cut -d'"' -f4)

as admin@meridian.com -X POST "$BASE/api/loads/$LOAD/transition" \
  -H 'content-type: application/json' \
  -d '{"to":"RATE_CONFIRMED"}'
```
```
{"error":"This load has an unresolved compliance flag. Fix the carrier's compliance
          record, or override the flag with a documented reason.", ...}
→ HTTP 409
```

Permissions govern what you may **do**. They do not govern what is **safe**. Those are different questions and the code treats them that way.

## 4. One org cannot reach into another — and gets a 404, not a 403

Scope is `AND`ed into every query, independently of permissions.

```bash
# Ironline's driver asks for a load tendered to Redline.
REDLINE_LOAD=$(as admin@meridian.com "$BASE/api/loads" | grep -o '"id":"[^"]*","reference":"LF-1043"' | cut -d'"' -f4)

as driver@ironline.com "$BASE/api/loads/$REDLINE_LOAD"
```
```
{"error":"Load not found."}
→ HTTP 404
```

**404, deliberately — not 403.** A 403 would confirm the load exists. A carrier fishing for its competitors' load IDs learns nothing. The attempt is still audited as `SCOPE_DENIED`.

The same holds for shippers: `shipper@cascade.com` gets a 404 for a Northgate load, and a 200 for its own. And a carrier hitting a broker-only endpoint is refused outright:

```bash
as admin@ironline.com -X POST "$BASE/api/loads" -H 'content-type: application/json' -d '{}'
```
```
→ HTTP 403
```

## 5. You cannot grant yourself a permission your org type cannot hold

The role builder never *offers* a carrier admin the broker-only `load.create`. The API refuses it anyway — the UI's filtering is not the control:

```bash
as admin@ironline.com -X POST "$BASE/api/roles" \
  -H 'content-type: application/json' \
  -d '{"name":"Trojan Role","permissionKeys":["load.create","load.override_compliance_flag"]}'
```
```
{"error":"Validation failed.", "detail":{ ... "not applicable to a CARRIER organization" }}
→ HTTP 422
```

And even if such a row *were* forged directly into the database, `can()` applies a second, independent org-type lock — so it still would not grant anything. There's a unit test for exactly that (`tests/authz.test.ts`).

## 6. An org cannot lock itself out

```bash
ME=$(as admin@meridian.com "$BASE/api/staff" | python3 -c \
  'import sys,json;print(next(u["id"] for u in json.load(sys.stdin)["staff"] if u["email"]=="admin@meridian.com"))')

as admin@meridian.com -X PATCH "$BASE/api/staff/$ME" \
  -H 'content-type: application/json' -d '{"roleIds":[]}'
```
```
{"error":"That change would leave nobody able to manage staff and roles.", ...}
→ HTTP 409
```

## 7. Every refusal above was recorded

Denials are **audit rows**, not console noise — so an ops lead can review them, filter them, and see exactly which permission was missing.

```bash
as admin@meridian.com "$BASE/api/audit?outcome=DENIED"
```
```json
{
  "entries": [
    {
      "ts": "…",
      "actorEmail": "dispatch@meridian.com",
      "action": "PERMISSION_DENIED",
      "outcome": "DENIED",
      "permission": "load.override_compliance_flag",
      "summary": "Blocked: dispatch@meridian.com attempted an action requiring
                  \"load.override_compliance_flag\" without holding it.",
      "detail": { "roles": ["Dispatcher"], "heldPermissions": [ … ] }
    }
  ],
  "facets": { "deniedCount": 5, … }
}
```

They're visible in the UI too — **Audit log → "Denied attempts only"** — with the missing permission key rendered in monospace on each row.

---

## Where this is enforced

One function, called by every mutating route:

```ts
// src/lib/authz/guard.ts
export function can(session: SessionUser, permission: PermissionKey): boolean {
  const def = PERMISSION_BY_KEY[permission];
  if (!def) return false;

  // Lock 1 — does this permission even apply to their org type?
  if (session.orgType === "BROKER"  && !def.forBroker)  return false;
  if (session.orgType === "CARRIER" && !def.forCarrier) return false;
  if (session.orgType === "SHIPPER") return false;   // shippers hold nothing, ever

  // Lock 2 — do they actually hold it, across all their roles?
  return session.permissions.includes(permission);
}
```

Note what it never does: **it never looks at a role's name.** `tests/no-role-names.test.ts` greps the entire source tree and fails the build if any conditional does.
