import type { CarrierResponse, LoadStatus, OrgType } from "@/generated/prisma/enums";
import type { PermissionKey } from "@/lib/authz/permissions";

/**
 * The load lifecycle, as data.
 *
 * Nothing in this application may change a load's status except by finding a row in
 * this table and satisfying it. That is what makes the state machine real rather
 * than a set of buttons that happen to call the right update.
 */

export const LOAD_STATUSES: LoadStatus[] = [
  "POSTED",
  "CARRIER_ASSIGNED",
  "RATE_CONFIRMED",
  "DISPATCHED",
  "IN_TRANSIT",
  "DELIVERED",
  "POD_VERIFIED",
  "INVOICED",
  "CLOSED",
  "CANCELLED",
];

/** The happy path, in order — used to render progress bars. */
export const LOAD_PIPELINE: LoadStatus[] = [
  "POSTED",
  "CARRIER_ASSIGNED",
  "RATE_CONFIRMED",
  "DISPATCHED",
  "IN_TRANSIT",
  "DELIVERED",
  "POD_VERIFIED",
  "INVOICED",
  "CLOSED",
];

export const TERMINAL_STATUSES: LoadStatus[] = ["CLOSED", "CANCELLED"];

export const STATUS_LABEL: Record<LoadStatus, string> = {
  POSTED: "Posted",
  CARRIER_ASSIGNED: "Carrier Assigned",
  RATE_CONFIRMED: "Rate Confirmed",
  DISPATCHED: "Dispatched",
  IN_TRANSIT: "In Transit",
  DELIVERED: "Delivered",
  POD_VERIFIED: "POD Verified",
  INVOICED: "Invoiced",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

/** The facts a guard is allowed to reason about. Assembled by the load service. */
export type TransitionFacts = {
  status: LoadStatus;
  carrierOrgId: string | null;
  carrierResponse: CarrierResponse;
  /** Count of OPEN + BLOCKING compliance flags. Non-zero means the load is stopped. */
  openBlockingFlags: number;
  hasConfirmedRate: boolean;
  hasPod: boolean;
};

export type TransitionGuard = {
  /** Machine-readable so the UI can explain *why* a button is disabled. */
  code: string;
  message: string;
  ok: (facts: TransitionFacts) => boolean;
};

export type Transition = {
  from: LoadStatus;
  to: LoadStatus;
  /** Human label for the button that performs it. */
  action: string;
  permission: PermissionKey;
  /** Which side of the deal may perform this transition. */
  actor: OrgType;
  guards: TransitionGuard[];
};

// ── Reusable guards ─────────────────────────────────────────

const carrierAssigned: TransitionGuard = {
  code: "NO_CARRIER",
  message: "No carrier is assigned to this load.",
  ok: (f) => f.carrierOrgId !== null,
};

const carrierAccepted: TransitionGuard = {
  code: "CARRIER_NOT_ACCEPTED",
  message: "The carrier has not accepted this tender yet.",
  ok: (f) => f.carrierResponse === "ACCEPTED",
};

/**
 * THE COMPLIANCE GATE — the requirement the whole brief turns on.
 * A load with an open blocking flag cannot move past CARRIER_ASSIGNED. Full stop.
 * The only ways forward: fix the carrier's compliance record (which resolves the
 * flag automatically), or override it on the record with load.override_compliance_flag.
 */
const complianceClear: TransitionGuard = {
  code: "COMPLIANCE_BLOCKED",
  message:
    "This load has an unresolved compliance flag. Fix the carrier's compliance record, or override the flag with a documented reason.",
  ok: (f) => f.openBlockingFlags === 0,
};

const rateConfirmed: TransitionGuard = {
  code: "NO_CONFIRMED_RATE",
  message: "No rate confirmation has been agreed for this load.",
  ok: (f) => f.hasConfirmedRate,
};

const podUploaded: TransitionGuard = {
  code: "NO_POD",
  message: "The carrier has not uploaded a proof of delivery yet.",
  ok: (f) => f.hasPod,
};

// ── The transition table ────────────────────────────────────

export const TRANSITIONS: Transition[] = [
  {
    from: "POSTED",
    to: "CARRIER_ASSIGNED",
    action: "Assign carrier",
    permission: "load.assign_carrier",
    actor: "BROKER",
    guards: [carrierAssigned],
  },

  // Carrier declines the tender: the load returns to the board and the carrier is
  // unassigned (handled by the service, which also clears that carrier's flags).
  {
    from: "CARRIER_ASSIGNED",
    to: "POSTED",
    action: "Decline tender",
    permission: "load.accept_decline",
    actor: "CARRIER",
    guards: [],
  },

  {
    from: "CARRIER_ASSIGNED",
    to: "RATE_CONFIRMED",
    action: "Confirm rate",
    permission: "rate.confirm",
    actor: "BROKER",
    guards: [carrierAssigned, carrierAccepted, complianceClear, rateConfirmed],
  },

  {
    from: "RATE_CONFIRMED",
    to: "DISPATCHED",
    action: "Dispatch",
    permission: "load.update_status",
    actor: "BROKER",
    guards: [complianceClear, rateConfirmed],
  },

  {
    from: "DISPATCHED",
    to: "IN_TRANSIT",
    action: "Mark in transit",
    permission: "load.update_status",
    actor: "CARRIER",
    guards: [],
  },

  {
    from: "IN_TRANSIT",
    to: "DELIVERED",
    action: "Mark delivered",
    permission: "load.update_status",
    actor: "CARRIER",
    guards: [],
  },

  {
    from: "DELIVERED",
    to: "POD_VERIFIED",
    action: "Verify POD",
    permission: "load.update_status",
    actor: "BROKER",
    guards: [podUploaded],
  },

  {
    from: "POD_VERIFIED",
    to: "INVOICED",
    action: "Invoice",
    permission: "load.update_status",
    actor: "BROKER",
    guards: [],
  },

  {
    from: "INVOICED",
    to: "CLOSED",
    action: "Close",
    permission: "load.update_status",
    actor: "BROKER",
    guards: [],
  },

  // Cancellation is possible right up until the truck is dispatched.
  ...(["POSTED", "CARRIER_ASSIGNED", "RATE_CONFIRMED"] as LoadStatus[]).map(
    (from): Transition => ({
      from,
      to: "CANCELLED",
      action: "Cancel load",
      permission: "load.create",
      actor: "BROKER",
      guards: [],
    }),
  ),
];

export function findTransition(from: LoadStatus, to: LoadStatus): Transition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export type GuardFailure = { code: string; message: string };

export type TransitionCheck =
  | { ok: true; transition: Transition }
  | { ok: false; reason: "NO_SUCH_TRANSITION"; message: string }
  | { ok: false; reason: "WRONG_ACTOR"; message: string; transition: Transition }
  | { ok: false; reason: "GUARD_FAILED"; message: string; transition: Transition; failures: GuardFailure[] };

/**
 * Pure. Given the facts, may this actor make this move? The API layer calls this
 * before touching the database, and the UI calls it to decide what to even show —
 * but the UI's copy is a courtesy. The server's copy is the control.
 */
export function checkTransition(
  from: LoadStatus,
  to: LoadStatus,
  actorOrgType: OrgType,
  facts: TransitionFacts,
): TransitionCheck {
  const transition = findTransition(from, to);
  if (!transition) {
    return {
      ok: false,
      reason: "NO_SUCH_TRANSITION",
      message: `A load cannot move from ${STATUS_LABEL[from]} to ${STATUS_LABEL[to]}.`,
    };
  }

  if (transition.actor !== actorOrgType) {
    return {
      ok: false,
      reason: "WRONG_ACTOR",
      message: `Only the ${transition.actor.toLowerCase()} on this load may ${transition.action.toLowerCase()}.`,
      transition,
    };
  }

  const failures = transition.guards.filter((g) => !g.ok(facts)).map((g) => ({
    code: g.code,
    message: g.message,
  }));

  if (failures.length > 0) {
    return {
      ok: false,
      reason: "GUARD_FAILED",
      message: failures[0].message,
      transition,
      failures,
    };
  }

  return { ok: true, transition };
}

/** Every move this actor could make from here, with a reason for each blocked one. */
export function availableTransitions(
  facts: TransitionFacts,
  actorOrgType: OrgType,
  heldPermissions: PermissionKey[],
): Array<{
  to: LoadStatus;
  action: string;
  permission: PermissionKey;
  allowed: boolean;
  blockedReason: string | null;
}> {
  return TRANSITIONS.filter((t) => t.from === facts.status && t.actor === actorOrgType).map((t) => {
    if (!heldPermissions.includes(t.permission)) {
      return {
        to: t.to,
        action: t.action,
        permission: t.permission,
        allowed: false,
        blockedReason: `Requires the "${t.permission}" permission.`,
      };
    }
    const failures = t.guards.filter((g) => !g.ok(facts));
    return {
      to: t.to,
      action: t.action,
      permission: t.permission,
      allowed: failures.length === 0,
      blockedReason: failures.length > 0 ? failures[0].message : null,
    };
  });
}
