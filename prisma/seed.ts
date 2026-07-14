/**
 * Seed a small but *complete* freight world — enough that every requirement in the
 * brief can be demonstrated within seconds of `npm run dev`, including the failure
 * cases (an expired-insurance carrier, a revoked-authority carrier, a load already
 * blocked by the compliance gate, and a rate that has been renegotiated twice).
 *
 * Prisma 7: run with `npx prisma db seed` (configured in prisma.config.ts —
 * NOT in package.json, which is the Prisma 5/6 convention).
 */
import "dotenv/config";
import { audit } from "../src/lib/audit/log";
import { hashPassword } from "../src/lib/auth/password";
import { PERMISSIONS, type PermissionKey } from "../src/lib/authz/permissions";
import { evaluateLoad } from "../src/lib/compliance/evaluator";
// Reuse the app's own client so the seed writes through exactly the same adapter
// and the same compliance/audit code paths the running app uses.
import { prisma } from "../src/lib/db";

const DEMO_PASSWORD = "loadflow";

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

async function main() {
  console.log("→ Resetting demo data…");
  // Order matters: children before parents.
  await prisma.auditLog.deleteMany();
  await prisma.proofOfDelivery.deleteMany();
  await prisma.complianceFlag.deleteMany();
  await prisma.load.updateMany({ data: { confirmedRateConfirmationId: null } });
  await prisma.rateConfirmation.deleteMany();
  await prisma.load.deleteMany();
  await prisma.carrierCompliance.deleteMany();
  await prisma.session.deleteMany();
  await prisma.inviteRole.deleteMany();
  await prisma.invite.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.role.deleteMany();
  await prisma.user.deleteMany();
  await prisma.org.deleteMany();
  await prisma.permission.deleteMany();

  // ── The permission catalog: code is the source of truth, mirrored to the DB
  //    so RolePermission rows have referential integrity. ─────────────────────
  console.log("→ Seeding the permission catalog…");
  await prisma.permission.createMany({
    data: PERMISSIONS.map((p, i) => ({
      key: p.key,
      label: p.label,
      description: p.description,
      category: p.category,
      forBroker: p.forBroker,
      forCarrier: p.forCarrier,
      sortOrder: i,
    })),
  });

  const pw = await hashPassword(DEMO_PASSWORD);

  // ── Helpers ───────────────────────────────────────────────────────────────
  async function makeRole(
    orgId: string,
    name: string,
    description: string,
    keys: PermissionKey[],
    isSystem = false,
  ) {
    return prisma.role.create({
      data: {
        orgId,
        name,
        description,
        isSystem,
        permissions: { create: keys.map((permissionKey) => ({ permissionKey })) },
      },
    });
  }

  async function makeUser(orgId: string, name: string, email: string, roleIds: string[]) {
    return prisma.user.create({
      data: {
        orgId,
        name,
        email,
        passwordHash: pw,
        roles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
    });
  }

  const allBroker = PERMISSIONS.filter((p) => p.forBroker).map((p) => p.key) as PermissionKey[];
  const allCarrier = PERMISSIONS.filter((p) => p.forCarrier).map((p) => p.key) as PermissionKey[];

  // ── BROKER ────────────────────────────────────────────────────────────────
  console.log("→ Creating broker org, roles and staff…");
  const broker = await prisma.org.create({
    data: {
      type: "BROKER",
      name: "Meridian Freight Solutions",
      contactEmail: "ops@meridianfreight.com",
      phone: "(312) 555-0142",
      city: "Chicago",
      state: "IL",
    },
  });

  // The admin role is not special-cased anywhere in the code. It is simply the role
  // that happens to contain every permission — that is what makes an admin an admin.
  const brokerAdminRole = await makeRole(
    broker.id,
    "Organization Administrator",
    "Full control of this organization. Created with the org; holds every permission available to it.",
    allBroker,
    true,
  );

  // The two roles the brief names explicitly, built from the catalog like any other.
  const dispatcherRole = await makeRole(
    broker.id,
    "Dispatcher",
    "Books carriers and confirms rates. Cannot override a compliance flag — that is deliberately a different pay grade.",
    ["load.create", "load.assign_carrier", "rate.confirm", "load.update_status"],
  );

  const opsLeadRole = await makeRole(
    broker.id,
    "Ops Lead",
    "Everything a Dispatcher can do, plus the authority to override a compliance flag on the record.",
    [
      "load.create",
      "load.assign_carrier",
      "rate.confirm",
      "load.update_status",
      "load.override_compliance_flag",
      "compliance.manage",
      "audit.view",
    ],
  );

  // A deliberately minimal role, to make the RBAC demo land: this person can see the
  // board and nothing else. Every mutating endpoint 403s for them — from the UI and
  // from curl alike.
  const viewerRole = await makeRole(
    broker.id,
    "Billing Clerk",
    "Read-only access to the load board for invoicing. Holds no mutating permissions at all.",
    [],
  );

  const brokerAdmin = await makeUser(broker.id, "Dana Whitfield", "admin@meridian.com", [
    brokerAdminRole.id,
  ]);
  const dispatcher = await makeUser(broker.id, "Marcus Reyes", "dispatch@meridian.com", [
    dispatcherRole.id,
  ]);
  const opsLead = await makeUser(broker.id, "Priya Raman", "ops@meridian.com", [opsLeadRole.id]);
  await makeUser(broker.id, "Tom Beckett", "billing@meridian.com", [viewerRole.id]);

  // ── CARRIERS ──────────────────────────────────────────────────────────────
  console.log("→ Creating carrier orgs (one compliant, two not)…");

  // (1) Fully compliant — the happy path.
  const carrierGood = await prisma.org.create({
    data: {
      type: "CARRIER",
      name: "Ironline Trucking",
      contactEmail: "dispatch@ironline.com",
      phone: "(414) 555-0177",
      mcNumber: "MC-884210",
      dotNumber: "DOT-2917443",
      city: "Milwaukee",
      state: "WI",
    },
  });

  // (2) Insurance lapsed 12 days ago — a broker dispatching to them is liable.
  const carrierExpired = await prisma.org.create({
    data: {
      type: "CARRIER",
      name: "Redline Logistics",
      contactEmail: "ops@redlinelog.com",
      phone: "(602) 555-0193",
      mcNumber: "MC-771002",
      dotNumber: "DOT-3310988",
      city: "Phoenix",
      state: "AZ",
    },
  });

  // (3) Authority revoked, and insurance expiring inside the warning window.
  const carrierRevoked = await prisma.org.create({
    data: {
      type: "CARRIER",
      name: "Cobalt Carriers",
      contactEmail: "hq@cobaltcarriers.com",
      phone: "(214) 555-0119",
      mcNumber: "MC-660915",
      dotNumber: "DOT-4402117",
      city: "Dallas",
      state: "TX",
    },
  });

  for (const carrier of [carrierGood, carrierExpired, carrierRevoked]) {
    const adminRole = await makeRole(
      carrier.id,
      "Organization Administrator",
      "Full control of this organization. Created with the org; holds every permission available to it.",
      allCarrier,
      true,
    );

    // The two carrier roles the brief names — note they are disjoint, which is the point:
    // a Driver cannot accept freight, and a dispatcher cannot sign a POD.
    const dispatchRole = await makeRole(
      carrier.id,
      "Carrier Dispatch",
      "Accepts and declines tendered loads. Does not touch trucks, does not sign PODs.",
      ["load.accept_decline"],
    );

    const driverRole = await makeRole(
      carrier.id,
      "Driver",
      "Updates load status on the road and uploads the POD. Cannot accept or decline freight.",
      ["load.update_status", "pod.upload"],
    );

    const slug = carrier.name.split(" ")[0].toLowerCase();
    await makeUser(carrier.id, `${carrier.name} Admin`, `admin@${slug}.com`, [adminRole.id]);
    await makeUser(carrier.id, "Ellis Ward", `dispatch@${slug}.com`, [dispatchRole.id]);
    await makeUser(carrier.id, "Joe Nowak", `driver@${slug}.com`, [driverRole.id]);
  }

  console.log("→ Writing carrier compliance records…");
  await prisma.carrierCompliance.create({
    data: {
      orgId: carrierGood.id,
      insuranceProvider: "Great West Casualty",
      insurancePolicyNumber: "GW-2291-A",
      insuranceExpiry: daysFromNow(240),
      cargoInsuranceCents: 25_000_00,
      autoLiabilityCents: 1_000_000_00,
      mcNumber: "MC-884210",
      dotNumber: "DOT-2917443",
      authorityStatus: "ACTIVE",
      approvedEquipment: ["Dry Van", "Reefer", "Flatbed"],
      approvedCommodities: ["General Freight", "Produce", "Building Materials", "Beverages"],
    },
  });

  await prisma.carrierCompliance.create({
    data: {
      orgId: carrierExpired.id,
      insuranceProvider: "Canal Insurance",
      insurancePolicyNumber: "CI-77410",
      insuranceExpiry: daysFromNow(-12), // ← lapsed
      cargoInsuranceCents: 100_000_00,
      autoLiabilityCents: 1_000_000_00,
      mcNumber: "MC-771002",
      dotNumber: "DOT-3310988",
      authorityStatus: "ACTIVE",
      approvedEquipment: ["Dry Van", "Reefer"],
      approvedCommodities: ["General Freight", "Electronics", "Produce"],
    },
  });

  await prisma.carrierCompliance.create({
    data: {
      orgId: carrierRevoked.id,
      insuranceProvider: "Progressive Commercial",
      insurancePolicyNumber: "PC-55120",
      insuranceExpiry: daysFromNow(19), // ← inside the 30-day warning window
      cargoInsuranceCents: 50_000_00,
      autoLiabilityCents: 750_000_00,
      mcNumber: "MC-660915",
      dotNumber: "DOT-4402117",
      authorityStatus: "REVOKED", // ← blocking
      approvedEquipment: ["Flatbed"],
      approvedCommodities: ["Building Materials", "Steel"],
    },
  });

  // ── SHIPPERS ──────────────────────────────────────────────────────────────
  console.log("→ Creating shipper accounts…");
  const shipperA = await prisma.org.create({
    data: {
      type: "SHIPPER",
      name: "Cascade Produce Co.",
      contactEmail: "logistics@cascadeproduce.com",
      city: "Yakima",
      state: "WA",
    },
  });
  await makeUser(shipperA.id, "Nora Hale", "shipper@cascade.com", []); // no roles, by design

  const shipperB = await prisma.org.create({
    data: {
      type: "SHIPPER",
      name: "Northgate Building Supply",
      contactEmail: "ship@northgatebuild.com",
      city: "Denver",
      state: "CO",
    },
  });
  await makeUser(shipperB.id, "Victor Ellis", "shipper@northgate.com", []);

  // ── LOADS ─────────────────────────────────────────────────────────────────
  console.log("→ Creating loads across the lifecycle…");

  let seq = 1041;
  const ref = () => `LF-${seq++}`;

  async function makeLoad(data: {
    shipperOrgId: string;
    carrierOrgId?: string;
    status?:
      | "POSTED"
      | "CARRIER_ASSIGNED"
      | "RATE_CONFIRMED"
      | "DISPATCHED"
      | "IN_TRANSIT"
      | "DELIVERED"
      | "POD_VERIFIED"
      | "INVOICED"
      | "CLOSED";
    carrierResponse?: "PENDING" | "ACCEPTED" | "DECLINED";
    originCity: string;
    originState: string;
    destCity: string;
    destState: string;
    commodity: string;
    equipmentType: string;
    weightLbs: number;
    declaredValueCents: number;
    offeredRateCents: number;
    pickupInDays: number;
    transitDays: number;
    notes?: string;
  }) {
    return prisma.load.create({
      data: {
        reference: ref(),
        shipperOrgId: data.shipperOrgId,
        brokerOrgId: broker.id,
        carrierOrgId: data.carrierOrgId ?? null,
        status: data.status ?? "POSTED",
        carrierResponse: data.carrierResponse ?? "PENDING",
        originCity: data.originCity,
        originState: data.originState,
        destCity: data.destCity,
        destState: data.destState,
        pickupAt: daysFromNow(data.pickupInDays),
        deliverBy: daysFromNow(data.pickupInDays + data.transitDays),
        commodity: data.commodity,
        equipmentType: data.equipmentType,
        weightLbs: data.weightLbs,
        declaredValueCents: data.declaredValueCents,
        offeredRateCents: data.offeredRateCents,
        notes: data.notes ?? null,
        createdById: dispatcher.id,
      },
    });
  }

  // Open on the board.
  await makeLoad({
    shipperOrgId: shipperA.id,
    originCity: "Yakima", originState: "WA", destCity: "Sacramento", destState: "CA",
    commodity: "Produce", equipmentType: "Reefer",
    weightLbs: 42_000, declaredValueCents: 18_000_00, offeredRateCents: 2_850_00,
    pickupInDays: 2, transitDays: 2,
    notes: "Continuous reefer at 34°F. Driver must check temp at every stop.",
  });

  await makeLoad({
    shipperOrgId: shipperB.id,
    originCity: "Denver", originState: "CO", destCity: "Salt Lake City", destState: "UT",
    commodity: "Building Materials", equipmentType: "Flatbed",
    weightLbs: 47_500, declaredValueCents: 31_000_00, offeredRateCents: 1_975_00,
    pickupInDays: 4, transitDays: 1,
  });

  // ⚠ THE MONEY DEMO: assigned to the carrier whose insurance lapsed 12 days ago.
  // The compliance gate will flag this on seed and refuse to let it progress.
  const blockedLoad = await makeLoad({
    shipperOrgId: shipperA.id,
    carrierOrgId: carrierExpired.id,
    status: "CARRIER_ASSIGNED",
    carrierResponse: "ACCEPTED",
    originCity: "Portland", originState: "OR", destCity: "Boise", destState: "ID",
    commodity: "Produce", equipmentType: "Reefer",
    weightLbs: 38_000, declaredValueCents: 22_000_00, offeredRateCents: 2_100_00,
    pickupInDays: 1, transitDays: 1,
    notes: "Tendered before the insurance lapse was noticed.",
  });

  // A second blocked load — wrong equipment AND revoked authority, to show multiple flags.
  const doubleBlocked = await makeLoad({
    shipperOrgId: shipperB.id,
    carrierOrgId: carrierRevoked.id,
    status: "CARRIER_ASSIGNED",
    carrierResponse: "PENDING",
    originCity: "Dallas", originState: "TX", destCity: "Little Rock", destState: "AR",
    commodity: "Electronics", equipmentType: "Dry Van",
    weightLbs: 21_000, declaredValueCents: 96_000_00, offeredRateCents: 1_450_00,
    pickupInDays: 3, transitDays: 1,
  });

  // The happy path, mid-flight with the compliant carrier.
  const inTransit = await makeLoad({
    shipperOrgId: shipperA.id,
    carrierOrgId: carrierGood.id,
    status: "IN_TRANSIT",
    carrierResponse: "ACCEPTED",
    originCity: "Yakima", originState: "WA", destCity: "Denver", destState: "CO",
    commodity: "Produce", equipmentType: "Reefer",
    weightLbs: 43_000, declaredValueCents: 19_500_00, offeredRateCents: 3_400_00,
    pickupInDays: -2, transitDays: 4,
  });

  // Delivered, awaiting POD verification.
  const delivered = await makeLoad({
    shipperOrgId: shipperB.id,
    carrierOrgId: carrierGood.id,
    status: "DELIVERED",
    carrierResponse: "ACCEPTED",
    originCity: "Denver", originState: "CO", destCity: "Omaha", destState: "NE",
    commodity: "Building Materials", equipmentType: "Flatbed",
    weightLbs: 46_000, declaredValueCents: 24_000_00, offeredRateCents: 1_850_00,
    pickupInDays: -5, transitDays: 2,
  });

  // Closed — its rate was renegotiated twice, and it keeps the version it closed on.
  const closed = await makeLoad({
    shipperOrgId: shipperA.id,
    carrierOrgId: carrierGood.id,
    status: "CLOSED",
    carrierResponse: "ACCEPTED",
    originCity: "Seattle", originState: "WA", destCity: "Boise", destState: "ID",
    commodity: "Beverages", equipmentType: "Dry Van",
    weightLbs: 40_000, declaredValueCents: 15_000_00, offeredRateCents: 2_200_00,
    pickupInDays: -20, transitDays: 2,
  });

  // ── RATE CONFIRMATIONS (versioned) ────────────────────────────────────────
  console.log("→ Writing versioned rate confirmations…");

  async function makeRate(
    loadId: string,
    version: number,
    carrierOrgId: string,
    baseRateCents: number,
    accessorials: { code: string; label: string; amountCents: number }[],
    status: "CONFIRMED" | "SUPERSEDED",
    notes?: string,
  ) {
    const totalRateCents = accessorials.reduce((s, a) => s + a.amountCents, baseRateCents);
    return prisma.rateConfirmation.create({
      data: {
        loadId, version, carrierOrgId, baseRateCents, accessorials, totalRateCents,
        status, notes: notes ?? null, createdById: dispatcher.id,
      },
    });
  }

  // The closed load: three versions. v3 is what it actually closed on, and it keeps
  // that version forever — this is the brief's "old loads keep the version that was
  // actually confirmed" requirement, made visible.
  await makeRate(closed.id, 1, carrierGood.id, 2_200_00,
    [{ code: "FSC", label: "Fuel surcharge", amountCents: 180_00 }], "SUPERSEDED",
    "Initial offer.");
  await makeRate(closed.id, 2, carrierGood.id, 2_350_00,
    [{ code: "FSC", label: "Fuel surcharge", amountCents: 180_00 }], "SUPERSEDED",
    "Carrier pushed back on the lane rate.");
  const closedFinal = await makeRate(closed.id, 3, carrierGood.id, 2_350_00,
    [
      { code: "FSC", label: "Fuel surcharge", amountCents: 180_00 },
      { code: "DET", label: "Detention (2 hrs at receiver)", amountCents: 120_00 },
    ], "CONFIRMED",
    "Detention added after the receiver held the driver two hours.");
  await prisma.load.update({
    where: { id: closed.id },
    data: { confirmedRateConfirmationId: closedFinal.id },
  });

  const inTransitRate = await makeRate(inTransit.id, 1, carrierGood.id, 3_400_00,
    [{ code: "FSC", label: "Fuel surcharge", amountCents: 260_00 }], "CONFIRMED");
  await prisma.load.update({
    where: { id: inTransit.id },
    data: { confirmedRateConfirmationId: inTransitRate.id },
  });

  const deliveredRate = await makeRate(delivered.id, 1, carrierGood.id, 1_850_00,
    [{ code: "TARP", label: "Tarping", amountCents: 100_00 }], "CONFIRMED");
  await prisma.load.update({
    where: { id: delivered.id },
    data: { confirmedRateConfirmationId: deliveredRate.id },
  });

  // ── COMPLIANCE FLAGS — raised by the same evaluator the running app uses, so the
  //    seeded flags are not fixtures. They are the real rules, really firing. ──────
  console.log("→ Running the compliance evaluator over seeded loads…");
  for (const load of [blockedLoad, doubleBlocked, inTransit, delivered]) {
    await evaluateLoad(load.id, null);
  }

  // ── A little audit history, so the trail isn't empty on first look ─────────
  const actor = { userId: dispatcher.id, email: dispatcher.email, name: dispatcher.name, orgId: broker.id, orgName: broker.name };

  await audit({
    actor, action: "LOAD_CREATED", entityType: "Load", entityId: closed.id, loadId: closed.id,
    summary: `Load ${closed.reference} was posted to the board.`, toStatus: "POSTED",
  });
  await audit({
    actor, action: "STATUS_CHANGED", entityType: "Load", entityId: closed.id, loadId: closed.id,
    fromStatus: "INVOICED", toStatus: "CLOSED",
    summary: `Load ${closed.reference}: Invoiced → Closed`,
  });

  const flagCount = await prisma.complianceFlag.count({ where: { status: "OPEN" } });

  console.log(`
✅ Seed complete.

   ${await prisma.org.count()} orgs · ${await prisma.user.count()} users · ${await prisma.role.count()} roles · ${await prisma.load.count()} loads
   ${flagCount} open compliance flags (loads ${blockedLoad.reference} and ${doubleBlocked.reference} are BLOCKED by the gate)

   Every account's password is: ${DEMO_PASSWORD}

   BROKER — Meridian Freight Solutions
     admin@meridian.com     Organization Administrator (everything)
     ops@meridian.com       Ops Lead      (can override compliance flags)
     dispatch@meridian.com  Dispatcher    (CANNOT override — this is the RBAC demo)
     billing@meridian.com   Billing Clerk (read-only; every mutation 403s)

   CARRIER — Ironline Trucking (compliant)      admin@ironline.com / dispatch@ironline.com / driver@ironline.com
   CARRIER — Redline Logistics (INSURANCE LAPSED)  admin@redline.com / dispatch@redline.com / driver@redline.com
   CARRIER — Cobalt Carriers  (AUTHORITY REVOKED)  admin@cobalt.com / dispatch@cobalt.com / driver@cobalt.com

   SHIPPER  shipper@cascade.com · shipper@northgate.com
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
