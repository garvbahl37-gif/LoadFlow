import { z } from "zod";
import { Conflict } from "@/lib/api/http";
import { audit, NO_META, type RequestMeta } from "@/lib/audit/log";
import type { SessionUser } from "@/lib/auth/session";
import { authorize, loadInScopeOrThrow } from "@/lib/authz/guard";
import { prisma } from "@/lib/db";
import { STATUS_LABEL } from "@/lib/loads/state-machine";

export const accessorialSchema = z.object({
  code: z.string().min(1, { error: "Required" }).max(24),
  label: z.string().min(1, { error: "Required" }).max(80),
  amountCents: z.number().int(),
});
export type Accessorial = z.infer<typeof accessorialSchema>;

export const accessorialsSchema = z.array(accessorialSchema).max(20).catch([]);

export const rateInputSchema = z.object({
  baseRateCents: z.number().int().min(1, { error: "A base rate is required." }),
  accessorials: z.array(accessorialSchema).max(20).default([]),
  notes: z.string().max(500).optional(),
});
export type RateInput = z.infer<typeof rateInputSchema>;

/** Common accessorials, offered in the UI. Freight has a standard vocabulary. */
export const ACCESSORIAL_CATALOG = [
  { code: "FSC", label: "Fuel surcharge" },
  { code: "DET", label: "Detention" },
  { code: "LUM", label: "Lumper fee" },
  { code: "STOP", label: "Extra stop" },
  { code: "TARP", label: "Tarping" },
  { code: "LAY", label: "Layover" },
  { code: "REC", label: "Reconsignment" },
] as const;

export function parseAccessorials(value: unknown): Accessorial[] {
  return accessorialsSchema.parse(value);
}

export function totalOf(baseRateCents: number, accessorials: Accessorial[]): number {
  return accessorials.reduce((sum, a) => sum + a.amountCents, baseRateCents);
}

/** Once the truck rolls, the agreement is frozen. */
const NEGOTIABLE_STATUSES = ["CARRIER_ASSIGNED", "RATE_CONFIRMED"] as const;

/**
 * Confirm a rate — always as a NEW immutable version.
 *
 * v1 is superseded by v2, but v1 is never edited and never deleted. `Load.confirmedRate`
 * points at the version that was actually agreed, so a load closed six months ago still
 * shows the exact rate it was closed on, not whatever the latest negotiation produced.
 */
export async function confirmRate(
  session: SessionUser,
  loadId: string,
  input: RateInput,
  meta: RequestMeta = NO_META,
) {
  const load = await loadInScopeOrThrow(session, loadId, undefined, meta);

  await authorize(session, "rate.confirm", meta, {
    entityType: "RateConfirmation",
    loadId,
  });

  if (!load.carrierOrgId) {
    throw Conflict("Assign a carrier before confirming a rate — a rate confirmation is an agreement between two parties.");
  }

  if (!(NEGOTIABLE_STATUSES as readonly string[]).includes(load.status)) {
    throw Conflict(
      `Load ${load.reference} is ${STATUS_LABEL[load.status]}. The rate was frozen at dispatch and can no longer be renegotiated.`,
      { status: load.status },
    );
  }

  const previous = await prisma.rateConfirmation.findFirst({
    where: { loadId },
    orderBy: { version: "desc" },
  });

  const version = (previous?.version ?? 0) + 1;
  const accessorials = input.accessorials ?? [];
  const totalRateCents = totalOf(input.baseRateCents, accessorials);

  const created = await prisma.$transaction(async (tx) => {
    // Supersede — never mutate — the outgoing version.
    await tx.rateConfirmation.updateMany({
      where: { loadId, status: "CONFIRMED" },
      data: { status: "SUPERSEDED" },
    });

    const rate = await tx.rateConfirmation.create({
      data: {
        loadId,
        version,
        baseRateCents: input.baseRateCents,
        accessorials,
        totalRateCents,
        status: "CONFIRMED",
        carrierOrgId: load.carrierOrgId!,
        notes: input.notes ?? null,
        createdById: session.userId,
      },
    });

    await tx.load.update({
      where: { id: loadId },
      data: { confirmedRateConfirmationId: rate.id },
    });

    return rate;
  });

  await audit({
    actor: session,
    action: "RATE_CONFIRMED",
    entityType: "RateConfirmation",
    entityId: created.id,
    loadId,
    summary:
      version === 1
        ? `Rate confirmation v1 issued on load ${load.reference} at $${(totalRateCents / 100).toFixed(2)}.`
        : `Rate renegotiated on load ${load.reference}: v${version} at $${(totalRateCents / 100).toFixed(2)} supersedes v${version - 1}.`,
    detail: {
      version,
      baseRateCents: input.baseRateCents,
      accessorials,
      totalRateCents,
      supersededVersion: previous?.version ?? null,
    },
    meta,
  });

  return created;
}
