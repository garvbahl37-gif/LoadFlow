import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Conflict, handler, Invalid, parseBody } from "@/lib/api/http";
import { audit, requestMeta } from "@/lib/audit/log";
import { authorize, loadInScopeOrThrow, requireSession } from "@/lib/authz/guard";
import { evaluateLoad } from "@/lib/compliance/evaluator";
import { prisma } from "@/lib/db";
import { COMMODITY_TYPES, EQUIPMENT_TYPES } from "@/lib/format";
import { LOAD_DETAIL_INCLUDE, factsFor, redactForShipper, transitionsFor } from "@/lib/loads/service";
import { STATUS_LABEL } from "@/lib/loads/state-machine";

/** Loads may only be edited while they are still negotiable. */
const EDITABLE_IN = ["POSTED", "CARRIER_ASSIGNED"] as const;

// ── GET /api/loads/[id] ─────────────────────────────────────

export const GET = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const meta = requestMeta(req);
  const session = await requireSession();

  // Scope, not permission: out of scope is a 404, and the probe is audited.
  const load = await loadInScopeOrThrow(session, id, LOAD_DETAIL_INCLUDE, meta);

  const [transitions, facts] = await Promise.all([
    transitionsFor(session, id),
    factsFor(id),
  ]);

  const openFlags = load.complianceFlags.filter((f) => f.status === "OPEN");

  // Shippers get a redacted load — no rate negotiation, no compliance flags, no offered
  // rate. They are not a party to the broker↔carrier agreement.
  const isShipper = session.orgType === "SHIPPER";
  const payload = isShipper ? redactForShipper(load as unknown as Record<string, unknown>) : load;

  return NextResponse.json({
    load: payload,
    facts,
    transitions,
    // docs/API.md names this `availableTransitions`; the module brief names it
    // `transitions`. Both keys are returned, identical, so neither consumer breaks.
    availableTransitions: transitions,
    // A shipper is never shown compliance internals, so these counts are suppressed too.
    blocked: isShipper ? undefined : facts.openBlockingFlags > 0,
    openBlocking: isShipper ? undefined : facts.openBlockingFlags,
    openWarning: isShipper ? undefined : openFlags.filter((f) => f.severity === "WARNING").length,
  });
});

// ── PATCH /api/loads/[id] ───────────────────────────────────

const patchSchema = z
  .object({
    originCity: z.string().min(1, { error: "Required" }).max(80),
    originState: z
      .string()
      .trim()
      .length(2, { error: "Two-letter state code." })
      .transform((s) => s.toUpperCase()),
    destCity: z.string().min(1, { error: "Required" }).max(80),
    destState: z
      .string()
      .trim()
      .length(2, { error: "Two-letter state code." })
      .transform((s) => s.toUpperCase()),
    pickupAt: z.coerce.date({ error: "A valid pickup date is required." }),
    deliverBy: z.coerce.date({ error: "A valid delivery date is required." }),
    commodity: z.enum(COMMODITY_TYPES, { error: "Choose a commodity." }),
    equipmentType: z.enum(EQUIPMENT_TYPES, { error: "Choose an equipment type." }),
    weightLbs: z.number().int().min(1, { error: "Weight must be positive." }).max(80_000, {
      error: "80,000 lb is the legal gross limit.",
    }),
    declaredValueCents: z.number().int().min(0, { error: "Declared value cannot be negative." }),
    offeredRateCents: z.number().int().min(1, { error: "An offered rate is required." }),
    notes: z.string().max(1000).nullable(),
  })
  .partial();

/** Fields whose change can newly violate the assigned carrier's approvals. */
const COMPLIANCE_RELEVANT = ["equipmentType", "commodity", "declaredValueCents"] as const;

type Patchable = z.infer<typeof patchSchema>;

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

export const PATCH = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const meta = requestMeta(req);
  const session = await requireSession();

  await authorize(session, "load.create", meta, { entityType: "Load", entityId: id, loadId: id });

  const load = await loadInScopeOrThrow(session, id, undefined, meta);
  const body = await parseBody(req, patchSchema);

  if (!(EDITABLE_IN as readonly string[]).includes(load.status)) {
    throw Conflict(
      `Load ${load.reference} is ${STATUS_LABEL[load.status]} and can no longer be edited. Loads are editable only while Posted or Carrier Assigned.`,
      { status: load.status, editableIn: EDITABLE_IN },
    );
  }

  const pickupAt = body.pickupAt ?? load.pickupAt;
  const deliverBy = body.deliverBy ?? load.deliverBy;
  if (deliverBy.getTime() < pickupAt.getTime()) {
    throw Invalid("Delivery must be on or after pickup.", {
      fieldErrors: { deliverBy: ["Delivery must be on or after pickup."] },
    });
  }

  // Diff against the record we already hold — the before/after that lands in the
  // audit trail is computed server-side, never sent by the client.
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const current = load as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(body) as [keyof Patchable, unknown][]) {
    if (value === undefined) continue;
    if (sameValue(current[key], value)) continue;
    changes[key] = { from: current[key] ?? null, to: value ?? null };
  }

  if (Object.keys(changes).length === 0) {
    const unchanged = await loadInScopeOrThrow(session, id, LOAD_DETAIL_INCLUDE, meta);
    return NextResponse.json({
      load: unchanged,
      changes: {},
      evaluation: null,
      transitions: await transitionsFor(session, id),
    });
  }

  const updated = await prisma.load.update({
    where: { id },
    data: Object.fromEntries(
      Object.entries(changes).map(([k, v]) => [k, v.to]),
    ) as Prisma_LoadUpdateShim,
  });

  await audit({
    actor: session,
    action: "LOAD_UPDATED",
    entityType: "Load",
    entityId: id,
    loadId: id,
    summary: `Load ${load.reference} updated: ${Object.keys(changes).join(", ")}.`,
    detail: { changes },
    meta,
  });

  // A re-spec can newly violate the assigned carrier's approvals — a Reefer load
  // re-specced to Flatbed, or a declared value that outruns their cargo cover.
  // Re-evaluate, so the gate reflects reality without anyone clicking anything.
  const touchesCompliance = COMPLIANCE_RELEVANT.some((f) => f in changes);
  const evaluation =
    touchesCompliance && updated.carrierOrgId ? await evaluateLoad(id, session, meta) : null;

  const detail = await loadInScopeOrThrow(session, id, LOAD_DETAIL_INCLUDE, meta);

  return NextResponse.json({
    load: detail,
    changes,
    evaluation,
    transitions: await transitionsFor(session, id),
  });
});

// Prisma's generated LoadUpdateInput is stricter than the dynamic object we build
// from the validated diff; the values are all Zod-validated scalars for known
// columns, so this narrow alias keeps the cast honest and local.
type Prisma_LoadUpdateShim = Parameters<typeof prisma.load.update>[0]["data"];
