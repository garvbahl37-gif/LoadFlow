import { NextResponse, type NextRequest } from "next/server";
import { handler } from "@/lib/api/http";
import { requestMeta } from "@/lib/audit/log";
import { loadInScopeOrThrow, requireSession } from "@/lib/authz/guard";
import { prisma } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

/**
 * The load's timeline: every attributed, timestamped event on this load — business
 * events AND denied attempts against it — newest first.
 *
 * Scope only (docs/API.md): if the load is not yours, it does not exist (404), and
 * the probe itself is audited by loadInScopeOrThrow.
 */
export const GET = handler(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const meta = requestMeta(req);
  const session = await requireSession();

  const load = await loadInScopeOrThrow(session, id, undefined, meta);

  const raw = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.trunc(raw), MAX_LIMIT) : DEFAULT_LIMIT;

  const rows = await prisma.auditLog.findMany({
    where: { loadId: load.id },
    orderBy: { ts: "desc" },
    take: limit,
    include: {
      actorUser: { select: { id: true, name: true, email: true } },
      actorOrg: { select: { id: true, name: true, type: true } },
    },
  });

  const events = rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    outcome: r.outcome,
    permission: r.permission,
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    summary: r.summary,
    detail: r.detail,
    ip: r.ip,
    method: r.method,
    path: r.path,
    // Denormalized on the row so the trail survives the actor being deleted;
    // the live user is preferred when it still exists.
    actor: {
      userId: r.actorUserId,
      name: r.actorUser?.name ?? r.actorName,
      email: r.actorUser?.email ?? r.actorEmail,
      orgId: r.actorOrgId,
      orgName: r.actorOrg?.name ?? null,
      orgType: r.actorOrg?.type ?? null,
    },
  }));

  return NextResponse.json({
    loadId: load.id,
    reference: load.reference,
    count: events.length,
    events,
  });
});
