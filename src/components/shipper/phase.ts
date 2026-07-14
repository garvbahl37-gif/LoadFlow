import type { LoadStatus } from "@/generated/prisma/enums";

/**
 * A shipper does not think in nine statuses. They think: has it left, is it moving,
 * did it land. This is the translation layer between the state machine and that
 * question — it never *writes* status, it only reads it.
 */

export type Phase = "IN_PROGRESS" | "DELIVERED" | "CLOSED";

const PHASE: Record<LoadStatus, Phase> = {
  POSTED: "IN_PROGRESS",
  CARRIER_ASSIGNED: "IN_PROGRESS",
  RATE_CONFIRMED: "IN_PROGRESS",
  DISPATCHED: "IN_PROGRESS",
  IN_TRANSIT: "IN_PROGRESS",
  DELIVERED: "DELIVERED",
  POD_VERIFIED: "DELIVERED",
  INVOICED: "DELIVERED",
  CLOSED: "CLOSED",
  CANCELLED: "CLOSED",
};

export function phaseOf(status: LoadStatus): Phase {
  return PHASE[status];
}

/** The one line a shipper actually wants: where is my freight, right now. */
export const SHIPPER_STATUS_LINE: Record<LoadStatus, string> = {
  POSTED: "Booked — your broker is sourcing a carrier.",
  CARRIER_ASSIGNED: "A carrier has been tendered and is being confirmed.",
  RATE_CONFIRMED: "Carrier confirmed. Awaiting dispatch.",
  DISPATCHED: "Dispatched — the truck is heading to pickup.",
  IN_TRANSIT: "On the road.",
  DELIVERED: "Delivered — awaiting proof of delivery.",
  POD_VERIFIED: "Delivered, proof of delivery verified.",
  INVOICED: "Delivered and invoiced.",
  CLOSED: "Complete.",
  CANCELLED: "Cancelled before dispatch.",
};

/** Statuses in which the truck is physically running the lane. */
export function isMoving(status: LoadStatus): boolean {
  return status === "DISPATCHED" || status === "IN_TRANSIT";
}

export function isAwaitingPickup(status: LoadStatus): boolean {
  return status === "POSTED" || status === "CARRIER_ASSIGNED" || status === "RATE_CONFIRMED";
}

export function hasLanded(status: LoadStatus): boolean {
  return (
    status === "DELIVERED" ||
    status === "POD_VERIFIED" ||
    status === "INVOICED" ||
    status === "CLOSED"
  );
}

/**
 * The POD is a document the *broker* has attested to. It is released to the shipper
 * only once the load has actually reached POD_VERIFIED — before that, an uploaded
 * file is an unverified claim, and handing it over as "proof" would be a lie.
 */
export function podReleasedToShipper(status: LoadStatus): boolean {
  return status === "POD_VERIFIED" || status === "INVOICED" || status === "CLOSED";
}

/** Late = past its deliver-by and not yet landed. */
export function isLate(status: LoadStatus, deliverBy: Date): boolean {
  if (hasLanded(status) || status === "CANCELLED") return false;
  return deliverBy.getTime() < Date.now();
}
