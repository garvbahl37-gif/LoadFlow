import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { UserStatus } from "@/generated/prisma/enums";
import { Conflict, Invalid, NotFound } from "@/lib/api/http";
import { audit, NO_META, type RequestMeta } from "@/lib/audit/log";
import type { SessionUser } from "@/lib/auth/session";
import {
  PERMISSION_BY_KEY,
  PERMISSION_CATEGORIES,
  permissionsForOrgType,
  type PermissionDef,
  type PermissionKey,
} from "@/lib/authz/permissions";
import { prisma } from "@/lib/db";

/**
 * RBAC ADMINISTRATION — the service layer behind /api/permissions, /api/roles and
 * /api/staff. This is what makes the permission engine *real*: admins author roles
 * out of the fixed catalog here, and every authorization check in the product then
 * resolves against those roles.
 *
 * Three invariants are enforced in this file and nowhere else:
 *
 *   1. ORG-TYPE APPLICABILITY. A role may only ever hold permissions applicable to
 *      the org that owns it. The UI filters the catalog, but the UI is a courtesy —
 *      we re-derive the allowed set from the SESSION's org type and reject anything
 *      else with a 422. A carrier admin cannot forge `load.create` into a role.
 *
 *   2. OWNERSHIP. Every role and every user touched here is re-fetched with an
 *      `orgId: session.orgId` filter. Out-of-org → 404, never 403: one org must not
 *      be able to confirm the existence of another org's roles or people.
 *
 *   3. NO SELF-LOCKOUT. An org must always retain at least one ACTIVE user holding
 *      `staff.manage`. Checked INSIDE the write transaction against the post-write
 *      state, so it is impossible to slip past by racing two requests, and it covers
 *      every path: unassigning the last admin's role, disabling them, an admin
 *      demoting themselves, or stripping `staff.manage` out of the only role that
 *      still carries it.
 */

const STAFF_MANAGE: PermissionKey = "staff.manage";

// ─────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────

/**
 * `permissionKeys` may legitimately be EMPTY — a read-only role (the seeded Billing
 * Clerk holds zero permissions) is a real, useful thing to be able to author.
 */
export const roleCreateSchema = z.object({
  name: z.string().min(2, { error: "Give the role a name." }).max(60),
  description: z.string().max(300).optional(),
  permissionKeys: z.array(z.string()).max(50).default([]),
});
export type RoleCreateInput = z.infer<typeof roleCreateSchema>;

export const roleUpdateSchema = z
  .object({
    name: z.string().min(2, { error: "Give the role a name." }).max(60).optional(),
    description: z.string().max(300).nullable().optional(),
    permissionKeys: z.array(z.string()).max(50).optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined || v.permissionKeys !== undefined, {
    error: "Nothing to update.",
  });
export type RoleUpdateInput = z.infer<typeof roleUpdateSchema>;

export const staffUpdateSchema = z
  .object({
    roleIds: z.array(z.string()).max(20).optional(),
    status: z.enum(UserStatus).optional(),
  })
  .refine((v) => v.roleIds !== undefined || v.status !== undefined, {
    error: "Nothing to update.",
  });
export type StaffUpdateInput = z.infer<typeof staffUpdateSchema>;

// ─────────────────────────────────────────────────────────────
// Permission catalog
// ─────────────────────────────────────────────────────────────

export type PermissionGroup = { category: string; permissions: PermissionDef[] };

export type PermissionCatalog = {
  orgType: SessionUser["orgType"];
  permissions: PermissionDef[];
  groups: PermissionGroup[];
};

/**
 * The catalog as THIS caller's org is allowed to see it. A carrier admin is never
 * even offered `load.create` — it does not appear in the payload at all, so the UI
 * cannot render it and a scripted client cannot discover it here.
 */
export function catalogFor(session: SessionUser): PermissionCatalog {
  const permissions = permissionsForOrgType(session.orgType);

  const groups: PermissionGroup[] = PERMISSION_CATEGORIES.map((category) => ({
    category,
    permissions: permissions.filter((p) => p.category === category),
  })).filter((g) => g.permissions.length > 0);

  return { orgType: session.orgType, permissions, groups };
}

/** The set of keys this org type may put in a role. */
function allowedKeysFor(session: SessionUser): Set<string> {
  return new Set(permissionsForOrgType(session.orgType).map((p) => p.key));
}

/**
 * Defence in depth behind the UI's filtering: never trust the client's key list.
 * Unknown keys and keys that exist but do not apply to this org type both 422.
 */
function validateKeys(session: SessionUser, keys: string[]): PermissionKey[] {
  const allowed = allowedKeysFor(session);
  const deduped = [...new Set(keys)];
  const rejected = deduped.filter((k) => !allowed.has(k));

  if (rejected.length > 0) {
    throw Invalid(
      `${rejected.length === 1 ? "That permission is" : "Those permissions are"} not available to a ${session.orgType.toLowerCase()} organization.`,
      {
        fieldErrors: {
          permissionKeys: rejected.map(
            (k) =>
              `"${k}" is not a permission a ${session.orgType.toLowerCase()} organization may grant.`,
          ),
        },
        rejectedKeys: rejected,
      },
    );
  }

  return deduped as PermissionKey[];
}

function labelFor(key: string): string {
  return PERMISSION_BY_KEY[key as PermissionKey]?.label ?? key;
}

// ─────────────────────────────────────────────────────────────
// The lockout guard
// ─────────────────────────────────────────────────────────────

/**
 * Run INSIDE the mutating transaction, AFTER the write. If the org now has no
 * ACTIVE user holding `staff.manage`, the throw rolls the whole thing back.
 *
 * Doing it this way — asserting on the post-write state rather than simulating the
 * change beforehand — means every route that can possibly cause a lockout is
 * covered by construction: role re-assignment, disabling a user, an admin demoting
 * themselves, and re-bundling the permissions of the last role that grants it.
 */
export async function assertStaffManageSurvives(
  tx: Prisma.TransactionClient,
  orgId: string,
): Promise<void> {
  const holders = await tx.user.count({
    where: {
      orgId,
      status: "ACTIVE",
      roles: { some: { role: { permissions: { some: { permissionKey: STAFF_MANAGE } } } } },
    },
  });

  if (holders === 0) {
    throw Conflict(
      "That change would leave this organization with nobody able to manage staff and roles. At least one active user must keep the “Manage staff & roles” permission.",
      { permission: STAFF_MANAGE, remainingHolders: 0 },
    );
  }
}

// ─────────────────────────────────────────────────────────────
// Roles
// ─────────────────────────────────────────────────────────────

export type RoleSummary = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: Date;
  permissionKeys: PermissionKey[];
  permissions: { key: string; label: string; category: string }[];
  memberCount: number;
  grantsStaffManage: boolean;
};

const roleInclude = {
  permissions: true,
  _count: { select: { users: true } },
} satisfies Prisma.RoleInclude;

type RoleRow = Prisma.RoleGetPayload<{ include: typeof roleInclude }>;

function shapeRole(role: RoleRow): RoleSummary {
  const keys = role.permissions.map((p) => p.permissionKey);
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    createdAt: role.createdAt,
    permissionKeys: keys as PermissionKey[],
    permissions: keys.map((k) => ({
      key: k,
      label: labelFor(k),
      category: PERMISSION_BY_KEY[k as PermissionKey]?.category ?? "Other",
    })),
    memberCount: role._count.users,
    grantsStaffManage: keys.includes(STAFF_MANAGE),
  };
}

/** The caller's own org's roles. Never anyone else's. */
export async function listRoles(session: SessionUser): Promise<RoleSummary[]> {
  const roles = await prisma.role.findMany({
    where: { orgId: session.orgId },
    include: roleInclude,
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });
  return roles.map(shapeRole);
}

/** Fetch a role through the org filter. Out of org → 404, never 403. */
async function roleInOrgOrThrow(session: SessionUser, roleId: string): Promise<RoleRow> {
  const role = await prisma.role.findFirst({
    where: { id: roleId, orgId: session.orgId },
    include: roleInclude,
  });
  if (!role) throw NotFound("Role");
  return role;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "P2002"
  );
}

export async function createRole(
  session: SessionUser,
  input: RoleCreateInput,
  meta: RequestMeta = NO_META,
): Promise<RoleSummary> {
  const keys = validateKeys(session, input.permissionKeys);
  const name = input.name.trim();

  const clash = await prisma.role.findFirst({ where: { orgId: session.orgId, name } });
  if (clash) throw Conflict(`A role called “${name}” already exists in your organization.`);

  let role: RoleRow;
  try {
    role = await prisma.role.create({
      data: {
        orgId: session.orgId,
        name,
        description: input.description?.trim() || null,
        isSystem: false,
        permissions: { create: keys.map((key) => ({ permissionKey: key })) },
      },
      include: roleInclude,
    });
  } catch (err) {
    // The @@unique([orgId, name]) constraint is the real referee — the check above
    // is only there to produce a friendlier message.
    if (isUniqueViolation(err)) {
      throw Conflict(`A role called “${name}” already exists in your organization.`);
    }
    throw err;
  }

  await audit({
    actor: session,
    action: "ROLE_CREATED",
    entityType: "Role",
    entityId: role.id,
    permission: STAFF_MANAGE,
    summary:
      keys.length === 0
        ? `${session.name} created the role “${name}” with no permissions (read-only).`
        : `${session.name} created the role “${name}” with ${keys.length} permission${keys.length === 1 ? "" : "s"}: ${keys.map(labelFor).join(", ")}.`,
    detail: {
      role: name,
      description: input.description?.trim() || null,
      granted: keys,
      grantedLabels: keys.map(labelFor),
    },
    meta,
  });

  return shapeRole(role);
}

export async function updateRole(
  session: SessionUser,
  roleId: string,
  input: RoleUpdateInput,
  meta: RequestMeta = NO_META,
): Promise<RoleSummary> {
  const existing = await roleInOrgOrThrow(session, roleId);

  // The system role is what makes an admin an admin. It is not special-cased in any
  // authorization check — but it must not be editable, or an org could quietly
  // rewrite the meaning of "administrator" out from under its own audit trail.
  if (existing.isSystem) {
    throw Conflict(
      `“${existing.name}” is the built-in administrator role. Its name and permissions are fixed — create a custom role instead.`,
      { isSystem: true },
    );
  }

  const before = existing.permissions
    .map((p) => p.permissionKey as PermissionKey)
    .sort();
  const nextName = input.name !== undefined ? input.name.trim() : existing.name;
  const nextKeys =
    input.permissionKeys !== undefined
      ? validateKeys(session, input.permissionKeys).sort()
      : before;

  if (input.name !== undefined && nextName !== existing.name) {
    const clash = await prisma.role.findFirst({
      where: { orgId: session.orgId, name: nextName, NOT: { id: roleId } },
    });
    if (clash) throw Conflict(`A role called “${nextName}” already exists in your organization.`);
  }

  const added = nextKeys.filter((k) => !before.includes(k));
  const removed = before.filter((k) => !nextKeys.includes(k));

  let role: RoleRow;
  try {
    role = await prisma.$transaction(async (tx) => {
      const updated = await tx.role.update({
        where: { id: roleId },
        data: {
          name: nextName,
          ...(input.description !== undefined
            ? { description: input.description?.trim() || null }
            : {}),
          ...(input.permissionKeys !== undefined
            ? {
                permissions: {
                  deleteMany: { permissionKey: { in: removed } },
                  create: added.map((key) => ({ permissionKey: key })),
                },
              }
            : {}),
        },
        include: roleInclude,
      });

      // Stripping `staff.manage` out of the last role that carries it is a lockout
      // by another name. Same guard, same 409.
      if (removed.includes(STAFF_MANAGE)) {
        await assertStaffManageSurvives(tx, session.orgId);
      }

      return updated;
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw Conflict(`A role called “${nextName}” already exists in your organization.`);
    }
    throw err;
  }

  const renamed = nextName !== existing.name;
  const parts: string[] = [];
  if (renamed) parts.push(`renamed “${existing.name}” to “${nextName}”`);
  if (added.length) parts.push(`granted ${added.map(labelFor).join(", ")}`);
  if (removed.length) parts.push(`revoked ${removed.map(labelFor).join(", ")}`);
  if (parts.length === 0) parts.push("updated the description");

  await audit({
    actor: session,
    action: "ROLE_UPDATED",
    entityType: "Role",
    entityId: role.id,
    permission: STAFF_MANAGE,
    // The added/removed diff is exactly what an auditor asks for six months later:
    // "who widened this role, when, and by how much?"
    summary: `${session.name} ${parts.join("; ")} — affects ${role._count.users} user${role._count.users === 1 ? "" : "s"}.`,
    detail: {
      role: nextName,
      previousName: renamed ? existing.name : undefined,
      before,
      after: nextKeys,
      added,
      removed,
      addedLabels: added.map(labelFor),
      removedLabels: removed.map(labelFor),
      membersAffected: role._count.users,
    },
    meta,
  });

  return shapeRole(role);
}

export async function deleteRole(
  session: SessionUser,
  roleId: string,
  meta: RequestMeta = NO_META,
): Promise<{ id: string; name: string }> {
  const role = await roleInOrgOrThrow(session, roleId);

  if (role.isSystem) {
    throw Conflict(
      `“${role.name}” is the built-in administrator role and cannot be deleted.`,
      { isSystem: true },
    );
  }

  const members = role._count.users;
  if (members > 0) {
    throw Conflict(
      `“${role.name}” is still held by ${members} user${members === 1 ? "" : "s"}. Reassign ${members === 1 ? "them" : "them all"} to another role first.`,
      { memberCount: members },
    );
  }

  await prisma.role.delete({ where: { id: roleId } });

  await audit({
    actor: session,
    action: "ROLE_DELETED",
    entityType: "Role",
    entityId: role.id,
    permission: STAFF_MANAGE,
    summary: `${session.name} deleted the role “${role.name}”.`,
    detail: {
      role: role.name,
      revoked: role.permissions.map((p) => p.permissionKey),
    },
    meta,
  });

  return { id: role.id, name: role.name };
}

// ─────────────────────────────────────────────────────────────
// Staff
// ─────────────────────────────────────────────────────────────

export type StaffMember = {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  lastLoginAt: Date | null;
  createdAt: Date;
  isSelf: boolean;
  roles: { id: string; name: string; isSystem: boolean }[];
  /** Union across every role held, then filtered by what this org type may hold. */
  effectivePermissions: PermissionKey[];
  permissionCount: number;
  canManageStaff: boolean;
};

const staffInclude = {
  roles: { include: { role: { include: { permissions: true } } } },
} satisfies Prisma.UserInclude;

type StaffRow = Prisma.UserGetPayload<{ include: typeof staffInclude }>;

function shapeStaff(session: SessionUser, user: StaffRow): StaffMember {
  const allowed = allowedKeysFor(session);

  const union = new Set<string>();
  for (const ur of user.roles) {
    for (const rp of ur.role.permissions) {
      // Same org-type filter `can()` applies at check time, so what the UI shows is
      // exactly what the engine would honour — not a superset.
      if (allowed.has(rp.permissionKey)) union.add(rp.permissionKey);
    }
  }

  const effective = [...union] as PermissionKey[];

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    status: user.status,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    isSelf: user.id === session.userId,
    roles: user.roles.map((ur) => ({
      id: ur.role.id,
      name: ur.role.name,
      isSystem: ur.role.isSystem,
    })),
    effectivePermissions: effective,
    permissionCount: effective.length,
    canManageStaff: union.has(STAFF_MANAGE),
  };
}

export async function listStaff(session: SessionUser): Promise<StaffMember[]> {
  const users = await prisma.user.findMany({
    where: { orgId: session.orgId },
    include: staffInclude,
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
  });
  return users.map((u) => shapeStaff(session, u));
}

/**
 * Change a user's roles and/or their status.
 *
 * Everything is derived from the session: the org is the caller's org, the actor is
 * the caller. The client supplies only a user id (which we re-scope) and role ids
 * (which must belong to the caller's org).
 */
export async function updateStaff(
  session: SessionUser,
  userId: string,
  input: StaffUpdateInput,
  meta: RequestMeta = NO_META,
): Promise<StaffMember> {
  // Cross-org tenancy: a user outside your org simply does not exist to you.
  const existing = await prisma.user.findFirst({
    where: { id: userId, orgId: session.orgId },
    include: staffInclude,
  });
  if (!existing) throw NotFound("User");

  const beforeRoles = existing.roles.map((ur) => ({ id: ur.roleId, name: ur.role.name }));
  const beforeIds = beforeRoles.map((r) => r.id).sort();

  let nextRoles = beforeRoles;
  let nextIds = beforeIds;

  if (input.roleIds !== undefined) {
    const requested = [...new Set(input.roleIds)];

    // You cannot grant a role you do not own. 422, not 404: the caller sent us a bad
    // value in a field, and that is a validation problem.
    const roles = requested.length
      ? await prisma.role.findMany({ where: { id: { in: requested }, orgId: session.orgId } })
      : [];

    if (roles.length !== requested.length) {
      const found = new Set(roles.map((r) => r.id));
      const unknown = requested.filter((id) => !found.has(id));
      throw Invalid("One or more roles do not belong to your organization.", {
        fieldErrors: { roleIds: ["One or more roles do not belong to your organization."] },
        rejectedRoleIds: unknown,
      });
    }

    nextRoles = roles.map((r) => ({ id: r.id, name: r.name }));
    nextIds = nextRoles.map((r) => r.id).sort();
  }

  const nextStatus = input.status ?? existing.status;

  const addedRoles = nextRoles.filter((r) => !beforeIds.includes(r.id));
  const removedRoles = beforeRoles.filter((r) => !nextIds.includes(r.id));
  const statusChanged = nextStatus !== existing.status;

  const updated = await prisma.$transaction(async (tx) => {
    if (input.roleIds !== undefined) {
      if (removedRoles.length) {
        await tx.userRole.deleteMany({
          where: { userId, roleId: { in: removedRoles.map((r) => r.id) } },
        });
      }
      if (addedRoles.length) {
        await tx.userRole.createMany({
          data: addedRoles.map((r) => ({
            userId,
            roleId: r.id,
            assignedById: session.userId,
          })),
        });
      }
    }

    if (statusChanged) {
      await tx.user.update({ where: { id: userId }, data: { status: nextStatus } });
      // A disabled user's live sessions must die immediately, not at expiry. This is
      // the payoff of DB-backed sessions.
      if (nextStatus === "DISABLED") {
        await tx.session.deleteMany({ where: { userId } });
      }
    }

    // THE LOCKOUT GUARD. Asserted on the post-write state, inside the transaction, so
    // it catches every route to zero: pulling the last admin's role, disabling them,
    // or an admin demoting themselves. A failure rolls the whole change back.
    await assertStaffManageSurvives(tx, session.orgId);

    return tx.user.findFirstOrThrow({ where: { id: userId }, include: staffInclude });
  });

  const disabled = statusChanged && nextStatus === "DISABLED";
  const parts: string[] = [];
  if (addedRoles.length) parts.push(`granted ${addedRoles.map((r) => r.name).join(", ")}`);
  if (removedRoles.length) parts.push(`revoked ${removedRoles.map((r) => r.name).join(", ")}`);
  if (statusChanged) parts.push(disabled ? "disabled the account" : "re-activated the account");
  if (parts.length === 0) parts.push("made no effective change");

  const self = existing.id === session.userId;

  await audit({
    actor: session,
    action: disabled ? "STAFF_DISABLED" : "STAFF_UPDATED",
    entityType: "User",
    entityId: existing.id,
    permission: STAFF_MANAGE,
    summary: `${session.name} ${parts.join("; ")} for ${self ? "their own account" : existing.name} (${existing.email}).`,
    detail: {
      user: existing.email,
      self,
      rolesBefore: beforeRoles.map((r) => r.name),
      rolesAfter: nextRoles.map((r) => r.name),
      rolesAdded: addedRoles.map((r) => r.name),
      rolesRemoved: removedRoles.map((r) => r.name),
      statusBefore: existing.status,
      statusAfter: nextStatus,
    },
    meta,
  });

  return shapeStaff(session, updated);
}
