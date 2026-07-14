import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { LoadStatus } from "@/generated/prisma/enums";
import { handler, Invalid, parseBody } from "@/lib/api/http";
import { requestMeta } from "@/lib/audit/log";
import { audit } from "@/lib/audit/log";
import { authorize, loadScope, requireSession } from "@/lib/authz/guard";
import { prisma } from "@/lib/db";
import { COMMODITY_TYPES, EQUIPMENT_TYPES } from "@/lib/format";
import { LOAD_STATUSES } from "@/lib/loads/state-machine";

/**
 * The load board's single query.
 *
 * Scope (loadScope) is ANDed into EVERY branch of the where clause — a filter the
 * client sends can only ever narrow what it already may see, never widen it.
 *
 * Note on `q`: this is SQLite. Prisma's `contains` compiles to `LIKE '%x%'`, and
 * SQLite's LIKE is case-insensitive for ASCII by default, so `mode: "insensitive"`
 * is neither needed nor supported by this provider at runtime. Verified against the
 * generated client: passing `mode` on sqlite is rejected, so it is not used here.
 */

const ORG_SUMMARY = { select: { id: true, name: true, city: true, state: true } } as const;

const FLAG_SUMMARY = {
  where: { status: "OPEN" as const },
  orderBy: { raisedAt: "desc" as const },
  select: {
    id: true,
    code: true,
    severity: true,
    message: true,
    status: true,
    raisedAt: true,
  },
} as const;

const LIST_INCLUDE = {
  shipperOrg: ORG_SUMMARY,
  brokerOrg: ORG_SUMMARY,
  carrierOrg: ORG_SUMMARY,
  confirmedRate: {
    select: {
      id: true,
      version: true,
      baseRateCents: true,
      totalRateCents: true,
      accessorials: true,
      status: true,
      createdAt: true,
    },
  },
  complianceFlags: FLAG_SUMMARY,
  _count: { select: { rateConfirmations: true, pods: true } },
} satisfies Prisma.LoadInclude;

function parseStatuses(raw: string[]): LoadStatus[] {
  const values = raw
    .flatMap((v) => v.split(","))
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean);

  const bad = values.filter((v) => !(LOAD_STATUSES as string[]).includes(v));
  if (bad.length > 0) {
    throw Invalid(`Unknown status filter: ${bad.join(", ")}.`, {
      fieldErrors: { status: [`Valid values: ${LOAD_STATUSES.join(", ")}.`] },
    });
  }
  return [...new Set(values)] as LoadStatus[];
}

export const GET = handler(async (req: NextRequest) => {
  const session = await requireSession();
  const sp = req.nextUrl.searchParams;

  const q = sp.get("q")?.trim() ?? "";
  const statuses = parseStatuses(sp.getAll("status"));
  const carrierOrgId = sp.get("carrierOrgId")?.trim() || null;
  const flagged = sp.get("flagged") === "true";
  const limitRaw = Number(sp.get("limit") ?? 200);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 500) : 200;

  const and: Prisma.LoadWhereInput[] = [loadScope(session)];

  if (q) {
    and.push({
      OR: [
        { reference: { contains: q } },
        { originCity: { contains: q } },
        { originState: { contains: q } },
        { destCity: { contains: q } },
        { destState: { contains: q } },
        { commodity: { contains: q } },
        { equipmentType: { contains: q } },
        { carrierOrg: { name: { contains: q } } },
        { shipperOrg: { name: { contains: q } } },
      ],
    });
  }

  if (statuses.length > 0) and.push({ status: { in: statuses } });
  if (carrierOrgId) and.push({ carrierOrgId });
  if (flagged) {
    and.push({ complianceFlags: { some: { status: "OPEN", severity: "BLOCKING" } } });
  }

  const where: Prisma.LoadWhereInput = { AND: and };

  const [rows, total, byStatus] = await Promise.all([
    prisma.load.findMany({
      where,
      include: LIST_INCLUDE,
      orderBy: [{ pickupAt: "asc" }, { reference: "asc" }],
      take: limit,
    }),
    prisma.load.count({ where }),
    // Facet counts respect scope but ignore the status filter, so the board's
    // status chips can show "how many are there" without a second round trip.
    prisma.load.groupBy({
      by: ["status"],
      where: { AND: and.filter((c) => !("status" in c)) },
      _count: { _all: true },
    }),
  ]);

  const loads = rows.map((load) => {
    const openFlags = load.complianceFlags;
    const openBlocking = openFlags.filter((f) => f.severity === "BLOCKING").length;
    const openWarning = openFlags.length - openBlocking;
    return {
      ...load,
      complianceFlags: undefined,
      openFlags,
      openBlocking,
      openWarning,
      blocked: openBlocking > 0,
      rateVersionCount: load._count.rateConfirmations,
      podCount: load._count.pods,
    };
  });

  // Blocked freight is the thing an ops desk must look at first; after that, the
  // truck that leaves soonest.
  loads.sort((a, b) => {
    if (a.blocked !== b.blocked) return a.blocked ? -1 : 1;
    return a.pickupAt.getTime() - b.pickupAt.getTime();
  });

  const statusCounts = Object.fromEntries(
    LOAD_STATUSES.map((s) => [s, byStatus.find((g) => g.status === s)?._count._all ?? 0]),
  ) as Record<LoadStatus, number>;

  return NextResponse.json({
    loads,
    total,
    statusCounts,
    blockedCount: loads.filter((l) => l.blocked).length,
    filters: { q, status: statuses, carrierOrgId, flagged, limit },
  });
});

// ── POST /api/loads ─────────────────────────────────────────

const createSchema = z
  .object({
    shipperOrgId: z.string().min(1, { error: "Choose a shipper." }),
    originCity: z.string().min(1, { error: "Required" }).max(80),
    originState: z
      .string()
      .trim()
      .length(2, { error: "Two-letter state code." })
      .transform((s) => s.toUpperCase()),
    destCity: z.string().min(1, { error: "Required" }).max(80),
    destState: z
      .string()
      .trim()
      .length(2, { error: "Two-letter state code." })
      .transform((s) => s.toUpperCase()),
    pickupAt: z.coerce.date({ error: "A valid pickup date is required." }),
    deliverBy: z.coerce.date({ error: "A valid delivery date is required." }),
    commodity: z.enum(COMMODITY_TYPES, { error: "Choose a commodity." }),
    equipmentType: z.enum(EQUIPMENT_TYPES, { error: "Choose an equipment type." }),
    weightLbs: z.number().int().min(1, { error: "Weight must be positive." }).max(80_000, {
      error: "80,000 lb is the legal gross limit.",
    }),
    declaredValueCents: z.number().int().min(0, { error: "Declared value cannot be negative." }),
    offeredRateCents: z.number().int().min(1, { error: "An offered rate is required." }),
    notes: z.string().max(1000).optional(),
  })
  .refine((v) => v.deliverBy.getTime() >= v.pickupAt.getTime(), {
    error: "Delivery must be on or after pickup.",
    path: ["deliverBy"],
  });

/** Next `LF-####`. Inside the transaction, so two concurrent posts cannot collide. */
async function nextReference(tx: Prisma.TransactionClient): Promise<string> {
  const last = await tx.load.findFirst({
    where: { reference: { startsWith: "LF-" } },
    orderBy: { reference: "desc" },
    select: { reference: true },
  });
  const n = last ? Number.parseInt(last.reference.slice(3), 10) : 1000;
  const next = Number.isFinite(n) ? n + 1 : 1001;
  return `LF-${String(next).padStart(4, "0")}`;
}

export const POST = handler(async (req: NextRequest) => {
  const meta = requestMeta(req);
  const session = await requireSession();
  await authorize(session, "load.create", meta, { entityType: "Load" });

  const body = await parseBody(req, createSchema);

  const shipper = await prisma.org.findFirst({
    where: { id: body.shipperOrgId, type: "SHIPPER" },
    select: { id: true, name: true },
  });
  if (!shipper) {
    throw Invalid("That shipper does not exist.", {
      fieldErrors: { shipperOrgId: ["Choose a shipper organization."] },
    });
  }

  // brokerOrgId and createdById come from the SESSION. Never from the body.
  let load;
  for (let attempt = 0; ; attempt++) {
    try {
      load = await prisma.$transaction(async (tx) => {
        const reference = await nextReference(tx);
        return tx.load.create({
          data: {
            reference,
            shipperOrgId: shipper.id,
            brokerOrgId: session.orgId,
            createdById: session.userId,
            status: "POSTED",
            originCity: body.originCity,
            originState: body.originState,
            destCity: body.destCity,
            destState: body.destState,
            pickupAt: body.pickupAt,
            deliverBy: body.deliverBy,
            commodity: body.commodity,
            equipmentType: body.equipmentType,
            weightLbs: body.weightLbs,
            declaredValueCents: body.declaredValueCents,
            offeredRateCents: body.offeredRateCents,
            notes: body.notes ?? null,
          },
          include: LIST_INCLUDE,
        });
      });
      break;
    } catch (err) {
      // P2002 on `reference` = a concurrent post took the number we picked. Retry.
      const code = (err as { code?: string })?.code;
      if (code === "P2002" && attempt < 4) continue;
      throw err;
    }
  }

  await audit({
    actor: session,
    action: "LOAD_CREATED",
    entityType: "Load",
    entityId: load.id,
    loadId: load.id,
    toStatus: "POSTED",
    summary: `Load ${load.reference} posted: ${load.originCity}, ${load.originState} → ${load.destCity}, ${load.destState} for ${shipper.name}.`,
    detail: {
      reference: load.reference,
      shipperOrgId: shipper.id,
      shipperName: shipper.name,
      commodity: load.commodity,
      equipmentType: load.equipmentType,
      weightLbs: load.weightLbs,
      declaredValueCents: load.declaredValueCents,
      offeredRateCents: load.offeredRateCents,
    },
    meta,
  });

  return NextResponse.json({ load }, { status: 201 });
});
