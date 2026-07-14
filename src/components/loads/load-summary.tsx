import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import { fullDate, lane, money, relative, weight } from "@/lib/format";

/**
 * Exactly what this component reads — nothing more. Typed structurally rather than as
 * the Prisma model so any caller with these fields can use it, but an `any` here would
 * silently render "$NaN" the moment a caller forgot one.
 */
export type LoadSummaryData = {
  reference: string;
  originCity: string;
  originState: string;
  destCity: string;
  destState: string;
  pickupAt: Date | string;
  deliverBy: Date | string;
  equipmentType: string;
  commodity: string;
  weightLbs: number;
  declaredValueCents: number;
  offeredRateCents: number;
  carrierResponse?: string | null;
  notes?: string | null;
  shipperOrg?: { name: string } | null;
  carrierOrg?: { name: string } | null;
  confirmedRate?: { totalRateCents: number; version: number } | null;
};

/**
 * The load, at a glance. Dense on purpose: an ops desk reads this in two seconds and
 * moves on. Anything that could raise a compliance flag (equipment, commodity, declared
 * value) is here, because those are the fields the gate actually reasons about.
 */
export function LoadSummary({ load }: { load: LoadSummaryData }) {
  const carrier = load.carrierOrg;
  const response: string | null = load.carrierResponse ?? null;

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

      <Row label="Equipment">{load.equipmentType}</Row>
      <Row label="Commodity">{load.commodity}</Row>

      <Row label="Weight">
        <span className="tnum">{weight(load.weightLbs)}</span>
      </Row>
      <Row label="Declared value">
        <span className="tnum">{money(load.declaredValueCents)}</span>
        <span className="ml-1.5 text-[11px] text-ink-3">
          cargo insurance must cover this
        </span>
      </Row>

      <Row label="Shipper">{load.shipperOrg?.name ?? "—"}</Row>
      <Row label="Carrier">
        {carrier ? (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{carrier.name}</span>
            {response === "ACCEPTED" ? (
              <Badge tone="ok">Accepted</Badge>
            ) : response === "DECLINED" ? (
              <Badge tone="danger">Declined</Badge>
            ) : (
              <Badge tone="warn">Tender pending</Badge>
            )}
          </span>
        ) : (
          <span className="text-ink-3">Not yet tendered</span>
        )}
      </Row>

      <Row label="Offered rate">
        <span className="tnum">{money(load.offeredRateCents)}</span>
      </Row>
      <Row label="Confirmed rate">
        {load.confirmedRate ? (
          <span className="tnum">
            {money(load.confirmedRate.totalRateCents)}
            <span className="ml-1.5 text-[11px] text-ink-3">
              v{load.confirmedRate.version}
            </span>
          </span>
        ) : (
          <span className="text-ink-3">None confirmed</span>
        )}
      </Row>

      {load.notes ? (
        <div className="col-span-full border-t border-line py-2.5">
          <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
            Notes
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
