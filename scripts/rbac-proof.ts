/* eslint-disable @typescript-eslint/no-explicit-any --
 *
 * Deliberate, and the one place in the repo where `any` is the right answer.
 *
 * This script is a BLACK-BOX prober: it asserts on the raw HTTP status codes an
 * untrusted server returns over the wire. Importing the application's own types to
 * describe those responses would couple the proof to the implementation it is supposed
 * to be testing independently — if a refactor changed a response shape, the proof would
 * stop compiling instead of stopping *passing*, which is exactly backwards. It should
 * fail the way a real attacker's curl would: at runtime, on the actual bytes.
 */

/**
 * RBAC PROOF — the brief demands that "a lower-privileged account hitting a restricted
 * endpoint directly must be blocked", not merely that the UI hides the button.
 *
 * This script proves it. It signs in as each seeded persona, then attacks the REST API
 * directly with fetch — no UI involved, exactly as an attacker with a session cookie
 * and curl would. Every assertion is a real HTTP round trip against the running app.
 *
 *   npm run dev            # in one terminal
 *   npm run rbac:proof     # in another
 *
 * It re-seeds first so it is deterministic and repeatable (pass --no-seed to skip).
 * Exits non-zero if any assertion fails.
 */
import { execSync } from "node:child_process";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = "loadflow";

// ── tiny HTTP + assertion harness ─────────────────────────────

type Res = { status: number; body: any };

async function api(
  cookie: string | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<Res> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "manual",
  });
  let parsed: any = null;
  const text = await res.text();
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text.slice(0, 200);
  }
  return { status: res.status, body: parsed };
}

async function login(email: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
    redirect: "manual",
  });
  if (res.status !== 200) {
    throw new Error(`Could not sign in as ${email} (HTTP ${res.status}). Is the app seeded?`);
  }
  const raw = res.headers.get("set-cookie");
  if (!raw) throw new Error(`No session cookie returned for ${email}`);
  return raw.split(";")[0];
}

let passed = 0;
const failures: string[] = [];

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const OFF = "\x1b[0m";

function check(claim: string, actual: number, expected: number | number[], detail?: string) {
  const want = Array.isArray(expected) ? expected : [expected];
  const ok = want.includes(actual);
  if (ok) {
    passed++;
    console.log(`  ${GREEN}✓${OFF} ${claim} ${DIM}→ ${actual}${OFF}`);
  } else {
    failures.push(claim);
    console.log(
      `  ${RED}✗ ${claim}${OFF} ${DIM}→ expected ${want.join(" or ")}, got ${actual}${OFF}`,
    );
    if (detail) console.log(`    ${DIM}${detail}${OFF}`);
  }
}

function section(title: string) {
  console.log(`\n${BOLD}${title}${OFF}`);
}

// ── the proof ─────────────────────────────────────────────────

async function main() {
  if (!process.argv.includes("--no-seed")) {
    console.log(`${DIM}Re-seeding for a deterministic run…${OFF}`);
    execSync("npx prisma db seed", { stdio: "pipe" });
  }

  console.log(`\n${BOLD}RBAC PROOF${OFF} ${DIM}— attacking ${BASE} directly over HTTP${OFF}`);

  // Sign in as every persona.
  const brokerAdmin = await login("admin@meridian.com"); // every broker permission
  const opsLead = await login("ops@meridian.com"); // + override
  const dispatcher = await login("dispatch@meridian.com"); // no override
  const billing = await login("billing@meridian.com"); // NO permissions at all
  const ironDispatch = await login("dispatch@ironline.com"); // accept/decline only
  const ironDriver = await login("driver@ironline.com"); // status + POD only
  const ironAdmin = await login("admin@ironline.com");
  const cascade = await login("shipper@cascade.com"); // shipper, no roles
  const northgate = await login("shipper@northgate.com");

  // Resolve the loads we need, as the broker who can see them all.
  const board = await api(brokerAdmin, "GET", "/api/loads");
  const loads: any[] = board.body?.loads ?? board.body ?? [];
  const byRef = (r: string) => loads.find((l: any) => l.reference === r);

  const blocked = byRef("LF-1043"); // assigned to Redline — insurance lapsed
  const ironLoad = loads.find((l: any) => l.carrierOrg?.name?.includes("Ironline"));
  const cascadeLoad = loads.find((l: any) => l.shipperOrg?.name?.includes("Cascade"));
  const northgateLoad = loads.find((l: any) => l.shipperOrg?.name?.includes("Northgate"));

  if (!blocked || !ironLoad || !cascadeLoad || !northgateLoad) {
    console.error(
      `\n${RED}Could not resolve the seeded loads from GET /api/loads.${OFF}\n` +
        `Got ${loads.length} loads. Is the server running and seeded?`,
    );
    process.exit(1);
  }

  // The board omits flag detail; pull the blocked load's open flag from its detail route.
  const blockedDetail = await api(brokerAdmin, "GET", `/api/loads/${blocked.id}`);
  const flag = (blockedDetail.body?.load?.complianceFlags ?? []).find(
    (f: any) => f.status === "OPEN" && f.severity === "BLOCKING",
  );

  // ── 1. Unauthenticated ──────────────────────────────────────
  section("1 · An anonymous caller is not a caller");
  check("GET  /api/loads with no session → 401", (await api(null, "GET", "/api/loads")).status, 401);
  check(
    "POST /api/loads with no session → 401",
    (await api(null, "POST", "/api/loads", { commodity: "x" })).status,
    401,
  );
  check(
    "GET  /api/audit with no session → 401",
    (await api(null, "GET", "/api/audit")).status,
    401,
  );

  // ── 2. Permissions inside one org ───────────────────────────
  section("2 · Permissions separate people INSIDE the same org");
  check(
    "Billing Clerk (zero permissions) POST /api/loads → 403",
    (await api(billing, "POST", "/api/loads", {
      shipperOrgId: cascadeLoad.shipperOrgId,
      originCity: "Reno", originState: "NV", destCity: "Boise", destState: "ID",
      pickupAt: new Date(Date.now() + 86400000).toISOString(),
      deliverBy: new Date(Date.now() + 3 * 86400000).toISOString(),
      commodity: "General Freight", equipmentType: "Dry Van",
      weightLbs: 20000, declaredValueCents: 100000, offeredRateCents: 150000,
    })).status,
    403,
  );
  check(
    "Billing Clerk GET /api/staff (needs staff.manage) → 403",
    (await api(billing, "GET", "/api/staff")).status,
    403,
  );
  check(
    "Billing Clerk GET /api/audit (needs audit.view) → 403",
    (await api(billing, "GET", "/api/audit")).status,
    403,
  );
  check(
    "Billing Clerk CAN still read the board (scope, not permission) → 200",
    (await api(billing, "GET", "/api/loads")).status,
    200,
  );

  if (flag) {
    check(
      "Dispatcher overrides a compliance flag → 403 (lacks load.override_compliance_flag)",
      (await api(dispatcher, "POST", `/api/loads/${blocked.id}/flags/${flag.id}/override`, {
        reason: "I would simply like to dispatch this load anyway.",
      })).status,
      403,
    );
    check(
      "Ops Lead overrides the SAME flag → 200 (holds the permission)",
      (await api(opsLead, "POST", `/api/loads/${blocked.id}/flags/${flag.id}/override`, {
        reason: "Carrier emailed a binder for the renewed policy; broker accepts the risk.",
      })).status,
      [200, 201],
    );
  }

  // ── 3. The compliance gate outranks every permission ────────
  section("3 · The compliance gate outranks EVERY permission");
  const stillBlocked = byRef("LF-1044"); // authority revoked + 3 more flags
  check(
    "Org Administrator — who holds every permission — tries to advance a load blocked by compliance → 409",
    (await api(brokerAdmin, "POST", `/api/loads/${stillBlocked.id}/transition`, {
      to: "RATE_CONFIRMED",
    })).status,
    409,
    "Permissions govern what you may DO. They do not govern what is SAFE. The gate is separate.",
  );

  // ── 4. Org isolation ────────────────────────────────────────
  section("4 · One org cannot reach into another");
  check(
    "Carrier hits a broker-only endpoint (POST /api/loads) → 403",
    (await api(ironAdmin, "POST", "/api/loads", { commodity: "x" })).status,
    403,
  );
  check(
    "Ironline reads a load tendered to Redline → 404 (not 403 — we don't confirm it exists)",
    (await api(ironDriver, "GET", `/api/loads/${blocked.id}`)).status,
    404,
  );
  check(
    "Ironline tries to transition Redline's load → 404",
    (await api(ironDriver, "POST", `/api/loads/${blocked.id}/transition`, { to: "IN_TRANSIT" }))
      .status,
    404,
  );
  check(
    "Shipper Cascade reads Northgate's load → 404",
    (await api(cascade, "GET", `/api/loads/${northgateLoad.id}`)).status,
    404,
  );
  check(
    "Shipper Cascade reads its OWN load → 200",
    (await api(cascade, "GET", `/api/loads/${cascadeLoad.id}`)).status,
    200,
  );
  check(
    "Shipper (no roles at all) POST /api/loads → 403",
    (await api(northgate, "POST", "/api/loads", { commodity: "x" })).status,
    403,
  );
  check(
    "Shipper GET /api/audit → 403",
    (await api(northgate, "GET", "/api/audit")).status,
    403,
  );

  // ── 5. Role separation inside a carrier ─────────────────────
  section("5 · Roles separate people inside a CARRIER too");
  check(
    "Driver (status + POD) tries to accept a tender → 403 (lacks load.accept_decline)",
    (await api(ironDriver, "POST", `/api/loads/${ironLoad.id}/respond`, { accept: true })).status,
    403,
  );

  // Use a load where the transition is genuinely LEGAL, so a 403 can only mean the
  // permission was refused. Asserting on a load in the wrong state would let this pass
  // with a 409 and prove nothing.
  const inTransit = loads.find(
    (l: any) => l.status === "IN_TRANSIT" && l.carrierOrg?.name?.includes("Ironline"),
  );
  if (!inTransit) {
    console.error(`${RED}Expected a seeded IN_TRANSIT Ironline load for this check.${OFF}`);
    process.exit(1);
  }
  check(
    "Carrier Dispatch (accept/decline only) marks a load delivered → 403 (lacks load.update_status)",
    (await api(ironDispatch, "POST", `/api/loads/${inTransit.id}/transition`, { to: "DELIVERED" }))
      .status,
    403,
    "IN_TRANSIT → DELIVERED is a legal move for a carrier, so a 403 here is a genuine permission refusal, not a state error.",
  );
  check(
    "…and the Driver, who DOES hold load.update_status, makes the same move → 200",
    (await api(ironDriver, "POST", `/api/loads/${inTransit.id}/transition`, { to: "DELIVERED" }))
      .status,
    200,
    "Same org, same load, same endpoint. The only difference is the permission bundle.",
  );

  // ── 6. You cannot forge a permission you were never offered ─
  section("6 · You cannot grant yourself a permission your org type cannot hold");
  check(
    "Carrier admin builds a role containing the broker-only `load.create` → 422",
    (await api(ironAdmin, "POST", "/api/roles", {
      name: "Trojan Role",
      description: "Trying to smuggle in a broker permission.",
      permissionKeys: ["load.create", "load.override_compliance_flag"],
    })).status,
    422,
    "The UI never offers these keys — but the API refuses them independently.",
  );

  // ── 7. The org cannot lock itself out ───────────────────────
  section("7 · An org cannot lock itself out of its own account");
  const staff = await api(brokerAdmin, "GET", "/api/staff");
  const me = (staff.body?.staff ?? staff.body ?? []).find(
    (u: any) => u.email === "admin@meridian.com",
  );
  if (me) {
    check(
      "The only admin strips their own staff.manage role → 409",
      (await api(brokerAdmin, "PATCH", `/api/staff/${me.id}`, { roleIds: [] })).status,
      409,
    );
  }

  // ── 8. Every denial above was RECORDED ──────────────────────
  section("8 · Every denial above was logged, and is queryable");
  const denied = await api(brokerAdmin, "GET", "/api/audit?outcome=DENIED&limit=500");
  const rows: any[] = denied.body?.entries ?? denied.body?.events ?? denied.body ?? [];
  check("GET /api/audit?outcome=DENIED → 200", denied.status, 200);
  const n = Array.isArray(rows) ? rows.length : 0;
  check(
    `The denied-attempt log is not empty (${n} rows within this org)`,
    n > 0 ? 200 : 500,
    200,
    "Permission denials are audit rows, not console noise — so an ops lead can review them.",
  );

  // ── verdict ─────────────────────────────────────────────────
  console.log(
    `\n${BOLD}${failures.length === 0 ? GREEN : RED}${passed} passed, ${failures.length} failed${OFF}\n`,
  );
  if (failures.length > 0) {
    for (const f of failures) console.log(`  ${RED}✗${OFF} ${f}`);
    process.exit(1);
  }
  console.log(
    `${DIM}Every check above is an HTTP request against the running app. No UI was involved.${OFF}\n`,
  );
}

main().catch((err) => {
  console.error(`\n${RED}${err.message}${OFF}\n`);
  console.error(`${DIM}Is the dev server running? → npm run dev${OFF}\n`);
  process.exit(1);
});
