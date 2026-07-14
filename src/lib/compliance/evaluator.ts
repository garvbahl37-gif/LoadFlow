import { z } from "zod";
import type { FlagSeverity } from "@/generated/prisma/enums";
import { audit, NO_META, type RequestMeta } from "@/lib/audit/log";
import type { SessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { TERMINAL_STATUSES } from "@/lib/loads/state-machine";

/** Insurance inside this window raises a WARNING (non-blocking) — the renewal alert. */
export const EXPIRY_WARNING_DAYS = 30;

export const FLAG_CODES = [
  "NO_COMPLIANCE_RECORD",
  "INSURANCE_EXPIRED",
  "INSURANCE_EXPIRING_SOON",
  "AUTHORITY_INACTIVE",
  "EQUIPMENT_NOT_APPROVED",
  "COMMODITY_NOT_APPROVED",
  "CARGO_INSURANCE_INSUFFICIENT",
] as const;
export type FlagCode = (typeof FLAG_CODES)[number];

export const FLAG_LABEL: Record<FlagCode, string> = {
  NO_COMPLIANCE_RECORD: "No compliance record",
  INSURANCE_EXPIRED: "Insurance expired",
  INSURANCE_EXPIRING_SOON: "Insurance expiring soon",
  AUTHORITY_INACTIVE: "Operating authority not active",
  EQUIPMENT_NOT_APPROVED: "Equipment not approved",
  COMMODITY_NOT_APPROVED: "Commodity not approved",
  CARGO_INSURANCE_INSUFFICIENT: "Cargo insurance insufficient",
};

/** SQLite has no scalar lists, so these are Json columns. Parse at the boundary. */
export const stringListSchema = z.array(z.string()).catch([]);

export function parseStringList(value: unknown): string[] {
  return stringListSchema.parse(value);
}

type Finding = { code: FlagCode; severity: FlagSeverity; message: string };

type LoadFacts = {
  id: string;
  carrierOrgId: string | null;
  equipmentType: string;
  commodity: string;
  declaredValueCents: number;
};

type ComplianceFacts = {
  insuranceExpiry: Date;
  cargoInsuranceCents: number;
  authorityStatus: string;
  approvedEquipment: unknown;
  approvedCommodities: unknown;
} | null;

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/**
 * Pure rules engine: given a load and its carrier's compliance record, what is wrong?
 *
 * A broker is liable for dispatching to a carrier with lapsed insurance or authority,
 * so these checks are the product. Everything else in the app exists to make sure
 * they cannot be quietly skipped.
 */
export function evaluate(load: LoadFacts, compliance: ComplianceFacts, now = new Date()): Finding[] {
  if (!load.carrierOrgId) return [];

  if (!compliance) {
    return [
      {
        code: "NO_COMPLIANCE_RECORD",
        severity: "BLOCKING",
        message:
          "This carrier has no compliance record on file. Insurance and operating authority must be verified before dispatch.",
      },
    ];
  }

  const findings: Finding[] = [];

  // ── Insurance ──
  const expiry = compliance.insuranceExpiry;
  const daysToExpiry = Math.floor((expiry.getTime() - now.getTime()) / 86_400_000);

  if (daysToExpiry < 0) {
    findings.push({
      code: "INSURANCE_EXPIRED",
      severity: "BLOCKING",
      message: `Insurance expired ${Math.abs(daysToExpiry)} day${Math.abs(daysToExpiry) === 1 ? "" : "s"} ago (${expiry.toISOString().slice(0, 10)}).`,
    });
  } else if (daysToExpiry <= EXPIRY_WARNING_DAYS) {
    findings.push({
      code: "INSURANCE_EXPIRING_SOON",
      severity: "WARNING",
      message: `Insurance expires in ${daysToExpiry} day${daysToExpiry === 1 ? "" : "s"} (${expiry.toISOString().slice(0, 10)}). Renew before dispatch.`,
    });
  }

  // ── Authority ──
  if (compliance.authorityStatus !== "ACTIVE") {
    findings.push({
      code: "AUTHORITY_INACTIVE",
      severity: "BLOCKING",
      message: `MC/DOT operating authority is ${compliance.authorityStatus}, not ACTIVE.`,
    });
  }

  // ── Equipment ──
  const equipment = parseStringList(compliance.approvedEquipment);
  if (!equipment.includes(load.equipmentType)) {
    findings.push({
      code: "EQUIPMENT_NOT_APPROVED",
      severity: "BLOCKING",
      message: `This load needs ${load.equipmentType}, which is not in the carrier's approved equipment (${equipment.join(", ") || "none"}).`,
    });
  }

  // ── Commodity ──
  const commodities = parseStringList(compliance.approvedCommodities);
  if (!commodities.includes(load.commodity)) {
    findings.push({
      code: "COMMODITY_NOT_APPROVED",
      severity: "BLOCKING",
      message: `The carrier is not approved to haul ${load.commodity} (approved: ${commodities.join(", ") || "none"}).`,
    });
  }

  // ── Cargo coverage ──
  if (compliance.cargoInsuranceCents < load.declaredValueCents) {
    findings.push({
      code: "CARGO_INSURANCE_INSUFFICIENT",
      severity: "BLOCKING",
      message: `Cargo insurance of ${money(compliance.cargoInsuranceCents)} does not cover the declared value of ${money(load.declaredValueCents)}.`,
    });
  }

  return findings;
}

export type EvaluationResult = {
  raised: Finding[];
  resolved: FlagCode[];
  openBlocking: number;
};

/**
 * Re-evaluate one load and reconcile its flags against reality.
 *
 * Idempotent: an already-OPEN flag for the same code is left alone (its raisedAt and
 * its place in the audit trail are preserved). A flag whose underlying fact has been
 * fixed is RESOLVED. An OVERRIDDEN flag is never re-raised — a human took that
 * decision on the record, and re-raising it would silently undo them.
 */
export async function evaluateLoad(
  loadId: string,
  actor: SessionUser | null,
  meta: RequestMeta = NO_META,
): Promise<EvaluationResult> {
  const load = await prisma.load.findUnique({
    where: { id: loadId },
    include: { complianceFlags: true },
  });
  if (!load) return { raised: [], resolved: [], openBlocking: 0 };

  // Terminal loads are history. Do not rewrite it.
  if (TERMINAL_STATUSES.includes(load.status)) {
    return { raised: [], resolved: [], openBlocking: 0 };
  }

  const compliance = load.carrierOrgId
    ? await prisma.carrierCompliance.findUnique({ where: { orgId: load.carrierOrgId } })
    : null;

  const findings = evaluate(load, compliance);
  const findingByCode = new Map(findings.map((f) => [f.code, f]));

  const existingOpen = load.complianceFlags.filter((f) => f.status === "OPEN");
  const overriddenCodes = new Set(
    load.complianceFlags.filter((f) => f.status === "OVERRIDDEN").map((f) => f.code),
  );

  const raised: Finding[] = [];
  const resolved: FlagCode[] = [];

  // Raise anything newly wrong that isn't already open and wasn't consciously overridden.
  for (const finding of findings) {
    if (overriddenCodes.has(finding.code)) continue;
    if (existingOpen.some((f) => f.code === finding.code)) continue;

    await prisma.complianceFlag.create({
      data: {
        loadId: load.id,
        carrierOrgId: load.carrierOrgId!,
        code: finding.code,
        severity: finding.severity,
        message: finding.message,
        status: "OPEN",
      },
    });
    raised.push(finding);
  }

  // Resolve anything that is no longer true.
  for (const flag of existingOpen) {
    if (!findingByCode.has(flag.code as FlagCode)) {
      await prisma.complianceFlag.update({
        where: { id: flag.id },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });
      resolved.push(flag.code as FlagCode);
    }
  }

  if (raised.length > 0) {
    await audit({
      actor,
      action: "COMPLIANCE_FLAGGED",
      entityType: "Load",
      entityId: load.id,
      loadId: load.id,
      summary:
        raised.some((r) => r.severity === "BLOCKING")
          ? `Load ${load.reference} auto-flagged and blocked: ${raised.filter((r) => r.severity === "BLOCKING").map((r) => FLAG_LABEL[r.code]).join(", ")}.`
          : `Load ${load.reference} raised a compliance warning: ${raised.map((r) => FLAG_LABEL[r.code]).join(", ")}.`,
      detail: { raised },
      meta,
    });
  }

  if (resolved.length > 0) {
    await audit({
      actor,
      action: "COMPLIANCE_RESOLVED",
      entityType: "Load",
      entityId: load.id,
      loadId: load.id,
      summary: `Compliance flags cleared on load ${load.reference}: ${resolved.map((c) => FLAG_LABEL[c]).join(", ")}.`,
      detail: { resolved },
      meta,
    });
  }

  const openBlocking = await prisma.complianceFlag.count({
    where: { loadId: load.id, status: "OPEN", severity: "BLOCKING" },
  });

  return { raised, resolved, openBlocking };
}

/**
 * A carrier's compliance record changed. Every live load tendered to that carrier
 * must be re-checked — expiring insurance should stop tomorrow's dispatches, and
 * fixing it should unblock them without anyone clicking anything.
 */
export async function reevaluateCarrier(
  carrierOrgId: string,
  actor: SessionUser | null,
  meta: RequestMeta = NO_META,
): Promise<{ loadId: string; result: EvaluationResult }[]> {
  const loads = await prisma.load.findMany({
    where: { carrierOrgId, status: { notIn: TERMINAL_STATUSES } },
    select: { id: true },
  });

  const results = [];
  for (const load of loads) {
    results.push({ loadId: load.id, result: await evaluateLoad(load.id, actor, meta) });
  }
  return results;
}
