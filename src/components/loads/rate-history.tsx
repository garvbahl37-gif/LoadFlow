import clsx from "clsx";
import { Badge, EmptyState } from "@/components/ui";
import { dateTime, money } from "@/lib/format";
import { parseAccessorials } from "@/lib/rates/service";

/**
 * Every rate version this load has ever had, newest first.
 *
 * Superseded versions are dimmed, never hidden — the whole point of versioning a rate
 * confirmation is that you can see what was agreed before, and by whom. The version the
 * load actually points at (`Load.confirmedRateConfirmationId`) is marked unmistakably:
 * that one is the agreement, and it is what a closed load keeps forever.
 *
 * Server component: `parseAccessorials` lives in the rates service.
 */

export type HistoryRate = {
  id: string;
  version: number;
  baseRateCents: number;
  accessorials: unknown;
  totalRateCents: number;
  status: string;
  notes: string | null;
  createdAt: Date | string;
  createdBy?: { name: string } | null;
};

export function RateHistory({
  rates,
  confirmedRateId,
}: {
  rates: HistoryRate[];
  confirmedRateId: string | null;
}) {
  if (rates.length === 0) {
    return (
      <EmptyState
        title="No rate confirmation yet"
        hint="A rate confirmation is an agreement between the broker and the assigned carrier. Confirming one creates version 1; renegotiating creates version 2, and version 1 is kept."
      />
    );
  }

  const sorted = [...rates].sort((a, b) => b.version - a.version);

  return (
    <ul className="divide-y divide-line">
      {sorted.map((rate) => {
        const isConfirmed = rate.id === confirmedRateId;
        const accessorials = parseAccessorials(rate.accessorials);

        return (
          <li
            key={rate.id}
            className={clsx(
              "px-5 py-3.5",
              isConfirmed ? "bg-ok-soft/30" : "opacity-70",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={clsx(
                  "tnum rounded-md border px-1.5 py-0.5 text-[11px] font-semibold",
                  isConfirmed
                    ? "border-ok/40 bg-ok-soft text-ok"
                    : "border-line-strong bg-surface-2 text-ink-3",
                )}
              >
                v{rate.version}
              </span>

              {isConfirmed ? (
                <Badge tone="ok">✓ Confirmed rate for this load</Badge>
              ) : (
                <Badge tone="neutral">Superseded</Badge>
              )}

              <span
                className={clsx(
                  "tnum ml-auto text-sm font-semibold",
                  isConfirmed ? "text-ink" : "text-ink-2",
                )}
              >
                {money(rate.totalRateCents)}
              </span>
            </div>

            <dl className="mt-2 space-y-1 text-[13px]">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-2">Line haul</dt>
                <dd className="tnum text-ink">{money(rate.baseRateCents)}</dd>
              </div>
              {accessorials.map((a, i) => (
                <div key={`${rate.id}-${a.code}-${i}`} className="flex justify-between gap-4">
                  <dt className="text-ink-2">
                    <span className="mr-1.5 rounded-xs border border-line bg-surface-2 px-1 font-mono text-[10px] text-ink-3">
                      {a.code}
                    </span>
                    {a.label}
                  </dt>
                  <dd className="tnum text-ink">{money(a.amountCents)}</dd>
                </div>
              ))}
              {accessorials.length === 0 ? (
                <div className="text-[12px] text-ink-3">No accessorials.</div>
              ) : null}
              <div className="flex justify-between gap-4 border-t border-line pt-1">
                <dt className="font-medium text-ink">Total</dt>
                <dd className="tnum font-semibold text-ink">{money(rate.totalRateCents)}</dd>
              </div>
            </dl>

            {rate.notes ? (
              <p className="mt-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] text-ink-2">
                {rate.notes}
              </p>
            ) : null}

            <p className="tnum mt-2 text-[11px] text-ink-3">
              {rate.createdBy?.name ? `${rate.createdBy.name} · ` : ""}
              {dateTime(rate.createdAt)}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
