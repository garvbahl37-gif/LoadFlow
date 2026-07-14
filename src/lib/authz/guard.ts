import type { Prisma } from "@/generated/prisma/client";
import type { OrgType } from "@/generated/prisma/enums";
import { Forbidden, NotFound, Unauthenticated } from "@/lib/api/http";
import { audit, NO_META, type RequestMeta } from "@/lib/audit/log";
import { getSession, type SessionUser } from "@/lib/auth/session";
import { PERMISSION_BY_KEY, type PermissionKey } from "@/lib/authz/permissions";
import { prisma } from "@/lib/db";

/**
 * THE authorization primitive. Every check in this codebase resolves to this.
 * Note what it does not do: it never looks at a role's name.
 *
 * Two independent locks:
 *   1. Does the user actually hold the permission (union across their roles)?
 *   2. Is the permission even applicable to their org type?
 *
 * (2) is defence in depth. The role builder will never offer a Carrier the
 * `load.create` permission, but if a row were ever forged into the DB, a Carrier
 * still could not create loads. Shippers have no roles at all, so they fail (2)
 * unconditionally — their access is defined entirely by object-level scoping.
 */
export function can(session: SessionUser, permission: PermissionKey): boolean {
  const def = PERMISSION_BY_KEY[permission];
  if (!def) return false;

  if (session.orgType === "BROKER" && !def.forBroker) return false;
  if (session.orgType === "CARRIER" && !def.forCarrier) return false;
  if (session.orgType === "SHIPPER") return false;

  return session.permissions.includes(permission);
}

/** Every permission the session effectively has, after the org-type filter. */
export function effectivePermissions(session: SessionUser): PermissionKey[] {
  return session.permissions.filter((p) => can(session, p));
}

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) throw Unauthenticated();
  return session;
}

/**
 * Authenticate + authorize in one call. Throws 403 and writes a DENIED audit row
 * on failure — that row IS the "log permission-denied attempts" requirement, and
 * because it lives in the audit table it is queryable in the UI, not just printed.
 */
export async function requirePermission(
  permission: PermissionKey,
  meta: RequestMeta = NO_META,
  context?: { entityType?: string; entityId?: string | null; loadId?: string | null },
): Promise<SessionUser> {
  const session = await requireSession();
  await authorize(session, permission, meta, context);
  return session;
}

/** Same check, for callers that already hold a resolved session. */
export async function authorize(
  session: SessionUser,
  permission: PermissionKey,
  meta: RequestMeta = NO_META,
  context?: { entityType?: string; entityId?: string | null; loadId?: string | null },
): Promise<void> {
  if (can(session, permission)) return;

  await audit({
    actor: session,
    action: "PERMISSION_DENIED",
    entityType: context?.entityType ?? "Permission",
    entityId: context?.entityId ?? null,
    loadId: context?.loadId ?? null,
    outcome: "DENIED",
    permission,
    summary: `Blocked: ${session.email} attempted an action requiring "${permission}" without holding it.`,
    detail: {
      heldPermissions: session.permissions,
      roles: session.roles.map((r) => r.name),
      orgType: session.orgType,
    },
    meta,
  });

  throw Forbidden(permission);
}

/** Reject an actor whose org type has no business on this endpoint at all. */
export async function requireOrgType(
  session: SessionUser,
  types: OrgType[],
  meta: RequestMeta = NO_META,
): Promise<void> {
  if (types.includes(session.orgType)) return;

  await audit({
    actor: session,
    action: "ORG_TYPE_DENIED",
    entityType: "Endpoint",
    outcome: "DENIED",
    summary: `Blocked: a ${session.orgType} account attempted an endpoint restricted to ${types.join("/")}.`,
    meta,
  });

  throw Forbidden(`${types.join(" or ")} account required`);
}

/**
 * Object-level scoping. Applied INDEPENDENTLY of permissions and always ANDed into
 * the query — permissions can widen what you may *do*, never what you may *see*.
 *
 *   Broker  → loads it brokered
 *   Carrier → loads tendered to it (never the marketplace, never a rival's freight)
 *   Shipper → its own freight, and nothing else
 */
export function loadScope(session: SessionUser): Prisma.LoadWhereInput {
  switch (session.orgType) {
    case "BROKER":
      return { brokerOrgId: session.orgId };
    case "CARRIER":
      return { carrierOrgId: session.orgId };
    case "SHIPPER":
      return { shipperOrgId: session.orgId };
  }
}

/**
 * Fetch a load through the scope filter. Out-of-scope loads 404 rather than 403 —
 * we never confirm the existence of a record the caller may not see. The attempt is
 * still audited, because a carrier probing another carrier's load IDs is exactly the
 * signal an ops team wants to see.
 */
export async function loadInScopeOrThrow<T extends Prisma.LoadInclude>(
  session: SessionUser,
  loadId: string,
  include?: T,
  meta: RequestMeta = NO_META,
) {
  const load = await prisma.load.findFirst({
    where: { AND: [{ id: loadId }, loadScope(session)] },
    ...(include ? { include } : {}),
  });

  if (!load) {
    await audit({
      actor: session,
      action: "SCOPE_DENIED",
      entityType: "Load",
      entityId: loadId,
      outcome: "DENIED",
      summary: `Blocked: ${session.email} requested load ${loadId}, which is outside their organization's scope.`,
      meta,
    });
    throw NotFound("Load");
  }

  return load as Prisma.LoadGetPayload<{ include: T }>;
}
