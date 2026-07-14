"use client";

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Card } from "@/components/ui";

/* The renewal-alerts strip, fed by GET /api/compliance/alerts.
   A broker should never learn that a carrier's insurance lapsed by watching a load
   fail to dispatch. They should learn it here, before they tender. */

type Alert = {
  carrierOrgId: string;
  carrierName: string;
  complianceState: "OK" | "EXPIRING" | "EXPIRED" | "AUTHORITY_ISSUE" | "NO_RECORD";
  label: string;
  severity: "CRITICAL" | "WARNING";
  reason: string;
  daysUntilExpiry: number | null;
  affectedLoads: number;
  blockedLoads: number;
};

type AlertsPayload = {
  alerts: Alert[];
  windowDays: number;
  counts: {
    total: number;
    critical: number;
    warning: number;
    affectedLoads: number;
    blockedLoads: number;
  };
};

export function AlertsStrip({ hrefBase = "/broker/carriers" }: { hrefBase?: string }) {
  const [data, setData] = useState<AlertsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/compliance/alerts")
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(
            (json as { error?: string } | null)?.error ?? `Could not load alerts (HTTP ${res.status}).`,
          );
        }
        return json as AlertsPayload;
      })
      .then((json) => live && setData(json))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, []);

  if (error) {
    return (
      <Card className="border-danger/40 bg-danger-soft px-4 py-3">
        <p className="text-[13px] text-danger">Expiry alerts unavailable — {error}</p>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-4 w-40 animate-pulse rounded-md bg-surface-2" />
          <div className="h-4 w-24 animate-pulse rounded-md bg-surface-2" />
        </div>
        <div className="mt-3 flex gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 w-64 animate-pulse rounded-lg bg-surface-2" />
          ))}
        </div>
      </Card>
    );
  }

  if (data.alerts.length === 0) {
    return (
      <Card className="flex flex-wrap items-center gap-3 border-ok/40 bg-ok-soft px-4 py-3">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ok text-white" aria-hidden>
          <svg viewBox="0 0 12 12" className="h-3 w-3 fill-none stroke-current">
            <path d="M3 6.3 5 8.3 9 3.8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <p className="text-[13px] font-medium text-ok">
          No expiry or authority alerts. Every carrier&apos;s insurance is current beyond{" "}
          <span className="tnum">{data.windowDays}</span> days and all authorities are active.
        </p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-warn text-[11px] font-bold text-white" aria-hidden>
            !
          </span>
          <h2 className="text-sm font-semibold text-ink">Expiry &amp; authority alerts</h2>
          <span className="text-[12px] text-ink-3">
            insurance lapsed or lapsing within <span className="tnum">{data.windowDays}</span> days
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {data.counts.critical > 0 ? (
            <Badge tone="danger">
              <span className="tnum">{data.counts.critical}</span> critical
            </Badge>
          ) : null}
          {data.counts.warning > 0 ? (
            <Badge tone="warn">
              <span className="tnum">{data.counts.warning}</span> warning
            </Badge>
          ) : null}
          {data.counts.blockedLoads > 0 ? (
            <Badge tone="danger">
              <span className="tnum">{data.counts.blockedLoads}</span> loads held
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto px-4 py-3">
        {data.alerts.map((a) => (
          <Link
            key={a.carrierOrgId}
            href={`${hrefBase}/${a.carrierOrgId}`}
            className={clsx(
              "group w-72 shrink-0 rounded-lg border px-3 py-2.5 transition-colors",
              a.severity === "CRITICAL"
                ? "border-danger/40 bg-danger-soft hover:border-danger"
                : "border-warn/40 bg-warn-soft hover:border-warn",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-[13px] font-semibold text-ink">{a.carrierName}</p>
              <span
                className={clsx(
                  "shrink-0 text-[11px] font-semibold",
                  a.severity === "CRITICAL" ? "text-danger" : "text-warn",
                )}
              >
                {a.label}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-[12px] text-ink-2">{a.reason}</p>
            <p className="mt-1.5 text-[11px] text-ink-3">
              <span className="tnum">{a.affectedLoads}</span> live{" "}
              {a.affectedLoads === 1 ? "load" : "loads"} ·{" "}
              <span
                className={clsx(
                  "tnum font-semibold",
                  a.blockedLoads > 0 ? "text-danger" : "text-ink-3",
                )}
              >
                {a.blockedLoads}
              </span>{" "}
              held by the gate
            </p>
          </Link>
        ))}
      </div>
    </Card>
  );
}
