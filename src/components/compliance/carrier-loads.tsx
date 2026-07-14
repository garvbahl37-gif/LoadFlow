import Link from "next/link";
import type { CarrierLoadRow } from "@/components/compliance/data";
import { Card, CardHeader, EmptyState, StatusBadge, Table, Td, Th } from "@/components/ui";
import { FLAG_LABEL, type FlagCode } from "@/lib/compliance/evaluator";
import { lane, money, shortDate } from "@/lib/format";

/**
 * "What is riding on this record right now." Rendered under the form on both sides of
 * the deal, so the person editing the record can see, line by line, what their edit is
 * about to free up — or about to stop.
 */
export function CarrierLoads({
  loads,
  hrefBase,
  title = "Loads with this carrier",
  emptyHint,
}: {
  loads: CarrierLoadRow[];
  hrefBase: string;
  title?: string;
  emptyHint?: string;
}) {
  const blocked = loads.filter((l) => l.openFlags.some((f) => f.severity === "BLOCKING")).length;

  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={
          loads.length === 0
            ? undefined
            : `${loads.length} ${loads.length === 1 ? "load" : "loads"}${
                blocked > 0 ? ` · ${blocked} held by the compliance gate` : " · none held"
              }`
        }
      />

      {loads.length === 0 ? (
        <EmptyState
          title="No loads with this carrier"
          hint={emptyHint ?? "Nothing has been tendered to them yet, so nothing is at stake."}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Load</Th>
              <Th>Lane</Th>
              <Th>Pickup</Th>
              <Th>Equipment / commodity</Th>
              <Th className="text-right">Declared value</Th>
              <Th>Status</Th>
              <Th>Compliance</Th>
            </tr>
          </thead>
          <tbody>
            {loads.map((l) => {
              const blocking = l.openFlags.filter((f) => f.severity === "BLOCKING");
              const warnings = l.openFlags.filter((f) => f.severity !== "BLOCKING");
              return (
                <tr key={l.id} className="hover:bg-surface-2">
                  <Td>
                    <Link
                      href={`${hrefBase}/${l.id}`}
                      className="tnum text-[13px] font-semibold text-ink hover:text-brand-600 dark:hover:text-brand-400"
                    >
                      {l.reference}
                    </Link>
                  </Td>
                  <Td className="text-[13px] text-ink-2">
                    {lane(l.originCity, l.originState, l.destCity, l.destState)}
                  </Td>
                  <Td className="tnum text-[13px] whitespace-nowrap text-ink-2">
                    {shortDate(l.pickupAt)}
                  </Td>
                  <Td className="text-[13px] text-ink-2">
                    {l.equipmentType}
                    <span className="text-ink-3"> · {l.commodity}</span>
                  </Td>
                  <Td className="tnum text-right text-[13px] text-ink-2">
                    {money(l.declaredValueCents)}
                  </Td>
                  <Td>
                    <StatusBadge status={l.status} />
                  </Td>
                  <Td>
                    {blocking.length === 0 && warnings.length === 0 ? (
                      <span className="text-[12px] text-ink-3">Clear</span>
                    ) : (
                      <div className="space-y-1">
                        {blocking.map((f) => (
                          <p
                            key={f.id}
                            className="text-[12px] font-medium text-danger"
                            title={f.message}
                          >
                            {FLAG_LABEL[f.code as FlagCode] ?? f.code}
                          </p>
                        ))}
                        {warnings.map((f) => (
                          <p key={f.id} className="text-[12px] text-warn" title={f.message}>
                            {FLAG_LABEL[f.code as FlagCode] ?? f.code}
                          </p>
                        ))}
                      </div>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
