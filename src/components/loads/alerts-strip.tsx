"use client";

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui";

/**
 * The five-alarm strip.
 *
 * Expired insurance on a carrier that is currently hauling your freight is not a
 * row in a table — it is a phone call you have to make now. This is deliberately the
 * loudest thing on the board, and it names the freight that is exposed.
 *
 * Data comes from GET /api/compliance/alerts, the same endpoint anyone could curl:
 * broker sees every carrier, a carrier would see only itself, a shipper gets a 403.
 */

type Alert = {
  carrierOrgId: string;
  carrierName: string;
  complianceState: string;
  label: string;
  severity: "CRITICAL" | "WARNING";
  reason: string;
  daysUntilExpiry: number | null;
  affectedLoads: number;
  blockedLoads: number;
};

type BlockedLoad = {
  id: string;
  reference: string;
  carrierName: string | null;
  flagCount: number;
};

export function AlertsStrip({ blockedLoads }: { blockedLoads: BlockedLoad[] }) {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/compliance/alerts")
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error ?? `Alerts unavailable (${res.status}).`);
        return json;
      })
      .then((json) => {
        if (live) setAlerts(json.alerts ?? []);
      })
      .catch((e: Error) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);

  if (error) {
    return (
      <div className="rounded-card border border-danger/40 bg-danger-soft px-4 py-3 text-[13px] text-danger">
        Could not load the compliance alerts: {error}
      </div>
    );
  }

  if (alerts === null) {
    return (
      <div className="h-[76px] animate-pulse rounded-card border border-line bg-surface-2" />
    );
  }

  if (alerts.length === 0 && blockedLoads.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-card border border-line bg-surface px-4 py-3">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ok text-[11px] font-bold text-white">
          ✓
        </span>
        <p className="text-[13px] text-ink-2">
          <span className="font-semibold text-ink">All clear.</span> Every carrier on your
          freight has active authority and valid insurance, and no load is being held by the
          compliance gate.
        </p>
      </div>
    );
  }

  const critical = alerts.filter((a) => a.severity === "CRITICAL");
  const warnings = alerts.filter((a) => a.severity === "WARNING");

  return (
    <section className="space-y-2">
      {critical.map((alert) => (
        <div
          key={alert.carrierOrgId}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-danger/50 bg-danger-soft px-4 py-3"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-danger text-[12px] font-bold text-white">
            !
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold text-danger">
                {alert.carrierName} · {alert.label}
              </span>
              <Badge tone="danger">Critical</Badge>
              {alert.affectedLoads > 0 ? (
                <span className="tnum text-[12px] font-medium text-ink">
                  {alert.affectedLoads} live{" "}
                  {alert.affectedLoads === 1 ? "load" : "loads"} on this carrier
                  {alert.blockedLoads > 0 ? ` · ${alert.blockedLoads} already held` : ""}
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-[13px] text-ink-2">{alert.reason}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {alert.affectedLoads > 0 ? (
              <Link
                href={`/broker?carrierOrgId=${alert.carrierOrgId}`}
                className="rounded-lg border border-danger/40 px-2.5 py-1 text-[12px] font-medium text-danger transition-transform duration-75 hover:bg-danger/10 active:scale-95"
              >
                See the freight
              </Link>
            ) : null}
            <Link
              href="/broker/carriers"
              className="rounded-lg bg-danger px-2.5 py-1 text-[12px] font-medium text-white transition-transform duration-75 hover:opacity-90 active:scale-95"
            >
              Fix compliance
            </Link>
          </div>
        </div>
      ))}

      {(warnings.length > 0 || blockedLoads.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-line bg-surface px-4 py-2.5">
          {blockedLoads.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="danger">
                {blockedLoads.length} {blockedLoads.length === 1 ? "load" : "loads"} held by
                the gate
              </Badge>
              {blockedLoads.slice(0, 6).map((load) => (
                <Link
                  key={load.id}
                  href={`/broker/loads/${load.id}`}
                  className={clsx(
                    "tnum rounded-md border border-danger/40 bg-danger-soft px-1.5 py-0.5",
                    "font-mono text-[11px] font-medium text-danger hover:opacity-80",
                  )}
                >
                  {load.reference}
                </Link>
              ))}
            </div>
          ) : null}

          {warnings.map((alert) => (
            <div key={alert.carrierOrgId} className="flex items-center gap-2">
              <Badge tone="warn">Renewal due</Badge>
              <span className="text-[12px] text-ink-2">
                <span className="font-medium text-ink">{alert.carrierName}</span> —{" "}
                {alert.reason}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
