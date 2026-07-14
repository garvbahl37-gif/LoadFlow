import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { handler, parseBody } from "@/lib/api/http";
import { audit, requestMeta } from "@/lib/audit/log";
import { authorize, can, requireSession } from "@/lib/authz/guard";
import { FLAG_LABEL, reevaluateCarrier, type FlagCode } from "@/lib/compliance/evaluator";
import {
  blockedLoadsForCarrier,
  carrierInScopeOrThrow,
  complianceInputSchema,
  complianceStateOf,
  COMPLIANCE_FIELD_LABEL,
  daysUntilExpiry,
  diffCompliance,
  liveLoadsForCarrier,
  toCarrierDTO,
  toComplianceDTO,
} from "@/lib/compliance/schema";
import { prisma } from "@/lib/db";
import { TERMINAL_STATUSES } from "@/lib/loads/state-machine";

type Ctx = { params: Promise<{ orgId: string }> };

const loadSummarySelect = {
  id: true,
  reference: true,
  status: true,
  originCity: true,
  originState: true,
  destCity: true,
  destState: true,
  pickupAt: true,
  equipmentType: true,
  commodity: true,
} satisfies Prisma.LoadSelect;

/**
 * GET /api/carriers/[orgId]/compliance
 *
 * Read is scope-only: a broker may read any carrier's record (vetting), a carrier may
 * read only its own. Anything else is a 404 — never a 403, which would confirm that
 * the org id exists.
 */
export const GET = handler(async (req: NextRequest, ctx: Ctx) => {
  const { orgId } = await ctx.params; // Next 16: params is a Promise
  const meta = requestMeta(req);
  const session = await requireSession();

  const org = await carrierInScopeOrThrow(session, orgId, meta);
  const compliance = await prisma.carrierCompliance.findUnique({ where: { orgId: org.id } });

  const now = new Date();
  const [liveLoads, blockedLoadRows, openFlags] = await Promise.all([
    prisma.load.count({ where: liveLoadsForCarrier(session, org.id) }),
    prisma.load.findMany({
      where: blockedLoadsForCarrier(session, org.id),
      select: {
        ...loadSummarySelect,
        complianceFlags: {
          where: { status: "OPEN" },
          select: { id: true, code: true, severity: true, message: true, raisedAt: true },
        },
      },
      orderBy: { pickupAt: "asc" },
    }),
    prisma.complianceFlag.count({
      where: {
        status: "OPEN",
        severity: "BLOCKING",
        load: liveLoadsForCarrier(session, org.id),
      },
    }),
  ]);

  return NextResponse.json({
    carrier: toCarrierDTO(org),
    compliance: compliance ? toComplianceDTO(compliance) : null,
    complianceState: complianceStateOf(compliance, now),
    daysUntilExpiry: compliance ? daysUntilExpiry(compliance.insuranceExpiry, now) : null,
    liveLoads,
    blockedLoads: blockedLoadRows.length,
    openBlockingFlags: openFlags,
    /** The loads this record is currently holding — the cost of not fixing it. */
    blockedLoadDetail: blockedLoadRows,
    // A courtesy for the UI only. The PUT below re-checks this server-side regardless —
    // hiding the form is never the control.
    canEdit:
      can(session, "compliance.manage") &&
      (session.orgType === "BROKER" || session.orgId === org.id),
  });
});

/**
 * PUT /api/carriers/[orgId]/compliance — the feature.
 *
 * Upsert the record, then RE-EVALUATE EVERY LIVE LOAD this carrier is on. Renewing a
 * policy unblocks that carrier's held loads with no further clicks; letting it lapse
 * stops them, immediately, on the next request. The gate is not a nightly job and it
 * is not a UI state — it is a consequence of this write.
 *
 * Authorization: `compliance.manage` AND (broker, or a carrier editing its OWN org).
 * A carrier admin who holds `compliance.manage` and points it at a rival's org id gets
 * a 404 — the permission grants a capability, never a wider scope.
 */
export const PUT = handler(async (req: NextRequest, ctx: Ctx) => {
  const { orgId } = await ctx.params;
  const meta = requestMeta(req);

  const session = await requireSession();
  await authorize(session, "compliance.manage", meta, { entityType: "CarrierCompliance", entityId: orgId });

  // Scope AFTER permission, and independent of it. Permissions never widen scope.
  const org = await carrierInScopeOrThrow(session, orgId, meta);
  const input = await parseBody(req, complianceInputSchema);

  const before = await prisma.carrierCompliance.findUnique({ where: { orgId: org.id } });

  // Snapshot which of this carrier's live loads were blocked BEFORE the write, so we
  // can tell the user exactly what their edit just freed up (or just stopped).
  const liveBefore = await prisma.load.findMany({
    where: {
      carrierOrgId: org.id,
      status: { notIn: TERMINAL_STATUSES },
    },
    select: {
      ...loadSummarySelect,
      brokerOrgId: true,
      _count: {
        select: { complianceFlags: { where: { status: "OPEN", severity: "BLOCKING" } } },
      },
    },
  });
  const blockedBefore = new Map(liveBefore.map((l) => [l.id, l._count.complianceFlags > 0]));

  const data = {
    insuranceProvider: input.insuranceProvider,
    insurancePolicyNumber: input.insurancePolicyNumber,
    insuranceExpiry: input.insuranceExpiry,
    cargoInsuranceCents: input.cargoInsuranceCents,
    autoLiabilityCents: input.autoLiabilityCents,
    mcNumber: input.mcNumber,
    dotNumber: input.dotNumber,
    authorityStatus: input.authorityStatus,
    approvedEquipment: input.approvedEquipment,
    approvedCommodities: input.approvedCommodities,
    notes: input.notes ?? null,
    updatedById: session.userId,
  };

  const diff = diffCompliance(before, input);

  const compliance = await prisma.carrierCompliance.upsert({
    where: { orgId: org.id },
    create: { orgId: org.id, ...data },
    update: data,
  });

  // The Org row mirrors MC/DOT for display; keep the two from drifting apart.
  if (org.mcNumber !== input.mcNumber || org.dotNumber !== input.dotNumber) {
    await prisma.org.update({
      where: { id: org.id },
      data: { mcNumber: input.mcNumber, dotNumber: input.dotNumber },
    });
  }

  // ── The cascade. Every live load on this carrier is re-checked. ──
  const results = await reevaluateCarrier(org.id, session, meta);

  const unblockedIds: string[] = [];
  const newlyBlockedIds: string[] = [];
  const raisedCodes = new Set<FlagCode>();
  const resolvedCodes = new Set<FlagCode>();

  for (const { loadId, result } of results) {
    const wasBlocked = blockedBefore.get(loadId) ?? false;
    const isBlocked = result.openBlocking > 0;
    if (wasBlocked && !isBlocked) unblockedIds.push(loadId);
    if (!wasBlocked && isBlocked) newlyBlockedIds.push(loadId);
    for (const r of result.raised) raisedCodes.add(r.code);
    for (const c of result.resolved) resolvedCodes.add(c);
  }

  const byId = new Map(liveBefore.map((l) => [l.id, l]));
  const summarize = (ids: string[]) =>
    ids
      .map((id) => byId.get(id))
      .filter((l): l is NonNullable<typeof l> => Boolean(l))
      .map((l) => ({
        id: l.id,
        reference: l.reference,
        status: l.status,
        originCity: l.originCity,
        originState: l.originState,
        destCity: l.destCity,
        destState: l.destState,
        pickupAt: l.pickupAt,
        equipmentType: l.equipmentType,
        commodity: l.commodity,
      }));

  const unblocked = summarize(unblockedIds);
  const newlyBlocked = summarize(newlyBlockedIds);

  const state = complianceStateOf(compliance);
  const changed = Object.keys(diff);

  await audit({
    actor: session,
    action: "COMPLIANCE_UPDATED",
    entityType: "CarrierCompliance",
    entityId: compliance.id,
    summary: before
      ? changed.length > 0
        ? `${session.name} updated ${org.name}'s compliance record (${changed
            .map((f) => COMPLIANCE_FIELD_LABEL[f as keyof typeof COMPLIANCE_FIELD_LABEL] ?? f)
            .join(", ")}). ${unblocked.length} load${unblocked.length === 1 ? "" : "s"} unblocked, ${newlyBlocked.length} newly blocked.`
        : `${session.name} saved ${org.name}'s compliance record with no changes.`
      : `${session.name} created a compliance record for ${org.name}.`,
    detail: {
      carrierOrgId: org.id,
      carrierName: org.name,
      created: !before,
      changed,
      diff,
      complianceState: state,
      reevaluatedLoads: results.length,
      unblocked: unblocked.map((l) => l.reference),
      newlyBlocked: newlyBlocked.map((l) => l.reference),
      flagsRaised: [...raisedCodes].map((c) => FLAG_LABEL[c]),
      flagsResolved: [...resolvedCodes].map((c) => FLAG_LABEL[c]),
    },
    meta,
  });

  return NextResponse.json({
    carrier: toCarrierDTO(org),
    compliance: toComplianceDTO(compliance),
    complianceState: state,
    daysUntilExpiry: daysUntilExpiry(compliance.insuranceExpiry),
    /** How many live loads were re-checked as a direct result of this write. */
    reevaluated: results.length,
    unblocked,
    newlyBlocked,
    unblockedCount: unblocked.length,
    newlyBlockedCount: newlyBlocked.length,
    changed,
    diff,
  });
});
