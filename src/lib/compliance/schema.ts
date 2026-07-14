import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
// Prisma 7's barrel exports model row types with a `Model` suffix.
import type { CarrierComplianceModel as CarrierCompliance, OrgModel as Org } from "@/generated/prisma/models";
import { AuthorityStatus } from "@/generated/prisma/enums";
import { NotFound } from "@/lib/api/http";
import { audit, NO_META, type RequestMeta } from "@/lib/audit/log";
import type { SessionUser } from "@/lib/auth/session";
import { loadScope } from "@/lib/authz/guard";
import { EXPIRY_WARNING_DAYS, parseStringList } from "@/lib/compliance/evaluator";
import { prisma } from "@/lib/db";
import { TERMINAL_STATUSES } from "@/lib/loads/state-machine";

/**
 * The write contract for a carrier compliance record.
 *
 * This is the single most dangerous form in the product: what it says is what the
 * compliance gate believes, and what the compliance gate believes decides whether a
 * truck rolls. So it is validated at the boundary, never trusted from the client, and
 * every write is re-evaluated against every live load the carrier is on.
 */

/** ISO date (`YYYY-MM-DD`) or full ISO datetime → Date. */
const isoDate = z
  .string()
  .min(1, { error: "Insurance expiry is required." })
  .refine((v) => !Number.isNaN(Date.parse(v)), {
    error: "Must be a valid ISO date (YYYY-MM-DD).",
  })
  .transform((v) => new Date(v));

const cents = (label: string) =>
  z
    .number({ error: `${label} is required.` })
    .int({ error: `${label} must be a whole number of cents.` })
    .min(0, { error: `${label} cannot be negative.` })
    .max(1_000_000_000_00, { error: `${label} is implausibly large.` });

const stringList = z
  .array(z.string().trim().min(1))
  .max(40, { error: "Too many entries." })
  .transform((list) => [...new Set(list)]);

export const complianceInputSchema = z.object({
  insuranceProvider: z
    .string()
    .trim()
    .min(1, { error: "Insurance provider is required." })
    .max(120),
  insurancePolicyNumber: z
    .string()
    .trim()
    .min(1, { error: "Policy number is required." })
    .max(60),
  insuranceExpiry: isoDate,
  cargoInsuranceCents: cents("Cargo insurance"),
  autoLiabilityCents: cents("Auto liability"),
  mcNumber: z.string().trim().min(1, { error: "MC number is required." }).max(30),
  dotNumber: z.string().trim().min(1, { error: "DOT number is required." }).max(30),
  authorityStatus: z.enum(AuthorityStatus, { error: "Select an authority status." }),
  approvedEquipment: stringList,
  approvedCommodities: stringList,
  notes: z.string().trim().max(1000).optional(),
});

export type ComplianceInput = z.infer<typeof complianceInputSchema>;

/** The fields whose change is worth putting in the audit diff. */
export const COMPLIANCE_DIFF_FIELDS = [
  "insuranceProvider",
  "insurancePolicyNumber",
  "insuranceExpiry",
  "cargoInsuranceCents",
  "autoLiabilityCents",
  "mcNumber",
  "dotNumber",
  "authorityStatus",
  "approvedEquipment",
  "approvedCommodities",
  "notes",
] as const;

export const COMPLIANCE_FIELD_LABEL: Record<(typeof COMPLIANCE_DIFF_FIELDS)[number], string> = {
  insuranceProvider: "Insurance provider",
  insurancePolicyNumber: "Policy number",
  insuranceExpiry: "Insurance expiry",
  cargoInsuranceCents: "Cargo insurance",
  autoLiabilityCents: "Auto liability",
  mcNumber: "MC number",
  dotNumber: "DOT number",
  authorityStatus: "Authority status",
  approvedEquipment: "Approved equipment",
  approvedCommodities: "Approved commodities",
  notes: "Notes",
};

export type ComplianceDiff = Record<string, { from: unknown; to: unknown }>;

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return [...value].map(String).sort();
  if (value === null || value === undefined) return null;
  return value;
}

/** What actually changed — the payload of the COMPLIANCE_UPDATED audit row. */
export function diffCompliance(
  before: CarrierCompliance | null,
  after: ComplianceInput,
): ComplianceDiff {
  const diff: ComplianceDiff = {};

  for (const field of COMPLIANCE_DIFF_FIELDS) {
    const next = normalize(after[field]);

    if (!before) {
      // A brand-new record: every non-empty field is a change from nothing.
      if (next !== null && !(Array.isArray(next) && next.length === 0) && next !== "") {
        diff[field] = { from: null, to: next };
      }
      continue;
    }

    const prevRaw =
      field === "approvedEquipment"
        ? parseStringList(before.approvedEquipment)
        : field === "approvedCommodities"
          ? parseStringList(before.approvedCommodities)
          : (before[field] as unknown);

    const prev = normalize(prevRaw);
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      diff[field] = { from: prev, to: next };
    }
  }

  return diff;
}

// ─────────────────────────────────────────────────────────────
// Read-side projections
// ─────────────────────────────────────────────────────────────

export const COMPLIANCE_STATES = [
  "OK",
  "EXPIRING",
  "EXPIRED",
  "AUTHORITY_ISSUE",
  "NO_RECORD",
] as const;
export type ComplianceState = (typeof COMPLIANCE_STATES)[number];

export const COMPLIANCE_STATE_LABEL: Record<ComplianceState, string> = {
  OK: "Compliant",
  EXPIRING: "Insurance expiring",
  EXPIRED: "Insurance expired",
  AUTHORITY_ISSUE: "Authority not active",
  NO_RECORD: "No compliance record",
};

/** Whole days until insurance lapses. Negative = already lapsed. */
export function daysUntilExpiry(expiry: Date, now = new Date()): number {
  return Math.floor((expiry.getTime() - now.getTime()) / 86_400_000);
}

/**
 * The one-word verdict a broker needs before tendering. Worst fact wins: a carrier
 * with revoked authority is not "expiring soon", it is unusable.
 */
export function complianceStateOf(
  compliance: Pick<CarrierCompliance, "insuranceExpiry" | "authorityStatus"> | null,
  now = new Date(),
): ComplianceState {
  if (!compliance) return "NO_RECORD";

  const days = daysUntilExpiry(compliance.insuranceExpiry, now);
  if (days < 0) return "EXPIRED";
  if (compliance.authorityStatus !== "ACTIVE") return "AUTHORITY_ISSUE";
  if (days <= EXPIRY_WARNING_DAYS) return "EXPIRING";
  return "OK";
}

/** True when this record would raise at least one BLOCKING carrier-level flag. */
export function isBlockingState(state: ComplianceState): boolean {
  return state === "EXPIRED" || state === "AUTHORITY_ISSUE" || state === "NO_RECORD";
}

export type ComplianceDTO = {
  id: string;
  orgId: string;
  insuranceProvider: string;
  insurancePolicyNumber: string;
  insuranceExpiry: string;
  cargoInsuranceCents: number;
  autoLiabilityCents: number;
  mcNumber: string;
  dotNumber: string;
  authorityStatus: string;
  approvedEquipment: string[];
  approvedCommodities: string[];
  notes: string | null;
  updatedAt: string;
  updatedById: string | null;
};

/** JSON columns parsed, dates serialized — the shape every route returns. */
export function toComplianceDTO(c: CarrierCompliance): ComplianceDTO {
  return {
    id: c.id,
    orgId: c.orgId,
    insuranceProvider: c.insuranceProvider,
    insurancePolicyNumber: c.insurancePolicyNumber,
    insuranceExpiry: c.insuranceExpiry.toISOString(),
    cargoInsuranceCents: c.cargoInsuranceCents,
    autoLiabilityCents: c.autoLiabilityCents,
    mcNumber: c.mcNumber,
    dotNumber: c.dotNumber,
    authorityStatus: c.authorityStatus,
    approvedEquipment: parseStringList(c.approvedEquipment),
    approvedCommodities: parseStringList(c.approvedCommodities),
    notes: c.notes,
    updatedAt: c.updatedAt.toISOString(),
    updatedById: c.updatedById,
  };
}

export type CarrierDTO = {
  id: string;
  name: string;
  contactEmail: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  mcNumber: string | null;
  dotNumber: string | null;
};

export function toCarrierDTO(org: Org): CarrierDTO {
  return {
    id: org.id,
    name: org.name,
    contactEmail: org.contactEmail,
    phone: org.phone,
    city: org.city,
    state: org.state,
    mcNumber: org.mcNumber,
    dotNumber: org.dotNumber,
  };
}

// ─────────────────────────────────────────────────────────────
// Scope
// ─────────────────────────────────────────────────────────────

/**
 * Who may even *see* a carrier record.
 *
 *   BROKER  → every carrier org (a broker must be able to vet carriers before tendering)
 *   CARRIER → itself, and nothing else (it must never be able to enumerate its rivals)
 *   SHIPPER → nobody
 *
 * Out of scope is a 404, never a 403: we do not confirm the existence of a record the
 * caller may not see. A carrier probing another carrier's org id gets the same answer
 * as a carrier probing an id that does not exist.
 */
export function canSeeCarrier(session: SessionUser, carrierOrgId: string): boolean {
  if (session.orgType === "BROKER") return true;
  if (session.orgType === "CARRIER") return session.orgId === carrierOrgId;
  return false;
}

/** Resolve a CARRIER org through the visibility rule above, or 404 (audited). */
export async function carrierInScopeOrThrow(
  session: SessionUser,
  orgId: string,
  meta: RequestMeta = NO_META,
): Promise<Org> {
  const org = canSeeCarrier(session, orgId)
    ? await prisma.org.findFirst({ where: { id: orgId, type: "CARRIER" } })
    : null;

  if (!org) {
    await audit({
      actor: session,
      action: "SCOPE_DENIED",
      entityType: "Org",
      entityId: orgId,
      outcome: "DENIED",
      summary: `Blocked: ${session.email} requested the compliance record of carrier ${orgId}, which is outside their organization's scope.`,
      meta,
    });
    throw NotFound("Carrier");
  }

  return org;
}

/** Live (non-terminal) loads on this carrier, ANDed with the caller's own load scope. */
export function liveLoadsForCarrier(
  session: SessionUser,
  carrierOrgId: string,
): Prisma.LoadWhereInput {
  return {
    AND: [loadScope(session), { carrierOrgId, status: { notIn: TERMINAL_STATUSES } }],
  };
}

/** …of those, the ones currently stopped by the compliance gate. */
export function blockedLoadsForCarrier(
  session: SessionUser,
  carrierOrgId: string,
): Prisma.LoadWhereInput {
  return {
    AND: [
      liveLoadsForCarrier(session, carrierOrgId),
      { complianceFlags: { some: { status: "OPEN", severity: "BLOCKING" } } },
    ],
  };
}
