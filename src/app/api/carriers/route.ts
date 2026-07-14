import { NextResponse, type NextRequest } from "next/server";
import { handler, Forbidden } from "@/lib/api/http";
import { audit, requestMeta } from "@/lib/audit/log";
import { requireSession } from "@/lib/authz/guard";
import {
  blockedLoadsForCarrier,
  complianceStateOf,
  daysUntilExpiry,
  liveLoadsForCarrier,
  toCarrierDTO,
  toComplianceDTO,
  type ComplianceState,
} from "@/lib/compliance/schema";
import { prisma } from "@/lib/db";

/**
 * GET /api/carriers
 *
 * The broker's carrier roster: every carrier org with the compliance facts a broker
 * needs *before* tendering — because after tendering, the gate has already stopped
 * the load and someone is on the phone.
 *
 * Scope is the control here, not a hidden button:
 *   BROKER  → every carrier
 *   CARRIER → itself only. A carrier must never be able to enumerate its competitors,
 *             let alone read their insurance limits.
 *   SHIPPER → 403. Shippers have no business in the carrier vetting surface at all.
 *
 * Optional filters: ?q= (name / MC / DOT) and ?state= (compliance state).
 */
export const GET = handler(async (req: NextRequest) => {
  const meta = requestMeta(req);
  const session = await requireSession();

  if (session.orgType === "SHIPPER") {
    await audit({
      actor: session,
      action: "ORG_TYPE_DENIED",
      entityType: "Endpoint",
      outcome: "DENIED",
      summary: `Blocked: a SHIPPER account (${session.email}) attempted to list carriers.`,
      meta,
    });
    throw Forbidden("carrier directory access");
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const stateFilter = req.nextUrl.searchParams.get("state")?.trim().toUpperCase() ?? "";

  const orgs = await prisma.org.findMany({
    where: {
      type: "CARRIER",
      // Derived from the SESSION, never from a client-supplied org id.
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

  const carriers = await Promise.all(
    orgs.map(async (org) => {
      const compliance = org.compliance;
      const state = complianceStateOf(compliance, now);
      const dto = compliance ? toComplianceDTO(compliance) : null;

      const [liveLoads, blockedLoads] = await Promise.all([
        prisma.load.count({ where: liveLoadsForCarrier(session, org.id) }),
        prisma.load.count({ where: blockedLoadsForCarrier(session, org.id) }),
      ]);

      return {
        ...toCarrierDTO(org),
        complianceState: state,
        compliance: dto,
        // Flattened summary so a table row does not have to null-check its way in.
        insuranceProvider: dto?.insuranceProvider ?? null,
        insuranceExpiry: dto?.insuranceExpiry ?? null,
        daysUntilExpiry: compliance ? daysUntilExpiry(compliance.insuranceExpiry, now) : null,
        authorityStatus: dto?.authorityStatus ?? null,
        cargoInsuranceCents: dto?.cargoInsuranceCents ?? null,
        autoLiabilityCents: dto?.autoLiabilityCents ?? null,
        approvedEquipment: dto?.approvedEquipment ?? [],
        approvedCommodities: dto?.approvedCommodities ?? [],
        /** Live loads this carrier is on, within the caller's own load scope. */
        liveLoads,
        /** …of those, the ones the compliance gate is currently holding. */
        blockedLoads,
      };
    }),
  );

  const filtered = stateFilter
    ? carriers.filter((c) => c.complianceState === (stateFilter as ComplianceState))
    : carriers;

  // Worst first: a broker scanning this list should hit the problems immediately.
  const RANK: Record<ComplianceState, number> = {
    NO_RECORD: 0,
    EXPIRED: 1,
    AUTHORITY_ISSUE: 2,
    EXPIRING: 3,
    OK: 4,
  };
  filtered.sort(
    (a, b) =>
      RANK[a.complianceState] - RANK[b.complianceState] ||
      b.blockedLoads - a.blockedLoads ||
      a.name.localeCompare(b.name),
  );

  return NextResponse.json({
    carriers: filtered,
    counts: {
      total: filtered.length,
      ok: filtered.filter((c) => c.complianceState === "OK").length,
      atRisk: filtered.filter((c) => c.complianceState !== "OK").length,
      blockedLoads: filtered.reduce((sum, c) => sum + c.blockedLoads, 0),
    },
  });
});
