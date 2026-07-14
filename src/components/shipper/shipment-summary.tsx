import type { ReactNode } from "react";
import type { LoadStatus } from "@/generated/prisma/enums";
import { Badge } from "@/components/ui";
import { fullDate, lane, money, relative, weight } from "@/lib/format";

/**
 * The shipper's view of their own load.
 *
 * This deliberately does NOT reuse `@/components/loads/load-summary`. That component
 * renders "Offered rate" and "Confirmed rate" — which are the BROKER↔CARRIER numbers.
 * A shipper seeing what their broker pays the carrier is a margin leak between
 * counterparties, and one shared component away from being a lawsuit. So the shipper
 * gets its own summary, and the only money on it is the shipper's OWN declared cargo
 * value, which is data they supplied.
 */

export type ShipmentSummaryLoad = {
  reference: string;
  status: LoadStatus;
  originCity: string;
  originState: string;
  destCity: string;
  destState: string;
  pickupAt: Date;
  deliverBy: Date;
  commodity: string;
  equipmentType: string;
  weightLbs: number;
  declaredValueCents: number;
  createdAt: Date;
  notes: string | null;
  brokerOrg: { name: string };
  carrierOrg: { name: string; mcNumber: string | null; dotNumber: string | null } | null;
  carrierResponse: string;
};

export function ShipmentSummary({ load }: { load: ShipmentSummaryLoad }) {
  const carrier = load.carrierOrg;

  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-0 px-5 py-1 sm:grid-cols-2">
      <Row label="Lane">
        <span className="font-medium">
          {lane(load.originCity, load.originState, load.destCity, load.destState)}
        </span>
      </Row>
      <Row label="Reference">
        <span className="tnum font-mono">{load.reference}</span>
      </Row>

      <Row label="Pickup">
        <span className="tnum">{fullDate(load.pickupAt)}</span>
        <span className="ml-1.5 text-ink-3">{relative(load.pickupAt)}</span>
      </Row>
      <Row label="Deliver by">
        <span className="tnum">{fullDate(load.deliverBy)}</span>
        <span className="ml-1.5 text-ink-3">{relative(load.deliverBy)}</span>
      </Row>

      <Row label="Commodity">{load.commodity}</Row>
      <Row label="Equipment">{load.equipmentType}</Row>

      <Row label="Weight">
        <span className="tnum">{weight(load.weightLbs)}</span>
      </Row>
      <Row label="Declared value">
        <span className="tnum">{money(load.declaredValueCents)}</span>
        <span className="ml-1.5 text-[11px] text-ink-3">as declared by you</span>
      </Row>

      <Row label="Brokered by">{load.brokerOrg.name}</Row>
      <Row label="Carrier">
        {carrier ? (
          <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
            <span className="font-medium">{carrier.name}</span>
            {load.carrierResponse === "ACCEPTED" ? (
              <Badge tone="ok">Committed</Badge>
            ) : load.carrierResponse === "DECLINED" ? (
              <Badge tone="warn">Re-sourcing</Badge>
            ) : (
              <Badge tone="warn">Confirming</Badge>
            )}
          </span>
        ) : (
          <span className="text-ink-3">Your broker is sourcing a carrier</span>
        )}
      </Row>

      {carrier && (carrier.mcNumber || carrier.dotNumber) ? (
        <Row label="Carrier authority">
          <span className="tnum text-ink-2">
            {carrier.mcNumber ? `MC ${carrier.mcNumber}` : null}
            {carrier.mcNumber && carrier.dotNumber ? " · " : null}
            {carrier.dotNumber ? `DOT ${carrier.dotNumber}` : null}
          </span>
        </Row>
      ) : null}

      <Row label="Booked">
        <span className="tnum">{fullDate(load.createdAt)}</span>
      </Row>

      {load.notes ? (
        <div className="col-span-full border-t border-line py-2.5">
          <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
            Shipment notes
          </p>
          <p className="mt-0.5 text-[13px] text-ink-2">{load.notes}</p>
        </div>
      ) : null}
    </dl>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
      <dt className="text-[11px] font-semibold tracking-wide whitespace-nowrap text-ink-3 uppercase">
        {label}
      </dt>
      <dd className="min-w-0 text-right text-[13px] text-ink">{children}</dd>
    </div>
  );
}
