import type { LoadStatus } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth/session";
import { loadScope } from "@/lib/authz/guard";
import {
  blockedLoadsForCarrier,
  canSeeCarrier,
  complianceStateOf,
  daysUntilExpiry,
  liveLoadsForCarrier,
  toComplianceDTO,
  type ComplianceDTO,
  type ComplianceState,
} from "@/lib/compliance/schema";
import { prisma } from "@/lib/db";

/**
 * Server-side reads for the compliance surfaces.
 *
 * These pages render from Prisma directly (they are Server Components), but they go
 * through exactly the same scope helpers the API routes use — `canSeeCarrier`,
 * `loadScope`, `liveLoadsForCarrier`. A page is never a back door around scope:
 * a carrier reading `/broker/carriers/<rival>` would 404 here just as it does at the
 * API, and the load counts a broker sees are ANDed with *its own* freight.
 */

export type CarrierLoadRow = {
  id: string;
  reference: string;
  status: LoadStatus;
  originCity: string;
  originState: string;
  destCity: string;
  destState: string;
  pickupAt: string;
  equipmentType: string;
  commodity: string;
  declaredValueCents: number;
  offeredRateCents: number;
  openFlags: { id: string; code: string; severity: string; message: string }[];
};

export type CarrierComplianceView = {
  org: {
    id: string;
    name: string;
    contactEmail: string;
    phone: string | null;
    city: string | null;
    state: string | null;
    mcNumber: string | null;
    dotNumber: string | null;
  };
  compliance: ComplianceDTO | null;
  state: ComplianceState;
  daysUntilExpiry: number | null;
  updatedByName: string | null;
  liveLoads: number;
  blockedLoads: number;
  loads: CarrierLoadRow[];
};

/** Null means "as far as this caller is concerned, this carrier does not exist" → 404. */
export async function carrierComplianceView(
  session: SessionUser,
  orgId: string,
): Promise<CarrierComplianceView | null> {
  if (!canSeeCarrier(session, orgId)) return null;

  const org = await prisma.org.findFirst({
    where: { id: orgId, type: "CARRIER" },
    include: { compliance: { include: { updatedBy: { select: { name: true } } } } },
  });
  if (!org) return null;

  const [liveLoads, blockedLoads, loadRows] = await Promise.all([
    prisma.load.count({ where: liveLoadsForCarrier(session, org.id) }),
    prisma.load.count({ where: blockedLoadsForCarrier(session, org.id) }),
    prisma.load.findMany({
      where: { AND: [loadScope(session), { carrierOrgId: org.id }] },
      include: {
        complianceFlags: {
          where: { status: "OPEN" },
          orderBy: { raisedAt: "asc" },
          select: { id: true, code: true, severity: true, message: true },
        },
      },
      orderBy: [{ pickupAt: "asc" }],
      take: 100,
    }),
  ]);

  const now = new Date();

  return {
    org: {
      id: org.id,
      name: org.name,
      contactEmail: org.contactEmail,
      phone: org.phone,
      city: org.city,
      state: org.state,
      mcNumber: org.mcNumber,
      dotNumber: org.dotNumber,
    },
    compliance: org.compliance ? toComplianceDTO(org.compliance) : null,
    state: complianceStateOf(org.compliance, now),
    daysUntilExpiry: org.compliance
      ? daysUntilExpiry(org.compliance.insuranceExpiry, now)
      : null,
    updatedByName: org.compliance?.updatedBy?.name ?? null,
    liveLoads,
    blockedLoads,
    loads: loadRows.map((l) => ({
      id: l.id,
      reference: l.reference,
      status: l.status,
      originCity: l.originCity,
      originState: l.originState,
      destCity: l.destCity,
      destState: l.destState,
      pickupAt: l.pickupAt.toISOString(),
      equipmentType: l.equipmentType,
      commodity: l.commodity,
      declaredValueCents: l.declaredValueCents,
      offeredRateCents: l.offeredRateCents,
      openFlags: l.complianceFlags.map((f) => ({
        id: f.id,
        code: f.code,
        severity: f.severity,
        message: f.message,
      })),
    })),
  };
}

export type RosterRow = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  contactEmail: string;
  mcNumber: string | null;
  dotNumber: string | null;
  complianceState: ComplianceState;
  insuranceProvider: string | null;
  insuranceExpiry: string | null;
  daysUntilExpiry: number | null;
  authorityStatus: string | null;
  cargoInsuranceCents: number | null;
  autoLiabilityCents: number | null;
  approvedEquipment: string[];
  approvedCommodities: string[];
  liveLoads: number;
  blockedLoads: number;
};

const RANK: Record<ComplianceState, number> = {
  NO_RECORD: 0,
  EXPIRED: 1,
  AUTHORITY_ISSUE: 2,
  EXPIRING: 3,
  OK: 4,
};

/** The vetting roster. Problems first — a broker scanning this should hit them instantly. */
export async function carrierRoster(
  session: SessionUser,
  opts: { q?: string; state?: string } = {},
): Promise<{ rows: RosterRow[]; totals: { total: number; atRisk: number; blockedLoads: number; expiringSoon: number } }> {
  const q = opts.q?.trim() ?? "";

  const orgs = await prisma.org.findMany({
    where: {
      type: "CARRIER",
      // A carrier may only ever see itself here. Derived from the session, never the URL.
      ...(session.orgType === "CARRIER" ? { id: session.orgId } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q } },
              { mcNumber: { contains: q } },
              { dotNumber: { contains: q } },
              { city: { contains: q } },
            ],
          }
        : {}),
    },
    include: { compliance: true },
    orderBy: { name: "asc" },
  });

  const now = new Date();

  const rows: RosterRow[] = await Promise.all(
    orgs.map(async (org) => {
      const c = org.compliance;
      const dto = c ? toComplianceDTO(c) : null;

      const [liveLoads, blockedLoads] = await Promise.all([
        prisma.load.count({ where: liveLoadsForCarrier(session, org.id) }),
        prisma.load.count({ where: blockedLoadsForCarrier(session, org.id) }),
      ]);

      return {
        id: org.id,
        name: org.name,
        city: org.city,
        state: org.state,
        contactEmail: org.contactEmail,
        mcNumber: dto?.mcNumber ?? org.mcNumber,
        dotNumber: dto?.dotNumber ?? org.dotNumber,
        complianceState: complianceStateOf(c, now),
        insuranceProvider: dto?.insuranceProvider ?? null,
        insuranceExpiry: dto?.insuranceExpiry ?? null,
        daysUntilExpiry: c ? daysUntilExpiry(c.insuranceExpiry, now) : null,
        authorityStatus: dto?.authorityStatus ?? null,
        cargoInsuranceCents: dto?.cargoInsuranceCents ?? null,
        autoLiabilityCents: dto?.autoLiabilityCents ?? null,
        approvedEquipment: dto?.approvedEquipment ?? [],
        approvedCommodities: dto?.approvedCommodities ?? [],
        liveLoads,
        blockedLoads,
      };
    }),
  );

  const totals = {
    total: rows.length,
    atRisk: rows.filter((r) => r.complianceState !== "OK").length,
    blockedLoads: rows.reduce((sum, r) => sum + r.blockedLoads, 0),
    expiringSoon: rows.filter((r) => r.complianceState === "EXPIRING").length,
  };

  const filtered =
    opts.state && opts.state !== "ALL"
      ? rows.filter((r) => r.complianceState === opts.state)
      : rows;

  filtered.sort(
    (a, b) =>
      RANK[a.complianceState] - RANK[b.complianceState] ||
      b.blockedLoads - a.blockedLoads ||
      b.liveLoads - a.liveLoads ||
      a.name.localeCompare(b.name),
  );

  return { rows: filtered, totals };
}
