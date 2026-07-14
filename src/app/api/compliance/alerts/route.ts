import { NextResponse, type NextRequest } from "next/server";
import { Forbidden, handler } from "@/lib/api/http";
import { audit, requestMeta } from "@/lib/audit/log";
import { requireSession } from "@/lib/authz/guard";
import { EXPIRY_WARNING_DAYS } from "@/lib/compliance/evaluator";
import {
  blockedLoadsForCarrier,
  complianceStateOf,
  COMPLIANCE_STATE_LABEL,
  daysUntilExpiry,
  isBlockingState,
  liveLoadsForCarrier,
  toCarrierDTO,
  toComplianceDTO,
  type ComplianceState,
} from "@/lib/compliance/schema";
import { prisma } from "@/lib/db";

type AlertSeverity = "CRITICAL" | "WARNING";

/**
 * GET /api/compliance/alerts — the risk strip.
 *
 * Carriers whose insurance has lapsed, lapses within 30 days, or whose operating
 * authority is not ACTIVE. A carrier with no record at all is included too: from a
 * broker's liability point of view, "we never checked" is worse than "it expires in
 * three weeks", and silently omitting it would be the exact failure this product exists
 * to prevent.
 *
 * BROKER  → every carrier (this is the broker's risk dashboard)
 * CARRIER → itself
 * SHIPPER → 403
 *
 * Load counts are ANDed with the caller's own load scope, so a broker sees the exposure
 * on *its* freight, not on someone else's.
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
      summary: `Blocked: a SHIPPER account (${session.email}) attempted to read the carrier compliance alerts.`,
      meta,
    });
    throw Forbidden("compliance alerts access");
  }

  const orgs = await prisma.org.findMany({
    where: {
      type: "CARRIER",
      // Never from the client — a carrier only ever sees itself here.
      ...(session.orgType === "CARRIER" ? { id: session.orgId } : {}),
    },
    include: { compliance: true },
  });

  const now = new Date();
  const RANK: Record<ComplianceState, number> = {
    NO_RECORD: 0,
    EXPIRED: 1,
    AUTHORITY_ISSUE: 2,
    EXPIRING: 3,
    OK: 4,
  };

  const alerts = [];

  for (const org of orgs) {
    const compliance = org.compliance;
    const state = complianceStateOf(compliance, now);
    if (state === "OK") continue;

    const days = compliance ? daysUntilExpiry(compliance.insuranceExpiry, now) : null;
    const severity: AlertSeverity = isBlockingState(state) ? "CRITICAL" : "WARNING";

    const [liveLoads, blockedLoads] = await Promise.all([
      prisma.load.count({ where: liveLoadsForCarrier(session, org.id) }),
      prisma.load.count({ where: blockedLoadsForCarrier(session, org.id) }),
    ]);

    const reason =
      state === "NO_RECORD"
        ? "No compliance record on file. Insurance and authority have never been verified."
        : state === "EXPIRED"
          ? `Insurance lapsed ${Math.abs(days ?? 0)} day${Math.abs(days ?? 0) === 1 ? "" : "s"} ago.`
          : state === "AUTHORITY_ISSUE"
            ? `MC/DOT operating authority is ${compliance?.authorityStatus}, not ACTIVE.`
            : `Insurance expires in ${days} day${days === 1 ? "" : "s"}.`;

    alerts.push({
      carrier: toCarrierDTO(org),
      carrierOrgId: org.id,
      carrierName: org.name,
      complianceState: state,
      label: COMPLIANCE_STATE_LABEL[state],
      severity,
      reason,
      /** Negative once lapsed; null when there is no record to expire. */
      daysUntilExpiry: days,
      insuranceExpiry: compliance ? compliance.insuranceExpiry.toISOString() : null,
      authorityStatus: compliance?.authorityStatus ?? null,
      compliance: compliance ? toComplianceDTO(compliance) : null,
      /** Live loads riding on this carrier right now, within the caller's scope. */
      affectedLoads: liveLoads,
      /** …of those, the ones the gate is already holding. */
      blockedLoads,
    });
  }

  // Most urgent first: worst state, then soonest to bite, then most freight exposed.
  alerts.sort(
    (a, b) =>
      RANK[a.complianceState] - RANK[b.complianceState] ||
      (a.daysUntilExpiry ?? -9999) - (b.daysUntilExpiry ?? -9999) ||
      b.affectedLoads - a.affectedLoads ||
      a.carrierName.localeCompare(b.carrierName),
  );

  return NextResponse.json({
    alerts,
    windowDays: EXPIRY_WARNING_DAYS,
    counts: {
      total: alerts.length,
      critical: alerts.filter((a) => a.severity === "CRITICAL").length,
      warning: alerts.filter((a) => a.severity === "WARNING").length,
      affectedLoads: alerts.reduce((sum, a) => sum + a.affectedLoads, 0),
      blockedLoads: alerts.reduce((sum, a) => sum + a.blockedLoads, 0),
    },
  });
});
