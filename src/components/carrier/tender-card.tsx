import Link from "next/link";
import { TenderActions } from "@/components/carrier/tender-actions";
import { flagLabel } from "@/components/loads/flag-copy";
import { Badge, Card } from "@/components/ui";
import { fullDate, lane, money, relative, weight } from "@/lib/format";

/**
 * An open tender: freight the broker has offered you, waiting on a yes or a no.
 *
 * The whole decision is on the card — lane, dates, equipment, weight, money — because a
 * dispatcher answering a tender does not want to click into a detail page to find out
 * whether they can cover it. If a compliance flag was raised against you at the moment of
 * tender, it is here too: you may still accept, but nothing will move until it clears.
 */

export type TenderCardLoad = {
  id: string;
  reference: string;
  originCity: string;
  originState: string;
  destCity: string;
  destState: string;
  pickupAt: Date;
  deliverBy: Date;
  equipmentType: string;
  commodity: string;
  weightLbs: number;
  offeredRateCents: number;
  brokerName: string;
  shipperName: string;
  blockingCodes: string[];
};

export function TenderCard({
  load,
  canRespond,
}: {
  load: TenderCardLoad;
  canRespond: boolean;
}) {
  return (
    <Card className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <Link
          href={`/carrier/loads/${load.id}`}
          className="tnum font-mono text-[15px] font-semibold text-ink hover:text-brand-600"
        >
          {load.reference}
        </Link>
        <Badge tone="warn">Awaiting your response</Badge>
        <span className="tnum ml-auto text-sm font-semibold text-ink">
          {money(load.offeredRateCents)}
          <span className="ml-1 text-[11px] font-normal text-ink-3">offered</span>
        </span>
      </div>

      <div className="flex-1 px-4 py-3">
        <p className="text-[13px] font-medium text-ink">
          {lane(load.originCity, load.originState, load.destCity, load.destState)}
        </p>

        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
          <Pair label="Pickup">
            <span className="tnum">{fullDate(load.pickupAt)}</span>
            <span className="ml-1 text-ink-3">{relative(load.pickupAt)}</span>
          </Pair>
          <Pair label="Deliver by">
            <span className="tnum">{fullDate(load.deliverBy)}</span>
            <span className="ml-1 text-ink-3">{relative(load.deliverBy)}</span>
          </Pair>
          <Pair label="Equipment">{load.equipmentType}</Pair>
          <Pair label="Commodity">{load.commodity}</Pair>
          <Pair label="Weight">
            <span className="tnum">{weight(load.weightLbs)}</span>
          </Pair>
          <Pair label="Broker">{load.brokerName}</Pair>
          <Pair label="Shipper">{load.shipperName}</Pair>
        </dl>

        {load.blockingCodes.length > 0 ? (
          <div className="mt-3 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2">
            <p className="text-[12px] font-semibold text-danger">
              A compliance flag was raised against you when this was tendered
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {load.blockingCodes.map((code) => (
                <Badge key={code} tone="danger">
                  {flagLabel(code)}
                </Badge>
              ))}
            </div>
            <p className="mt-1 text-[12px] text-ink-2">
              You can still accept — but the load will not move until the flag is cleared.
            </p>
          </div>
        ) : null}
      </div>

      <div className="border-t border-line px-4 py-3">
        <TenderActions
          loadId={load.id}
          reference={load.reference}
          canRespond={canRespond}
          size="sm"
        />
      </div>
    </Card>
  );
}

function Pair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold tracking-wide text-ink-3 uppercase">
        {label}
      </dt>
      <dd className="truncate text-ink">{children}</dd>
    </div>
  );
}
