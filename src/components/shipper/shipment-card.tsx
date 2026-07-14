import clsx from "clsx";
import Link from "next/link";
import type { LoadStatus } from "@/generated/prisma/enums";
import { Badge, StatusBadge } from "@/components/ui";
import { fullDate, relative, weight } from "@/lib/format";
import { LOAD_PIPELINE, STATUS_LABEL } from "@/lib/loads/state-machine";
import { isLate, SHIPPER_STATUS_LINE } from "@/components/shipper/phase";

export type ShipmentCardLoad = {
  id: string;
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
  carrierOrg: { name: string } | null;
};

/**
 * One shipment, as a customer reads it: the lane first, then when it lands, then who
 * has it. Deliberately no money — the rates on a load are what the BROKER agreed to
 * pay the CARRIER, and that is not the shipper's side of the deal.
 */
export function ShipmentCard({ load }: { load: ShipmentCardLoad }) {
  const late = isLate(load.status, load.deliverBy);
  const cancelled = load.status === "CANCELLED";

  return (
    <Link
      href={`/shipper/loads/${load.id}`}
      className={clsx(
        "group block rounded-card border bg-surface transition-colors",
        "hover:border-line-strong hover:bg-surface-2",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
        late ? "border-warn/50" : "border-line",
      )}
    >
      <div className="flex flex-col gap-3 px-4 py-3.5 lg:flex-row lg:items-center lg:gap-5">
        {/* Lane + reference */}
        <div className="min-w-0 lg:w-[30%]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tnum font-mono text-[12px] text-ink-3">{load.reference}</span>
            <StatusBadge status={load.status} />
            {late ? <Badge tone="warn">Past deliver-by</Badge> : null}
          </div>
          <p className="mt-1 truncate text-[15px] font-semibold text-ink">
            {load.originCity}, {load.originState}
            <span className="mx-1.5 text-ink-3">→</span>
            {load.destCity}, {load.destState}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-ink-3">
            {load.commodity} · {load.equipmentType} ·{" "}
            <span className="tnum">{weight(load.weightLbs)}</span>
          </p>
        </div>

        {/* Dates */}
        <div className="grid shrink-0 grid-cols-2 gap-x-6 lg:w-[26%]">
          <Stamp
            label="Pickup"
            date={load.pickupAt}
            muted={cancelled}
          />
          <Stamp
            label="Deliver by"
            date={load.deliverBy}
            muted={cancelled}
            tone={late ? "warn" : undefined}
          />
        </div>

        {/* Carrier */}
        <div className="min-w-0 shrink-0 lg:w-[18%]">
          <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Carrier</p>
          <p className="mt-0.5 truncate text-[13px] text-ink">
            {load.carrierOrg ? (
              load.carrierOrg.name
            ) : (
              <span className="text-ink-3">Being sourced</span>
            )}
          </p>
        </div>

        {/* Progress */}
        <div className="min-w-0 flex-1">
          <MiniPipeline status={load.status} />
          <p className="mt-1.5 truncate text-[12px] text-ink-2">
            {SHIPPER_STATUS_LINE[load.status]}
          </p>
        </div>

        <svg
          viewBox="0 0 16 16"
          className="hidden h-4 w-4 shrink-0 fill-none stroke-ink-3 stroke-2 transition-transform group-hover:translate-x-0.5 lg:block"
          aria-hidden
        >
          <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </Link>
  );
}

function Stamp({
  label,
  date,
  tone,
  muted,
}: {
  label: string;
  date: Date;
  tone?: "warn";
  muted?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{label}</p>
      <p
        className={clsx(
          "tnum mt-0.5 text-[13px] whitespace-nowrap",
          muted ? "text-ink-3" : "text-ink",
        )}
      >
        {fullDate(date)}
      </p>
      <p
        className={clsx(
          "text-[11px] whitespace-nowrap",
          tone === "warn" ? "text-warn" : "text-ink-3",
        )}
      >
        {relative(date)}
      </p>
    </div>
  );
}

/**
 * A compact read of the same pipeline the ops desk sees — the shipper is looking at
 * the real state machine, not a marketing-grade approximation of it.
 */
export function MiniPipeline({ status }: { status: LoadStatus }) {
  if (status === "CANCELLED") {
    return (
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 rounded-full bg-danger-soft" />
        <span className="text-[11px] font-medium whitespace-nowrap text-danger">Cancelled</span>
      </div>
    );
  }

  const current = LOAD_PIPELINE.indexOf(status);

  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-1 items-center gap-[3px]">
        {LOAD_PIPELINE.map((step, i) => (
          <span
            key={step}
            title={STATUS_LABEL[step]}
            className={clsx(
              "h-1.5 flex-1 rounded-full",
              i < current && "bg-ok",
              i === current && "bg-brand-500",
              i > current && "bg-surface-2 ring-1 ring-line",
            )}
          />
        ))}
      </div>
      <span className="tnum text-[11px] whitespace-nowrap text-ink-3">
        {current + 1}/{LOAD_PIPELINE.length}
      </span>
    </div>
  );
}
