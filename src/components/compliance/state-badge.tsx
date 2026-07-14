import clsx from "clsx";
import { Badge } from "@/components/ui";
import {
  COMPLIANCE_STATE_LABEL,
  isBlockingState,
  type ComplianceState,
} from "@/lib/compliance/schema";

/* Shared vocabulary for "how bad is this carrier's paperwork". Both sides of the deal
   read the same badge, because the broker and the carrier must never be looking at
   two different versions of the truth. */

type Tone = "neutral" | "ok" | "warn" | "danger" | "info" | "brand";

export const STATE_TONE: Record<ComplianceState, Tone> = {
  OK: "ok",
  EXPIRING: "warn",
  EXPIRED: "danger",
  AUTHORITY_ISSUE: "danger",
  NO_RECORD: "danger",
};

export function ComplianceStateBadge({ state }: { state: ComplianceState }) {
  return (
    <Badge tone={STATE_TONE[state]}>
      <span
        className={clsx("h-1.5 w-1.5 rounded-full bg-current", isBlockingState(state) && "animate-pulse")}
        aria-hidden
      />
      {COMPLIANCE_STATE_LABEL[state]}
    </Badge>
  );
}

export function AuthorityBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-ink-3">—</span>;
  return (
    <Badge tone={status === "ACTIVE" ? "ok" : status === "PENDING" ? "warn" : "danger"}>
      {status}
    </Badge>
  );
}

/** Insurance expiry as ops actually reads it: the date, then how long you have. */
export function ExpiryCell({
  expiry,
  days,
}: {
  expiry: string | null;
  days: number | null;
}) {
  if (!expiry || days === null) {
    return <span className="text-[13px] text-ink-3">Never filed</span>;
  }

  const tone =
    days < 0 ? "text-danger" : days <= 30 ? "text-warn" : "text-ink-3";

  const label =
    days < 0
      ? `Lapsed ${Math.abs(days)}d ago`
      : days === 0
        ? "Expires today"
        : `${days}d remaining`;

  return (
    <div className="leading-tight">
      <p className="tnum text-[13px] text-ink">{expiry.slice(0, 10)}</p>
      <p className={clsx("tnum text-[12px] font-medium", tone)}>{label}</p>
    </div>
  );
}

/** A compact list of approved equipment / commodities. Empty is a finding, not a blank. */
export function ChipList({
  items,
  max = 3,
  emptyLabel = "None approved",
}: {
  items: string[];
  max?: number;
  emptyLabel?: string;
}) {
  if (items.length === 0) {
    return <span className="text-[12px] text-danger">{emptyLabel}</span>;
  }
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((item) => (
        <span
          key={item}
          className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] whitespace-nowrap text-ink-2"
        >
          {item}
        </span>
      ))}
      {rest > 0 ? <span className="tnum text-[11px] text-ink-3">+{rest}</span> : null}
    </div>
  );
}
