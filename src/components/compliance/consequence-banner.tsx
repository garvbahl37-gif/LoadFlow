import clsx from "clsx";
import type { ReactNode } from "react";
import { FLAG_LABEL, type FlagCode } from "@/lib/compliance/evaluator";
import type { ComplianceState } from "@/lib/compliance/schema";
import type { CarrierLoadRow } from "@/components/compliance/data";

/**
 * The honest statement of what the current record is costing, in plain English.
 *
 * "Your insurance lapsed 12 days ago. 1 load is blocked and cannot be dispatched."
 * A carrier staring at a red badge learns nothing. A carrier reading that sentence
 * picks up the phone to its insurance agent. That is the whole product.
 */
export function ConsequenceBanner({
  state,
  days,
  blockedLoads,
  liveLoads,
  loads,
  audience,
  carrierName,
}: {
  state: ComplianceState;
  days: number | null;
  blockedLoads: number;
  liveLoads: number;
  loads: CarrierLoadRow[];
  audience: "CARRIER" | "BROKER";
  carrierName?: string;
}) {
  const self = audience === "CARRIER";
  const who = self ? "Your" : `${carrierName ?? "This carrier"}'s`;
  const whoLower = self ? "your" : "this carrier's";

  const cause = causeSentence(state, days, who);

  // Every distinct blocking reason currently holding freight, deduped across loads.
  const codes = new Set<string>();
  for (const load of loads) {
    for (const flag of load.openFlags) {
      if (flag.severity === "BLOCKING") codes.add(flag.code);
    }
  }

  if (state === "OK" && blockedLoads === 0) {
    return (
      <Banner tone="ok" icon="check">
        <p className="text-[13px] font-semibold text-ok">
          {who} compliance record is current. Nothing is blocked.
        </p>
        <p className="mt-0.5 text-[13px] text-ink-2">
          {liveLoads === 0
            ? "There are no live loads on this carrier right now."
            : `All ${liveLoads} live ${liveLoads === 1 ? "load" : "loads"} can move through the state machine without an override.`}
          {days !== null ? ` Insurance has ${days} days of coverage remaining.` : ""}
        </p>
      </Banner>
    );
  }

  if (blockedLoads > 0) {
    return (
      <Banner tone="danger" icon="alert">
        <p className="text-[13px] font-semibold text-danger">
          {cause}{" "}
          <span className="tnum">{blockedLoads}</span>{" "}
          {blockedLoads === 1 ? "load is" : "loads are"} blocked and cannot be dispatched.
        </p>
        <p className="mt-0.5 text-[13px] text-ink-2">
          {self
            ? "Those loads will not move until this record is fixed — or the broker overrides the flag on the record, which they are unlikely to do twice."
            : `These loads are held at Carrier Assigned. Fix ${whoLower} record below and they clear automatically, or override each flag with a written reason.`}
        </p>
        {codes.size > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {[...codes].map((code) => (
              <li
                key={code}
                className="rounded-md border border-danger/40 bg-surface px-1.5 py-0.5 text-[11px] font-medium text-danger"
              >
                {FLAG_LABEL[code as FlagCode] ?? code}
              </li>
            ))}
          </ul>
        ) : null}
      </Banner>
    );
  }

  // A bad record, but no freight riding on it yet — still worth saying out loud.
  const tone = state === "EXPIRING" ? "warn" : "danger";
  return (
    <Banner tone={tone} icon="alert">
      <p className={clsx("text-[13px] font-semibold", tone === "warn" ? "text-warn" : "text-danger")}>
        {cause} No loads are blocked right now.
      </p>
      <p className="mt-0.5 text-[13px] text-ink-2">
        {state === "EXPIRING"
          ? `The next load tendered to ${self ? "you" : "this carrier"} will still move, but the moment the policy lapses every live load stops. Renew it now.`
          : `Any load tendered to ${self ? "you" : "this carrier"} will be flagged and held at Carrier Assigned the instant it is assigned.`}
      </p>
    </Banner>
  );
}

function causeSentence(state: ComplianceState, days: number | null, who: string): string {
  switch (state) {
    case "NO_RECORD":
      return `${who} compliance record has never been filed — insurance and operating authority are unverified.`;
    case "EXPIRED":
      return `${who} insurance lapsed ${Math.abs(days ?? 0)} day${Math.abs(days ?? 0) === 1 ? "" : "s"} ago.`;
    case "AUTHORITY_ISSUE":
      return `${who} MC/DOT operating authority is not ACTIVE.`;
    case "EXPIRING":
      return `${who} insurance expires in ${days} day${days === 1 ? "" : "s"}.`;
    case "OK":
      return `${who} compliance record is current, but the gate is still holding freight.`;
  }
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: "ok" | "warn" | "danger";
  icon: "check" | "alert";
  children: ReactNode;
}) {
  const border = {
    ok: "border-ok/40 bg-ok-soft",
    warn: "border-warn/40 bg-warn-soft",
    danger: "border-danger/40 bg-danger-soft",
  }[tone];

  const dot = { ok: "bg-ok", warn: "bg-warn", danger: "bg-danger" }[tone];

  return (
    <div className={clsx("flex items-start gap-3 rounded-card border px-4 py-3", border)}>
      <span
        className={clsx(
          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white",
          dot,
        )}
        aria-hidden
      >
        {icon === "check" ? (
          <svg viewBox="0 0 12 12" className="h-3 w-3 fill-none stroke-current">
            <path d="M3 6.3 5 8.3 9 3.8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          "!"
        )}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
