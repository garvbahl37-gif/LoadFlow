import type { LoadStatus } from "@/generated/prisma/enums";
import { Conflict, Invalid, NotFound } from "@/lib/api/http";
import { audit, NO_META, type RequestMeta } from "@/lib/audit/log";
import type { SessionUser } from "@/lib/auth/session";
import { authorize, loadInScopeOrThrow } from "@/lib/authz/guard";
import { evaluateLoad } from "@/lib/compliance/evaluator";
import { prisma } from "@/lib/db";
import {
  availableTransitions,
  checkTransition,
  findTransition,
  STATUS_LABEL,
  type TransitionFacts,
} from "@/lib/loads/state-machine";

// Never `include: { createdBy: true }` on a User relation: that pulls EVERY column,
// including passwordHash, status and lastLoginAt, into a response an in-scope shipper or
// carrier can read. Only ever select the three fields a counterparty is allowed to see.
const PUBLIC_USER = { select: { id: true, name: true, email: true } } as const;

const LOAD_DETAIL_INCLUDE = {
  shipperOrg: true,
  brokerOrg: true,
  carrierOrg: true,
  complianceFlags: { orderBy: { raisedAt: "desc" } },
  rateConfirmations: { orderBy: { version: "desc" }, include: { createdBy: PUBLIC_USER } },
  confirmedRate: true,
  pods: { orderBy: { uploadedAt: "desc" }, select: PodMeta() },
  createdBy: PUBLIC_USER,
} as const;

function PodMeta() {
  // Never select `data` in list queries — POD bytes are fetched only by the file route.
  return {
    id: true,
    fileName: true,
    mimeType: true,
    sizeBytes: true,
    notes: true,
    uploadedAt: true,
    uploadedById: true,
    verifiedAt: true,
    verifiedById: true,
  } as const;
}

export { LOAD_DETAIL_INCLUDE };

/**
 * A shipper is not a party to the broker↔carrier agreement. The brief limits them to
 * "their own load status and delivery confirmation", so the API must not hand them the
 * rate negotiation (versions, base rates, accessorials, internal notes), the broker's
 * offered rate, or the compliance flags on their carrier — even though the load is in
 * their scope. The shipper's own page already hides all of this; this makes the raw JSON
 * endpoint enforce the same boundary, rather than leaving it to UI hiding.
 *
 * Everything a shipper legitimately needs — status, lane, dates, commodity, who is
 * hauling it, their own declared value, and POD metadata — is preserved.
 */
export function redactForShipper<T extends Record<string, unknown>>(load: T): T {
  const {
    rateConfirmations: _rates,
    confirmedRate: _confirmed,
    complianceFlags: _flags,
    offeredRateCents: _offered,
    confirmedRateConfirmationId: _confirmedId,
    ...safe
  } = load;
  return safe as unknown as T;
}

/** Assemble the facts the state machine is allowed to reason about. */
export async function factsFor(loadId: string): Promise<TransitionFacts> {
  const load = await prisma.load.findUnique({
    where: { id: loadId },
    select: { status: true, carrierOrgId: true, carrierResponse: true, confirmedRateConfirmationId: true },
  });
  if (!load) throw NotFound("Load");

  const [openBlockingFlags, podCount] = await Promise.all([
    prisma.complianceFlag.count({
      where: { loadId, status: "OPEN", severity: "BLOCKING" },
    }),
    prisma.proofOfDelivery.count({ where: { loadId } }),
  ]);

  return {
    status: load.status,
    carrierOrgId: load.carrierOrgId,
    carrierResponse: load.carrierResponse,
    openBlockingFlags,
    hasConfirmedRate: load.confirmedRateConfirmationId !== null,
    hasPod: podCount > 0,
  };
}

export async function transitionsFor(session: SessionUser, loadId: string) {
  const facts = await factsFor(loadId);
  return availableTransitions(facts, session.orgType, session.permissions);
}

/**
 * The ONE way a load's status changes. Every path — UI button, raw curl, seed
 * script — funnels through here, so the state machine and the compliance gate
 * cannot be sidestepped.
 */
export async function transitionLoad(
  session: SessionUser,
  loadId: string,
  to: LoadStatus,
  meta: RequestMeta = NO_META,
  note?: string,
) {
  const load = await loadInScopeOrThrow(session, loadId, undefined, meta);

  const transition = findTransition(load.status, to);
  if (!transition) {
    throw Conflict(
      `A load cannot move from ${STATUS_LABEL[load.status]} to ${STATUS_LABEL[to]}.`,
      { from: load.status, to },
    );
  }

  // The required permission comes from the transition table — not from the caller.
  await authorize(session, transition.permission, meta, {
    entityType: "Load",
    entityId: loadId,
    loadId,
  });

  const facts = await factsFor(loadId);
  const check = checkTransition(load.status, to, session.orgType, facts);

  if (!check.ok) {
    await audit({
      actor: session,
      action: "TRANSITION_BLOCKED",
      entityType: "Load",
      entityId: loadId,
      loadId,
      outcome: "DENIED",
      fromStatus: load.status,
      toStatus: to,
      summary: `Blocked: ${session.email} tried to move load ${load.reference} to ${STATUS_LABEL[to]} — ${check.message}`,
      detail: check,
      meta,
    });
    throw Conflict(check.message, check);
  }

  const updated = await prisma.load.update({
    where: { id: loadId },
    data: { status: to },
  });

  // Verifying a POD is its own attributed event — WHO attested to THIS document, and
  // WHEN. The load-status change records that the load reached POD_VERIFIED; this records
  // it on the document itself, which is what the shipper's delivery confirmation and the
  // POD viewers read to show a verified badge. The guard already proved a POD exists.
  if (to === "POD_VERIFIED") {
    await prisma.proofOfDelivery.updateMany({
      where: { loadId, verifiedAt: null },
      data: { verifiedById: session.userId, verifiedAt: new Date() },
    });
  }

  await audit({
    actor: session,
    action: "STATUS_CHANGED",
    entityType: "Load",
    entityId: loadId,
    loadId,
    fromStatus: load.status,
    toStatus: to,
    summary: `Load ${load.reference}: ${STATUS_LABEL[load.status]} → ${STATUS_LABEL[to]}${note ? ` — ${note}` : ""}`,
    detail: note ? { note } : undefined,
    meta,
  });

  return updated;
}

/**
 * Assign a carrier and immediately evaluate compliance. The flag is raised at the
 * moment of assignment — the broker learns the carrier is uninsured *before* the
 * load can go anywhere, which is the entire point.
 */
export async function assignCarrier(
  session: SessionUser,
  loadId: string,
  carrierOrgId: string,
  meta: RequestMeta = NO_META,
) {
  const load = await loadInScopeOrThrow(session, loadId, undefined, meta);

  await authorize(session, "load.assign_carrier", meta, {
    entityType: "Load",
    entityId: loadId,
    loadId,
  });

  if (load.status !== "POSTED") {
    throw Conflict(
      `Only a posted load can be tendered. Load ${load.reference} is ${STATUS_LABEL[load.status]}.`,
    );
  }

  const carrier = await prisma.org.findFirst({ where: { id: carrierOrgId, type: "CARRIER" } });
  if (!carrier) throw NotFound("Carrier");

  await prisma.load.update({
    where: { id: loadId },
    data: {
      carrierOrgId,
      carrierResponse: "PENDING",
      status: "CARRIER_ASSIGNED",
    },
  });

  await audit({
    actor: session,
    action: "CARRIER_ASSIGNED",
    entityType: "Load",
    entityId: loadId,
    loadId,
    fromStatus: "POSTED",
    toStatus: "CARRIER_ASSIGNED",
    summary: `Load ${load.reference} tendered to ${carrier.name}.`,
    detail: { carrierOrgId, carrierName: carrier.name },
    meta,
  });

  // Auto-flagging happens here, not on a cron. Assignment IS the trigger.
  const evaluation = await evaluateLoad(loadId, session, meta);

  return { loadId, evaluation };
}

/** Carrier accepts or declines the tender. */
export async function respondToTender(
  session: SessionUser,
  loadId: string,
  accept: boolean,
  meta: RequestMeta = NO_META,
) {
  const load = await loadInScopeOrThrow(session, loadId, undefined, meta);

  await authorize(session, "load.accept_decline", meta, {
    entityType: "Load",
    entityId: loadId,
    loadId,
  });

  if (load.status !== "CARRIER_ASSIGNED") {
    throw Conflict(
      `Load ${load.reference} is ${STATUS_LABEL[load.status]} — there is no open tender to respond to.`,
    );
  }

  if (accept) {
    await prisma.load.update({
      where: { id: loadId },
      data: { carrierResponse: "ACCEPTED" },
    });
    await audit({
      actor: session,
      action: "TENDER_ACCEPTED",
      entityType: "Load",
      entityId: loadId,
      loadId,
      summary: `${session.orgName} accepted the tender on load ${load.reference}.`,
      meta,
    });
    return { accepted: true };
  }

  // Declining returns the load to the board and detaches the carrier entirely —
  // including EVERY compliance flag about that carrier, whatever its status. These flags
  // (and any override on them) were decisions about *that* carrier; leaving an OVERRIDDEN
  // one behind would let it wrongly suppress the same rule when the load is re-tendered to
  // a different carrier. Not just the OPEN ones — all of them.
  await prisma.$transaction([
    prisma.complianceFlag.deleteMany({
      where: { loadId, carrierOrgId: session.orgId },
    }),
    prisma.load.update({
      where: { id: loadId },
      data: { carrierOrgId: null, carrierResponse: "PENDING", status: "POSTED" },
    }),
  ]);

  await audit({
    actor: session,
    action: "TENDER_DECLINED",
    entityType: "Load",
    entityId: loadId,
    loadId,
    fromStatus: "CARRIER_ASSIGNED",
    toStatus: "POSTED",
    summary: `${session.orgName} declined the tender on load ${load.reference}; it has returned to the board.`,
    meta,
  });

  return { accepted: false };
}

/** Override a blocking flag — permanently, on the record, with a reason. */
export async function overrideFlag(
  session: SessionUser,
  loadId: string,
  flagId: string,
  reason: string,
  meta: RequestMeta = NO_META,
) {
  const load = await loadInScopeOrThrow(session, loadId, undefined, meta);

  await authorize(session, "load.override_compliance_flag", meta, {
    entityType: "ComplianceFlag",
    entityId: flagId,
    loadId,
  });

  if (reason.trim().length < 10) {
    throw Invalid("An override reason of at least 10 characters is required.", {
      fieldErrors: { reason: ["Explain why this risk is acceptable (10+ characters)."] },
    });
  }

  const flag = await prisma.complianceFlag.findFirst({ where: { id: flagId, loadId } });
  if (!flag) throw NotFound("Compliance flag");
  if (flag.status !== "OPEN") throw Conflict("That flag is not open.");

  await prisma.complianceFlag.update({
    where: { id: flagId },
    data: {
      status: "OVERRIDDEN",
      overriddenById: session.userId,
      overrideReason: reason.trim(),
      overriddenAt: new Date(),
    },
  });

  await audit({
    actor: session,
    action: "COMPLIANCE_OVERRIDDEN",
    entityType: "ComplianceFlag",
    entityId: flagId,
    loadId,
    summary: `${session.name} overrode "${flag.code}" on load ${load.reference}. Reason: ${reason.trim()}`,
    detail: { flagCode: flag.code, flagMessage: flag.message, reason: reason.trim() },
    meta,
  });

  return { overridden: true };
}
