"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CarrierResponse, LoadStatus } from "@/generated/prisma/enums";
import { TenderActions } from "@/components/carrier/tender-actions";
import { Badge, Button, Card, CardHeader, FormError, LockedHint } from "@/components/ui";
import { STATUS_LABEL } from "@/lib/loads/state-machine";

/**
 * Everything a CARRIER can do to this load, in one column — and nothing it cannot.
 *
 * The list of moves comes from the server (`transitionsFor(session, id)`), which filters
 * the transition table by `actor === "CARRIER"` and by the permissions this user actually
 * holds. So a broker-only action (assign, confirm rate, override a flag) is not "hidden"
 * here — it never reaches this component at all. A move the user *could* make in principle
 * but may not right now is rendered disabled, with the server's reason attached.
 *
 * The two carrier permissions are deliberately separable, and the seed proves it:
 *   dispatch@ironline.com → load.accept_decline, no load.update_status
 *   driver@ironline.com   → load.update_status + pod.upload, no load.accept_decline
 */

export type CarrierTransition = {
  to: LoadStatus;
  action: string;
  permission: string;
  allowed: boolean;
  blockedReason: string | null;
};

export function CarrierRail({
  loadId,
  reference,
  status,
  carrierResponse,
  transitions,
  canRespond,
}: {
  loadId: string;
  reference: string;
  status: LoadStatus;
  carrierResponse: CarrierResponse;
  transitions: CarrierTransition[];
  canRespond: boolean;
}) {
  const router = useRouter();
  const [pendingTo, setPendingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // "Decline tender" is a state-machine transition (CARRIER_ASSIGNED → POSTED), but to a
  // carrier it is half of one decision, not a lifecycle step. It is rendered in the tender
  // block above alongside Accept, so it is taken out of the lifecycle list here.
  const lifecycle = transitions.filter((t) => t.to !== "POSTED");

  const openTender = status === "CARRIER_ASSIGNED" && carrierResponse === "PENDING";

  async function runTransition(t: CarrierTransition) {
    setPendingTo(t.to);
    setError(null);
    try {
      const res = await fetch(`/api/loads/${loadId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: t.to }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(json?.error ?? `Request failed (${res.status}).`);
        setPendingTo(null);
        return;
      }
      setPendingTo(null);
      router.refresh();
    } catch {
      setError("Network error — the load was not moved.");
      setPendingTo(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Actions"
        subtitle="Everything here is re-authorized server-side."
      />

      <div className="space-y-4 px-5 py-4">
        <FormError message={error} />

        {/* ── The tender ─────────────────────────────────── */}
        <section>
          <SectionLabel>Tender</SectionLabel>

          {openTender ? (
            <>
              <p className="mb-2 text-[13px] text-ink-2">
                This load has been tendered to you and is awaiting your answer. The broker
                cannot confirm a rate until you accept.
              </p>
              <TenderActions
                loadId={loadId}
                reference={reference}
                canRespond={canRespond}
                className="w-full"
              />
            </>
          ) : carrierResponse === "ACCEPTED" ? (
            <div className="flex items-center gap-2">
              <Badge tone="ok">Accepted</Badge>
              <span className="text-[12px] text-ink-3">
                You are committed to this freight.
              </span>
            </div>
          ) : (
            <p className="text-[13px] text-ink-3">
              There is no open tender on this load.
            </p>
          )}
        </section>

        {/* ── The state machine, carrier's half ──────────── */}
        <section>
          <SectionLabel>Lifecycle</SectionLabel>

          {lifecycle.length === 0 ? (
            <p className="text-[13px] text-ink-3">
              {status === "CARRIER_ASSIGNED" || status === "RATE_CONFIRMED"
                ? "The next move belongs to the broker — they confirm the rate and dispatch. You will be able to mark this load in transit once it is dispatched."
                : `No moves are available to a carrier from ${STATUS_LABEL[status]}.`}
            </p>
          ) : (
            <ul className="space-y-2">
              {lifecycle.map((t) => {
                const busy = pendingTo === t.to;
                return (
                  <li key={t.to}>
                    <Button
                      variant="primary"
                      className="w-full"
                      disabled={!t.allowed || busy}
                      title={t.blockedReason ?? undefined}
                      onClick={() => runTransition(t)}
                    >
                      {busy ? "Working…" : t.action}
                    </Button>
                    {!t.allowed && t.blockedReason ? (
                      <p className="mt-1">
                        <LockedHint>{t.blockedReason}</LockedHint>
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </Card>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
      {children}
    </p>
  );
}
