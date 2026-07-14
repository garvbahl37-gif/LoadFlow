/**
 * The wire shapes of the RBAC administration API (docs/API.md § RBAC administration).
 *
 * Declared locally rather than imported from `@/lib/rbac/service` on purpose: these
 * are consumed by Client Components, and the service module pulls in Prisma. Dates
 * arrive as ISO strings over JSON, not as `Date`.
 */

export type OrgTypeDTO = "BROKER" | "CARRIER" | "SHIPPER";

export type PermissionDTO = {
  key: string;
  label: string;
  description: string;
  category: string;
  forBroker: boolean;
  forCarrier: boolean;
};

/** GET /api/permissions — already filtered to what THIS org type may grant. */
export type PermissionCatalogDTO = {
  orgType: OrgTypeDTO;
  permissions: PermissionDTO[];
  groups: { category: string; permissions: PermissionDTO[] }[];
};

/** GET /api/roles */
export type RoleDTO = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  permissionKeys: string[];
  permissions: { key: string; label: string; category: string }[];
  memberCount: number;
  grantsStaffManage: boolean;
};

export type RoleRefDTO = { id: string; name: string; isSystem: boolean };

/** GET /api/staff */
export type StaffDTO = {
  id: string;
  name: string;
  email: string;
  status: "ACTIVE" | "DISABLED";
  lastLoginAt: string | null;
  createdAt: string;
  isSelf: boolean;
  roles: RoleRefDTO[];
  /** The union across every role held — this is what `can()` resolves against. */
  effectivePermissions: string[];
  permissionCount: number;
  canManageStaff: boolean;
};

/** GET/POST /api/invites */
export type InviteDTO = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  token: string;
  /** No mail server: the admin copies this and sends it themselves. */
  acceptUrl: string;
  roles: RoleRefDTO[];
  invitedBy: { name: string; email: string } | null;
};
