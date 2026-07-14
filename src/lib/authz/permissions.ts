/**
 * The permission catalog — the fixed vocabulary of things that can be done.
 *
 * This is the ONLY source of truth. The seed mirrors it into the `Permission`
 * table so that RolePermission rows have referential integrity, but the code
 * here is authoritative: permissions are not user-editable at runtime.
 *
 * Roles are bundles of these keys, authored by org admins through the UI.
 * Authorization code checks a KEY, never a role name.
 */

export const PERMISSIONS = [
  // ── Loads (broker) ────────────────────────────────────────
  {
    key: "load.create",
    label: "Create & edit loads",
    description: "Post new loads to the board, edit their details, and cancel them.",
    category: "Loads",
    forBroker: true,
    forCarrier: false,
  },
  {
    key: "load.assign_carrier",
    label: "Assign carriers",
    description: "Tender a load to a carrier. Triggers an automatic compliance check.",
    category: "Loads",
    forBroker: true,
    forCarrier: false,
  },
  {
    key: "load.override_compliance_flag",
    label: "Override compliance flags",
    description:
      "Force a load past a blocking compliance flag. Requires a written reason and is recorded in the audit trail permanently.",
    category: "Compliance",
    forBroker: true,
    forCarrier: false,
  },
  {
    key: "rate.confirm",
    label: "Confirm rates",
    description: "Create and confirm a rate confirmation version with the carrier.",
    category: "Rates",
    forBroker: true,
    forCarrier: false,
  },

  // ── Loads (shared) ────────────────────────────────────────
  {
    key: "load.update_status",
    label: "Update load status",
    description:
      "Advance a load through the lifecycle. Which transitions you may make also depends on whether you are the broker or the carrier on that load.",
    category: "Loads",
    forBroker: true,
    forCarrier: true,
  },

  // ── Loads (carrier) ───────────────────────────────────────
  {
    key: "load.accept_decline",
    label: "Accept or decline tenders",
    description: "Respond to loads tendered to this carrier.",
    category: "Loads",
    forBroker: false,
    forCarrier: true,
  },
  {
    key: "pod.upload",
    label: "Upload proof of delivery",
    description: "Attach a signed POD document to a delivered load.",
    category: "Loads",
    forBroker: false,
    forCarrier: true,
  },

  // ── Compliance ────────────────────────────────────────────
  {
    key: "compliance.manage",
    label: "Manage compliance records",
    description:
      "Create and edit carrier compliance records: insurance, MC/DOT authority, approved equipment and commodities.",
    category: "Compliance",
    forBroker: true,
    forCarrier: true,
  },

  // ── Administration ────────────────────────────────────────
  {
    key: "staff.manage",
    label: "Manage staff & roles",
    description:
      "Invite staff, build custom roles from this catalog, and assign roles to people.",
    category: "Administration",
    forBroker: true,
    forCarrier: true,
  },
  {
    key: "audit.view",
    label: "View the audit log",
    description:
      "Read the full audit trail for this organization, including denied access attempts.",
    category: "Administration",
    forBroker: true,
    forCarrier: true,
  },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export type PermissionDef = {
  key: PermissionKey;
  label: string;
  description: string;
  category: string;
  forBroker: boolean;
  forCarrier: boolean;
};

export const PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map((p) => p.key);

export const PERMISSION_BY_KEY: Record<PermissionKey, PermissionDef> = Object.fromEntries(
  PERMISSIONS.map((p) => [p.key, p as PermissionDef]),
) as Record<PermissionKey, PermissionDef>;

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as string[]).includes(value);
}

/** The permissions an org of this type is allowed to put in a role. */
export function permissionsForOrgType(orgType: "BROKER" | "CARRIER" | "SHIPPER"): PermissionDef[] {
  if (orgType === "BROKER") return PERMISSIONS.filter((p) => p.forBroker) as unknown as PermissionDef[];
  if (orgType === "CARRIER") return PERMISSIONS.filter((p) => p.forCarrier) as unknown as PermissionDef[];
  // Shippers have no roles and no permissions. Their access is defined purely by
  // object-level scoping: they see their own loads, read-only.
  return [];
}

/** Ordered category list for rendering the role builder. */
export const PERMISSION_CATEGORIES = ["Loads", "Rates", "Compliance", "Administration"] as const;
