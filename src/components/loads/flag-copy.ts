/**
 * Client-safe copy for compliance flag codes.
 *
 * `FLAG_LABEL` in src/lib/compliance/evaluator.ts is the source of truth, but that
 * module reaches the database (and therefore `next/headers`), so it cannot be pulled
 * into a Client Component bundle. These labels mirror it exactly, and anything
 * unrecognised falls back to a humanised form of the code itself — a new flag code
 * can never render as a blank.
 */
export const FLAG_COPY: Record<string, string> = {
  NO_COMPLIANCE_RECORD: "No compliance record",
  INSURANCE_EXPIRED: "Insurance expired",
  INSURANCE_EXPIRING_SOON: "Insurance expiring soon",
  AUTHORITY_INACTIVE: "Operating authority not active",
  EQUIPMENT_NOT_APPROVED: "Equipment not approved",
  COMMODITY_NOT_APPROVED: "Commodity not approved",
  CARGO_INSURANCE_INSUFFICIENT: "Cargo insurance insufficient",
};

export function flagLabel(code: string): string {
  return (
    FLAG_COPY[code] ??
    code.charAt(0) + code.slice(1).toLowerCase().replaceAll("_", " ")
  );
}
