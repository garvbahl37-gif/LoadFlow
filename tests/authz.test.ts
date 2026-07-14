/**
 * Unit tests for the three pieces of logic the brief is actually graded on:
 * the permission engine, the state machine, and the compliance gate.
 *
 * Pure functions, no database, no server. Run: `npm test`
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SessionUser } from "../src/lib/auth/session";
import { can } from "../src/lib/authz/guard";
import { PERMISSIONS, permissionsForOrgType } from "../src/lib/authz/permissions";
import { evaluate, EXPIRY_WARNING_DAYS } from "../src/lib/compliance/evaluator";
import {
  availableTransitions,
  checkTransition,
  type TransitionFacts,
} from "../src/lib/loads/state-machine";

// ── fixtures ──────────────────────────────────────────────────

function session(over: Partial<SessionUser> = {}): SessionUser {
  return {
    sessionId: "s1",
    userId: "u1",
    email: "user@example.com",
    name: "Test User",
    orgId: "org1",
    orgName: "Test Org",
    orgType: "BROKER",
    roles: [],
    permissions: [],
    ...over,
  };
}

function facts(over: Partial<TransitionFacts> = {}): TransitionFacts {
  return {
    status: "CARRIER_ASSIGNED",
    carrierOrgId: "carrier1",
    carrierResponse: "ACCEPTED",
    openBlockingFlags: 0,
    hasConfirmedRate: true,
    hasPod: false,
    ...over,
  };
}

const days = (n: number) => new Date(Date.now() + n * 86_400_000);

const compliantCarrier = {
  insuranceExpiry: days(200),
  cargoInsuranceCents: 100_000_00,
  authorityStatus: "ACTIVE",
  approvedEquipment: ["Reefer", "Dry Van"],
  approvedCommodities: ["Produce"],
};

const load = {
  id: "l1",
  carrierOrgId: "carrier1",
  equipmentType: "Reefer",
  commodity: "Produce",
  declaredValueCents: 20_000_00,
};

// ── the permission engine ─────────────────────────────────────

describe("permission engine", () => {
  it("grants a permission the user's roles actually confer", () => {
    const s = session({ permissions: ["load.assign_carrier"] });
    assert.equal(can(s, "load.assign_carrier"), true);
  });

  it("denies a permission the user does not hold", () => {
    const s = session({ permissions: ["load.assign_carrier"] });
    assert.equal(can(s, "load.override_compliance_flag"), false);
  });

  it("denies a permission that does not apply to the org type, even if the row exists", () => {
    // Defence in depth: a forged RolePermission row granting a CARRIER `load.create`
    // must still not let them create loads.
    const carrier = session({ orgType: "CARRIER", permissions: ["load.create"] });
    assert.equal(can(carrier, "load.create"), false);

    // ...and symmetrically for a broker holding a carrier-only permission.
    const broker = session({ orgType: "BROKER", permissions: ["pod.upload"] });
    assert.equal(can(broker, "pod.upload"), false);
  });

  it("denies EVERY permission to a shipper, unconditionally", () => {
    // Shippers have no roles by design; their access is pure object-level scoping.
    const shipper = session({
      orgType: "SHIPPER",
      permissions: PERMISSIONS.map((p) => p.key),
    });
    for (const p of PERMISSIONS) {
      assert.equal(can(shipper, p.key), false, `shipper must not hold ${p.key}`);
    }
  });

  it("offers a role builder only the permissions valid for that org type", () => {
    const brokerKeys = permissionsForOrgType("BROKER").map((p) => p.key);
    const carrierKeys = permissionsForOrgType("CARRIER").map((p) => p.key);

    assert.ok(brokerKeys.includes("load.create"));
    assert.ok(!brokerKeys.includes("pod.upload"));
    assert.ok(carrierKeys.includes("pod.upload"));
    assert.ok(!carrierKeys.includes("load.create"));
    assert.deepEqual(permissionsForOrgType("SHIPPER"), []);
  });

  it("takes the union across multiple roles", () => {
    // A user holding both "Dispatcher" and a hypothetical audit role has both sets.
    const s = session({ permissions: ["rate.confirm", "audit.view"] });
    assert.equal(can(s, "rate.confirm"), true);
    assert.equal(can(s, "audit.view"), true);
    assert.equal(can(s, "staff.manage"), false);
  });
});

// ── the state machine ─────────────────────────────────────────

describe("load state machine", () => {
  it("rejects a transition that is not in the table", () => {
    const check = checkTransition("POSTED", "DELIVERED", "BROKER", facts({ status: "POSTED" }));
    assert.equal(check.ok, false);
    assert.equal(check.ok === false && check.reason, "NO_SUCH_TRANSITION");
  });

  it("rejects the right transition performed by the wrong side of the deal", () => {
    // A broker cannot mark a load in transit; only the carrier hauling it can.
    const check = checkTransition("DISPATCHED", "IN_TRANSIT", "BROKER", facts({ status: "DISPATCHED" }));
    assert.equal(check.ok, false);
    assert.equal(check.ok === false && check.reason, "WRONG_ACTOR");
  });

  it("allows the carrier to move a dispatched load in transit", () => {
    const check = checkTransition("DISPATCHED", "IN_TRANSIT", "CARRIER", facts({ status: "DISPATCHED" }));
    assert.equal(check.ok, true);
  });

  // ── THE COMPLIANCE GATE — the brief's central requirement ──
  it("BLOCKS progression past Carrier Assigned while a blocking flag is open", () => {
    const check = checkTransition(
      "CARRIER_ASSIGNED",
      "RATE_CONFIRMED",
      "BROKER",
      facts({ openBlockingFlags: 1 }),
    );
    assert.equal(check.ok, false);
    assert.equal(check.ok === false && check.reason, "GUARD_FAILED");
    assert.ok(
      check.ok === false &&
        check.reason === "GUARD_FAILED" &&
        check.failures.some((f) => f.code === "COMPLIANCE_BLOCKED"),
    );
  });

  it("also blocks dispatch itself while a flag is open", () => {
    const check = checkTransition(
      "RATE_CONFIRMED",
      "DISPATCHED",
      "BROKER",
      facts({ status: "RATE_CONFIRMED", openBlockingFlags: 2 }),
    );
    assert.equal(check.ok, false);
  });

  it("lets the load through the gate once the flag is resolved or overridden", () => {
    const check = checkTransition(
      "CARRIER_ASSIGNED",
      "RATE_CONFIRMED",
      "BROKER",
      facts({ openBlockingFlags: 0 }),
    );
    assert.equal(check.ok, true);
  });

  it("will not confirm a rate before the carrier has accepted the tender", () => {
    const check = checkTransition(
      "CARRIER_ASSIGNED",
      "RATE_CONFIRMED",
      "BROKER",
      facts({ carrierResponse: "PENDING" }),
    );
    assert.equal(check.ok, false);
    assert.ok(
      check.ok === false &&
        check.reason === "GUARD_FAILED" &&
        check.failures.some((f) => f.code === "CARRIER_NOT_ACCEPTED"),
    );
  });

  it("will not verify a POD that was never uploaded", () => {
    const check = checkTransition(
      "DELIVERED",
      "POD_VERIFIED",
      "BROKER",
      facts({ status: "DELIVERED", hasPod: false }),
    );
    assert.equal(check.ok, false);
    assert.ok(
      check.ok === false &&
        check.reason === "GUARD_FAILED" &&
        check.failures.some((f) => f.code === "NO_POD"),
    );

    const withPod = checkTransition(
      "DELIVERED",
      "POD_VERIFIED",
      "BROKER",
      facts({ status: "DELIVERED", hasPod: true }),
    );
    assert.equal(withPod.ok, true);
  });

  it("cannot cancel a load that is already rolling", () => {
    const check = checkTransition("IN_TRANSIT", "CANCELLED", "BROKER", facts({ status: "IN_TRANSIT" }));
    assert.equal(check.ok, false);
    assert.equal(check.ok === false && check.reason, "NO_SUCH_TRANSITION");
  });

  it("reports a permission it lacks as the reason a transition is unavailable", () => {
    // The Dispatcher case: holds rate.confirm but not load.override_compliance_flag.
    const options = availableTransitions(facts({ status: "RATE_CONFIRMED" }), "BROKER", [
      "rate.confirm",
    ]);
    const dispatch = options.find((o) => o.to === "DISPATCHED");
    assert.ok(dispatch);
    assert.equal(dispatch.allowed, false);
    assert.match(dispatch.blockedReason ?? "", /load\.update_status/);
  });

  it("reports the compliance block as the reason, when the permission IS held", () => {
    const options = availableTransitions(
      facts({ status: "RATE_CONFIRMED", openBlockingFlags: 1 }),
      "BROKER",
      ["load.update_status"],
    );
    const dispatch = options.find((o) => o.to === "DISPATCHED");
    assert.ok(dispatch);
    assert.equal(dispatch.allowed, false);
    assert.match(dispatch.blockedReason ?? "", /compliance flag/i);
  });
});

// ── the compliance evaluator ──────────────────────────────────

describe("compliance evaluator", () => {
  it("passes a fully compliant carrier", () => {
    assert.deepEqual(evaluate(load, compliantCarrier), []);
  });

  it("raises nothing at all when no carrier is assigned yet", () => {
    assert.deepEqual(evaluate({ ...load, carrierOrgId: null }, null), []);
  });

  it("BLOCKS a carrier with no compliance record", () => {
    const findings = evaluate(load, null);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].code, "NO_COMPLIANCE_RECORD");
    assert.equal(findings[0].severity, "BLOCKING");
  });

  it("BLOCKS expired insurance — the broker is liable for this one", () => {
    const findings = evaluate(load, { ...compliantCarrier, insuranceExpiry: days(-1) });
    const f = findings.find((x) => x.code === "INSURANCE_EXPIRED");
    assert.ok(f);
    assert.equal(f.severity, "BLOCKING");
  });

  it("WARNS (without blocking) on insurance expiring inside the renewal window", () => {
    const findings = evaluate(load, {
      ...compliantCarrier,
      insuranceExpiry: days(EXPIRY_WARNING_DAYS - 1),
    });
    const f = findings.find((x) => x.code === "INSURANCE_EXPIRING_SOON");
    assert.ok(f);
    assert.equal(f.severity, "WARNING");
    // A warning must never stop the load — only BLOCKING findings do.
    assert.equal(findings.filter((x) => x.severity === "BLOCKING").length, 0);
  });

  it("BLOCKS an inactive or revoked operating authority", () => {
    for (const status of ["INACTIVE", "REVOKED", "PENDING"]) {
      const findings = evaluate(load, { ...compliantCarrier, authorityStatus: status });
      const f = findings.find((x) => x.code === "AUTHORITY_INACTIVE");
      assert.ok(f, `${status} authority must be flagged`);
      assert.equal(f.severity, "BLOCKING");
    }
  });

  it("BLOCKS equipment the carrier is not approved for", () => {
    const findings = evaluate(load, { ...compliantCarrier, approvedEquipment: ["Flatbed"] });
    assert.ok(findings.some((x) => x.code === "EQUIPMENT_NOT_APPROVED"));
  });

  it("BLOCKS a commodity the carrier is not approved for", () => {
    const findings = evaluate(load, { ...compliantCarrier, approvedCommodities: ["Steel"] });
    assert.ok(findings.some((x) => x.code === "COMMODITY_NOT_APPROVED"));
  });

  it("BLOCKS cargo insurance that does not cover the declared value", () => {
    const findings = evaluate(
      { ...load, declaredValueCents: 200_000_00 },
      { ...compliantCarrier, cargoInsuranceCents: 100_000_00 },
    );
    assert.ok(findings.some((x) => x.code === "CARGO_INSURANCE_INSUFFICIENT"));
  });

  it("raises every applicable finding at once, not just the first", () => {
    const findings = evaluate(
      { ...load, declaredValueCents: 500_000_00 },
      {
        insuranceExpiry: days(-30),
        cargoInsuranceCents: 10_000_00,
        authorityStatus: "REVOKED",
        approvedEquipment: ["Flatbed"],
        approvedCommodities: ["Steel"],
      },
    );
    const codes = findings.map((f) => f.code).sort();
    assert.deepEqual(codes, [
      "AUTHORITY_INACTIVE",
      "CARGO_INSURANCE_INSUFFICIENT",
      "COMMODITY_NOT_APPROVED",
      "EQUIPMENT_NOT_APPROVED",
      "INSURANCE_EXPIRED",
    ]);
  });
});
