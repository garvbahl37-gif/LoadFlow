import Link from "next/link";
import type { CarrierResponse, LoadStatus } from "@/generated/prisma/enums";
import { Badge, StatusBadge, Table, Td, Th } from "@/components/ui";
import { lane, money, relative, shortDate } from "@/lib/format";

/**
 * The carrier's loads, dense. Every row here came out of a query ANDed with
 * `loadScope(session)` (carrierOrgId === session.orgId), so there is no marketplace on
 * this screen and no rival's freight — by construction, not by filtering after the fact.
 */

export type CarrierLoadRow = {
  id: string;
  reference: string;
  originCity: string;
  originState: string;
  destCity: string;
  destState: string;
  equipmentType: string;
  commodity: string;
  pickupAt: Date;
  deliverBy: Date;
  status: LoadStatus;
  carrierResponse: CarrierResponse;
  offeredRateCents: number;
  confirmedRate: { version: number; totalRateCents: number } | null;
  openBlocking: number;
  openWarning: number;
  /** What the carrier is expected to do next — or who they are waiting on. */
  hint: string;
};

export function CarrierLoadTable({
  rows,
  hintLabel = "Next",
}: {
  rows: CarrierLoadRow[];
  hintLabel?: string;
}) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Ref</Th>
          <Th>Lane</Th>
          <Th>Equipment</Th>
          <Th>Pickup</Th>
          <Th>Deliver by</Th>
          <Th className="text-right">Rate</Th>
          <Th>Status</Th>
          <Th>{hintLabel}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            className={`relative transition-colors hover:bg-surface-2 ${
              row.openBlocking > 0 ? "bg-danger-soft/40" : ""
            }`}
          >
            <Td className="font-mono text-[13px] whitespace-nowrap">
              <Link
                href={`/carrier/loads/${row.id}`}
                className="tnum font-medium text-ink after:absolute after:inset-0 after:content-[''] hover:text-brand-600"
              >
                {row.openBlocking > 0 ? (
                  <span className="mr-1.5 text-danger" aria-label="Blocked">
                    ●
                  </span>
                ) : null}
                {row.reference}
              </Link>
            </Td>
            <Td className="whitespace-nowrap">
              {lane(row.originCity, row.originState, row.destCity, row.destState)}
              <span className="ml-1.5 text-[11px] text-ink-3">{row.commodity}</span>
            </Td>
            <Td className="whitespace-nowrap text-ink-2">{row.equipmentType}</Td>
            <Td className="tnum whitespace-nowrap">
              {shortDate(row.pickupAt)}
              <span className="ml-1.5 text-[11px] text-ink-3">{relative(row.pickupAt)}</span>
            </Td>
            <Td className="tnum whitespace-nowrap">
              {shortDate(row.deliverBy)}
              <span className="ml-1.5 text-[11px] text-ink-3">{relative(row.deliverBy)}</span>
            </Td>
            <Td className="tnum text-right whitespace-nowrap">
              {row.confirmedRate ? (
                <span className="font-medium">
                  {money(row.confirmedRate.totalRateCents)}
                  <span className="ml-1 text-[11px] text-ink-3">
                    v{row.confirmedRate.version}
                  </span>
                </span>
              ) : (
                <span className="text-ink-3">
                  {money(row.offeredRateCents)}
                  <span className="ml-1 text-[11px]">offered</span>
                </span>
              )}
            </Td>
            <Td>
              <span className="flex flex-wrap items-center gap-1">
                <StatusBadge status={row.status} />
                {row.openBlocking > 0 ? (
                  <Badge tone="danger">{row.openBlocking} blocking</Badge>
                ) : null}
                {row.openWarning > 0 ? (
                  <Badge tone="warn">{row.openWarning} warning</Badge>
                ) : null}
              </span>
            </Td>
            <Td className="text-[12px] whitespace-nowrap text-ink-3">{row.hint}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
