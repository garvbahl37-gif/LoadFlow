import clsx from "clsx";
import type { LoadStatus } from "@/generated/prisma/enums";
import { Badge, EmptyState } from "@/components/ui";
import { dateTime, relative } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/loads/state-machine";

/**
 * The load's audit trail, made visible.
 *
 * Every row is attributed and timestamped, and DENIED rows — a permission that was
 * missing, a compliance gate that held, a scope probe that failed — are rendered in
 * the danger tone rather than being quietly dropped. An audit trail that only shows
 * the things that worked is not an audit trail.
 */

export type TimelineEvent = {
  id: string;
  ts: Date | string;
  action: string;
  summary: string;
  outcome: string;
  actorName: string | null;
  actorEmail: string | null;
  fromStatus: string | null;
  toStatus: string | null;
};

const ACTION_LABEL: Record<string, string> = {
  LOAD_CREATED: "Load posted",
  LOAD_UPDATED: "Load edited",
  CARRIER_ASSIGNED: "Carrier tendered",
  TENDER_ACCEPTED: "Tender accepted",
  TENDER_DECLINED: "Tender declined",
  STATUS_CHANGED: "Status changed",
  TRANSITION_BLOCKED: "Transition blocked",
  RATE_CONFIRMED: "Rate confirmed",
  COMPLIANCE_FLAGGED: "Compliance flagged",
  COMPLIANCE_RESOLVED: "Compliance cleared",
  COMPLIANCE_OVERRIDDEN: "Compliance overridden",
  COMPLIANCE_UPDATED: "Compliance record updated",
  POD_UPLOADED: "POD uploaded",
  POD_VERIFIED: "POD verified",
  PERMISSION_DENIED: "Permission denied",
  SCOPE_DENIED: "Out-of-scope request",
};

function labelFor(action: string): string {
  return ACTION_LABEL[action] ?? action.replaceAll("_", " ").toLowerCase();
}

function initials(name: string | null, email: string | null): string {
  const source = name?.trim() || email?.trim() || "?";
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? "");
}

function statusLabel(status: string): string {
  return STATUS_LABEL[status as LoadStatus] ?? status;
}

export function LoadTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <EmptyState
        title="Nothing has happened yet"
        hint="Every action taken on this load — and every action that was denied — will be recorded here, attributed and timestamped."
      />
    );
  }

  return (
    <ol className="relative px-5 py-4">
      <span
        aria-hidden
        className="absolute top-6 bottom-6 left-[31px] w-px bg-line"
      />
      {events.map((event) => {
        const denied = event.outcome === "DENIED";
        const moved = event.fromStatus && event.toStatus;
        return (
          <li key={event.id} className="relative flex gap-3 py-2.5">
            <span
              className={clsx(
                "z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold",
                denied
                  ? "border-danger/50 bg-danger text-white"
                  : "border-line-strong bg-surface-2 text-ink-2",
              )}
              title={event.actorEmail ?? undefined}
            >
              {denied ? "!" : initials(event.actorName, event.actorEmail)}
            </span>

            <div
              className={clsx(
                "min-w-0 flex-1 rounded-lg border px-3 py-2",
                denied ? "border-danger/40 bg-danger-soft" : "border-line bg-surface-2",
              )}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  className={clsx(
                    "text-[13px] font-semibold",
                    denied ? "text-danger" : "text-ink",
                  )}
                >
                  {labelFor(event.action)}
                </span>
                {denied ? <Badge tone="danger">Denied</Badge> : null}
                {moved ? (
                  <span className="text-[11px] text-ink-3">
                    {statusLabel(event.fromStatus!)} → {statusLabel(event.toStatus!)}
                  </span>
                ) : null}
                <span
                  className="tnum ml-auto text-[11px] whitespace-nowrap text-ink-3"
                  title={new Date(event.ts).toISOString()}
                >
                  {dateTime(event.ts)} · {relative(event.ts)}
                </span>
              </div>

              <p className={clsx("mt-1 text-[13px]", denied ? "text-ink" : "text-ink-2")}>
                {event.summary}
              </p>

              <p className="mt-1 text-[11px] text-ink-3">
                {event.actorName ?? event.actorEmail ?? "System"}
                {event.actorName && event.actorEmail ? ` · ${event.actorEmail}` : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
