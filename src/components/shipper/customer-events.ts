import type { LoadStatus } from "@/generated/prisma/enums";
import type { TimelineEvent } from "@/components/loads/timeline";

/**
 * The counterparty firewall.
 *
 * A shipper and a carrier are two sides of a deal the broker sits between. The load's
 * audit trail contains BOTH sides of that deal — what the broker agreed to pay the
 * carrier, which compliance flags the carrier tripped, who on the broker's staff was
 * denied a permission. None of that is the shipper's to see.
 *
 * So this module is built as an **allowlist, twice over**:
 *
 *   1. Only actions in CUSTOMER_VISIBLE_ACTIONS survive, and only with outcome
 *      ALLOWED. A denylist would leak every action a future agent adds.
 *   2. Free text NEVER passes through. The audit `summary` and `detail` columns are
 *      written for an ops desk — a STATUS_CHANGED summary carries the operator's
 *      internal note verbatim, a COMPLIANCE_* summary carries the flag and the
 *      override reason. So the customer-facing copy is *re-derived* here from
 *      nothing but `action` + `toStatus`. The original string is dropped on the
 *      floor. Likewise the actor: we surface the ORG that acted (broker / carrier),
 *      never the individual's name or email — a shipper has no business knowing the
 *      broker's staff roster.
 */

/** Milestones. Nothing about money, compliance, permissions, rates, or staff. */
export const CUSTOMER_VISIBLE_ACTIONS = [
  "LOAD_CREATED",
  "CARRIER_ASSIGNED",
  "TENDER_ACCEPTED",
  "STATUS_CHANGED",
  "POD_UPLOADED",
] as const;

const VISIBLE = new Set<string>(CUSTOMER_VISIBLE_ACTIONS);

/** The raw audit shape this mapper accepts. Note: `summary` and `detail` are absent
 *  by construction — callers cannot accidentally hand them to the UI. */
export type RawAuditRow = {
  id: string;
  ts: Date;
  action: string;
  outcome: string;
  actorOrgId: string | null;
  fromStatus: string | null;
  toStatus: string | null;
};

export type CustomerTimelineContext = {
  brokerOrgId: string;
  brokerName: string;
  carrierOrgId: string | null;
  carrierName: string | null;
};

const STATUS_COPY: Record<LoadStatus, string> = {
  POSTED: "Returned to the load board — a new carrier is being sourced.",
  CARRIER_ASSIGNED: "A carrier has been tendered this shipment.",
  RATE_CONFIRMED: "Terms agreed with the carrier. Awaiting dispatch.",
  DISPATCHED: "Dispatched — the truck is on its way to the pickup.",
  IN_TRANSIT: "Picked up. Your freight is on the road.",
  DELIVERED: "Delivered to the receiver.",
  POD_VERIFIED: "Proof of delivery verified. Your document is available below.",
  INVOICED: "Shipment invoiced.",
  CLOSED: "Shipment closed. Nothing further is outstanding.",
  CANCELLED: "Shipment cancelled before dispatch.",
};

function bodyFor(action: string, toStatus: string | null, ctx: CustomerTimelineContext): string {
  switch (action) {
    case "LOAD_CREATED":
      return `Booked with ${ctx.brokerName} and posted for coverage.`;
    case "CARRIER_ASSIGNED":
      return ctx.carrierName
        ? `${ctx.carrierName} was tendered this shipment.`
        : "A carrier was tendered this shipment.";
    case "TENDER_ACCEPTED":
      return ctx.carrierName
        ? `${ctx.carrierName} accepted and committed the equipment.`
        : "The carrier accepted and committed the equipment.";
    case "POD_UPLOADED":
      return "The carrier submitted a signed proof of delivery. It is released to you once your broker verifies it.";
    case "STATUS_CHANGED":
      return toStatus
        ? (STATUS_COPY[toStatus as LoadStatus] ?? "This shipment moved to its next stage.")
        : "This shipment moved to its next stage.";
    default:
      return "This shipment was updated.";
  }
}

/** Which counterparty acted. Orgs, never people. */
function actorFor(actorOrgId: string | null, ctx: CustomerTimelineContext): string {
  if (actorOrgId && ctx.carrierOrgId && actorOrgId === ctx.carrierOrgId) {
    return ctx.carrierName ?? "The carrier";
  }
  if (actorOrgId && actorOrgId === ctx.brokerOrgId) return ctx.brokerName;
  return "LoadFlow";
}

/**
 * Audit rows → the shipper's shipment history. Anything not explicitly allowed is
 * dropped, and every string on the way out is written here rather than forwarded.
 */
export function toCustomerTimeline(
  rows: RawAuditRow[],
  ctx: CustomerTimelineContext,
): TimelineEvent[] {
  return rows
    .filter((r) => r.outcome === "ALLOWED" && VISIBLE.has(r.action))
    .map((r) => ({
      id: r.id,
      ts: r.ts,
      // The action key itself is safe (it is one of the five above) and LoadTimeline
      // already knows how to label it. Only the free text is re-derived.
      action: r.action,
      summary: bodyFor(r.action, r.toStatus, ctx),
      // Everything reaching the shipper is a thing that happened, not a thing that
      // was refused — DENIED rows never make it past the filter above.
      outcome: "ALLOWED",
      actorName: actorFor(r.actorOrgId, ctx),
      actorEmail: null,
      fromStatus: r.fromStatus,
      toStatus: r.toStatus,
    }));
}
