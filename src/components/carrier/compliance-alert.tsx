import Link from "next/link";
import { Badge, Button } from "@/components/ui";
import { flagLabel } from "@/components/loads/flag-copy";

/**
 * "Your own paperwork is why your trucks are not moving."
 *
 * For Redline (insurance lapsed) and Cobalt (authority revoked) this is the first thing
 * on the page, above everything else, and it names the freight that is stopped. The
 * carrier can clear it themselves — fixing the compliance record re-evaluates every
 * affected load and resolves the flags with no further clicks. That is the whole loop,
 * and it is worth being loud about.
 */

export type BlockedLoadRef = { id: string; reference: string };

export function ComplianceAlert({
  blockedLoads,
  codes,
  canManage,
}: {
  blockedLoads: BlockedLoadRef[];
  /** Distinct OPEN + BLOCKING flag codes across this carrier's loads. */
  codes: string[];
  canManage: boolean;
}) {
  if (blockedLoads.length === 0) return null;

  const n = blockedLoads.length;

  return (
    <div className="rounded-card border border-danger/40 bg-danger-soft px-5 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-danger text-[12px] font-bold text-white">
          !
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-danger">
            {n} of your {n === 1 ? "load is" : "loads are"} blocked by your compliance record
          </p>
          <p className="mt-1 text-[13px] text-ink-2">
            The broker cannot confirm a rate or dispatch this freight while a blocking flag
            is open against you. Fix the underlying record and every affected load is
            re-evaluated automatically — no phone call, no re-tender.
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {codes.map((code) => (
              <Badge key={code} tone="danger">
                {flagLabel(code)}
              </Badge>
            ))}
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
              Held freight
            </span>
            {blockedLoads.slice(0, 8).map((l) => (
              <Link
                key={l.id}
                href={`/carrier/loads/${l.id}`}
                className="tnum font-mono text-[13px] font-medium text-danger hover:underline"
              >
                {l.reference}
              </Link>
            ))}
            {blockedLoads.length > 8 ? (
              <span className="tnum text-[12px] text-ink-3">
                +{blockedLoads.length - 8} more
              </span>
            ) : null}
          </div>
        </div>

        <div className="shrink-0">
          <Link href="/carrier/compliance">
            <Button variant="danger">
              {canManage ? "Fix my compliance record" : "View my compliance record"}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
