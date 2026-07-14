import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { AuditOutcome } from "@/generated/prisma/enums";
import { handler, Invalid } from "@/lib/api/http";
import { requestMeta } from "@/lib/audit/log";
import { authorize, requireSession } from "@/lib/authz/guard";
import { prisma } from "@/lib/db";

/**
 * GET /api/audit — the organization's audit trail.
 *
 * Scope is `actorOrgId === session.orgId`, ANDed into every query below. An audit
 * trail is the most sensitive read surface in the product: it names who tried what
 * and failed. One org must never be able to read another's, and no query parameter
 * may widen the scope — filters can only narrow it.
 *
 * DENIED rows are the permission-denied log. They live in the same table as the
 * business events, which is why they are queryable here (and countable in `facets`)
 * rather than only being printed to a server console.
 */

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const querySchema = z.object({
  outcome: z.enum(AuditOutcome).optional(),
  loadId: z.string().min(1).optional(),
  action: z.string().min(1).max(64).optional(),
  q: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z.string().min(1).optional(),
});

/** Drop empty-string params so `?q=&action=` behaves like "no filter", not "match empty". */
function readParams(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    const trimmed = value.trim();
    if (trimmed !== "") out[key] = trimmed;
  }
  return out;
}

export const GET = handler(async (req: NextRequest) => {
  const meta = requestMeta(req);
  const session = await requireSession(); // 401 if absent
  await authorize(session, "audit.view", meta, { entityType: "AuditLog" }); // 403 + DENIED row

  const parsed = querySchema.safeParse(readParams(req.nextUrl));
  if (!parsed.success) {
    throw Invalid("Invalid audit query.", {
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    });
  }
  const { outcome, loadId, action, q, limit, cursor } = parsed.data;

  // The scope filter. Everything else is ANDed onto it and can only narrow it.
  const scope: Prisma.AuditLogWhereInput = { actorOrgId: session.orgId };

  // SQLite `contains` is already case-insensitive for ASCII (Prisma compiles it to
  // LIKE); `mode: "insensitive"` is not supported by the SQLite connector.
  const search: Prisma.AuditLogWhereInput | undefined = q
    ? {
        OR: [
          { summary: { contains: q } },
          { actorEmail: { contains: q } },
          { action: { contains: q } },
        ],
      }
    : undefined;

  // Facets deliberately ignore the `outcome` and `action` filters: the DENIED count
  // has to stay meaningful *while* the "denied only" toggle is on, and the action
  // list has to keep offering the other actions while one is selected. They do honour
  // `loadId` / `q`, so the counts describe the slice the user is actually looking at.
  const facetWhere: Prisma.AuditLogWhereInput = {
    AND: [scope, ...(loadId ? [{ loadId }] : []), ...(search ? [search] : [])],
  };

  const where: Prisma.AuditLogWhereInput = {
    AND: [
      facetWhere,
      ...(outcome ? [{ outcome }] : []),
      ...(action ? [{ action }] : []),
    ],
  };

  const [rows, total, deniedCount, actionGroups] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      // Newest first. `id` breaks ties so the cursor page boundary is deterministic
      // even for rows written inside the same millisecond (a transition and its
      // audit row routinely are).
      orderBy: [{ ts: "desc" }, { id: "desc" }],
      take: limit + 1, // one extra row tells us whether another page exists
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        ts: true,
        action: true,
        entityType: true,
        entityId: true,
        outcome: true,
        permission: true,
        fromStatus: true,
        toStatus: true,
        summary: true,
        detail: true,
        ip: true,
        method: true,
        path: true,
        // Denormalized on the row on purpose — the trail must survive the actor
        // being deleted, so we read these, not the (nullable) User relation.
        actorUserId: true,
        actorEmail: true,
        actorName: true,
        load: { select: { id: true, reference: true, status: true } },
      },
    }),
    prisma.auditLog.count({ where: facetWhere }),
    prisma.auditLog.count({ where: { AND: [facetWhere, { outcome: "DENIED" }] } }),
    prisma.auditLog.groupBy({
      by: ["action"],
      where: facetWhere,
      _count: { _all: true },
      orderBy: { _count: { action: "desc" } },
    }),
  ]);

  const hasMore = rows.length > limit;
  const entries = hasMore ? rows.slice(0, limit) : rows;

  return NextResponse.json({
    entries: entries.map((row) => ({
      id: row.id,
      ts: row.ts,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      outcome: row.outcome,
      permission: row.permission,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      summary: row.summary,
      detail: row.detail,
      ip: row.ip,
      method: row.method,
      path: row.path,
      actor: {
        userId: row.actorUserId,
        // Null only for pre-session bootstrap rows (signup / invite acceptance).
        name: row.actorName,
        email: row.actorEmail,
      },
      load: row.load,
    })),
    nextCursor: hasMore ? entries[entries.length - 1]!.id : null,
    facets: {
      total,
      deniedCount,
      allowedCount: total - deniedCount,
      actions: actionGroups.map((g) => ({ action: g.action, count: g._count._all })),
    },
  });
});
