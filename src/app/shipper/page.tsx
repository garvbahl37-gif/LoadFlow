import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { ShipmentCard, type ShipmentCardLoad } from "@/components/shipper/shipment-card";
import {
  isAwaitingPickup,
  isLate,
  isMoving,
  phaseOf,
  type Phase,
} from "@/components/shipper/phase";
import { getSession, homePathFor } from "@/lib/auth/session";
import { loadScope } from "@/lib/authz/guard";
import { prisma } from "@/lib/db";

/**
 * The shipper's whole product: where is my freight, and when does it land.
 *
 * There is no permission check on this page, and that is not an oversight — it is the
 * model. Shippers hold no roles and no permissions (docs/ARCHITECTURE.md §1), so
 * `can()` returns false for them unconditionally. Their entire access is object-level:
 * `loadScope(session)` resolves to `{ shipperOrgId: session.orgId }`, which is ANDed
 * into every query below. A shipper cannot see another shipper's freight because the
 * query cannot express it — not because a button is hidden.
 *
 * Everything here is read-only. This surface never calls a permission-gated endpoint.
 */
export default async function ShipperDashboard() {
  // The layout already gates this section; re-deriving the session here means the page
  // never renders off a client-supplied identity, even if it is reached another way.
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.orgType !== "SHIPPER") redirect(homePathFor(session.orgType));

  const loads = await prisma.load.findMany({
    where: loadScope(session), // ← the only access control this page needs
    select: {
      id: true,
      reference: true,
      status: true,
      originCity: true,
      originState: true,
      destCity: true,
      destState: true,
      pickupAt: true,
      deliverBy: true,
      commodity: true,
      equipmentType: true,
      weightLbs: true,
      updatedAt: true,
      carrierOrg: { select: { name: true } },
    },
    orderBy: { deliverBy: "asc" },
  });

  const inProgress = loads.filter((l) => phaseOf(l.status) === "IN_PROGRESS");
  const delivered = loads
    .filter((l) => phaseOf(l.status) === "DELIVERED")
    .sort((a, b) => b.deliverBy.getTime() - a.deliverBy.getTime());
  const closed = loads
    .filter((l) => phaseOf(l.status) === "CLOSED")
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  const moving = loads.filter((l) => isMoving(l.status)).length;
  const awaiting = loads.filter((l) => isAwaitingPickup(l.status)).length;
  const landed = loads.filter((l) => phaseOf(l.status) === "DELIVERED").length;
  const late = loads.filter((l) => isLate(l.status, l.deliverBy)).length;

  const nextArrival = inProgress.find((l) => l.status !== "CANCELLED");

  return (
    <>
      <PageHeader
        title="My shipments"
        subtitle={
          loads.length > 0
            ? `${loads.length} shipment${loads.length === 1 ? "" : "s"} booked through your brokers. Read-only — your broker moves the freight.`
            : "Freight booked on your behalf will appear here."
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Awaiting pickup"
          value={awaiting}
          tone={awaiting > 0 ? "brand" : "neutral"}
          hint="Booked, not yet on a truck"
        />
        <Stat
          label="In transit"
          value={moving}
          tone={moving > 0 ? "info" : "neutral"}
          hint={
            nextArrival
              ? `Next arrival ${nextArrival.destCity}, ${nextArrival.destState}`
              : "Nothing on the road"
          }
        />
        <Stat
          label="Delivered"
          value={landed}
          tone={landed > 0 ? "ok" : "neutral"}
          hint="Landed, awaiting or holding a POD"
        />
        <Stat
          label="Past deliver-by"
          value={late}
          tone={late > 0 ? "warn" : "neutral"}
          hint={late > 0 ? "Contact your broker" : "Everything is on schedule"}
        />
      </div>

      {loads.length === 0 ? (
        <Card>
          <EmptyState
            title="No shipments yet"
            hint="When a broker books freight for your organization, it shows up here — with live status, the carrier hauling it, and the signed proof of delivery once it lands."
            icon="📦"
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-8">
          <Group
            title="In progress"
            count={inProgress.length}
            empty="Nothing is moving right now."
            loads={inProgress}
          />
          <Group
            title="Delivered"
            count={delivered.length}
            empty="No completed deliveries yet."
            loads={delivered}
          />
          <Group
            title="Closed"
            count={closed.length}
            empty="Nothing has been closed out yet."
            loads={closed}
          />
        </div>
      )}
    </>
  );
}

const GROUP_HINT: Record<Phase | string, string> = {
  "In progress": "Booked, tendered, or on the road.",
  Delivered: "Landed. Proof of delivery is released once your broker verifies it.",
  Closed: "Settled or cancelled. Kept for your records.",
};

function Group({
  title,
  count,
  empty,
  loads,
}: {
  title: string;
  count: number;
  empty: string;
  loads: ShipmentCardLoad[];
}): ReactNode {
  return (
    <section>
      <div className="mb-2.5 flex items-baseline gap-2.5">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <span className="tnum rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-3">
          {count}
        </span>
        <span className="truncate text-[12px] text-ink-3">{GROUP_HINT[title]}</span>
      </div>

      {loads.length === 0 ? (
        <Card className="px-4 py-6">
          <p className="text-center text-[13px] text-ink-3">{empty}</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          {loads.map((load) => (
            <ShipmentCard key={load.id} load={load} />
          ))}
        </div>
      )}
    </section>
  );
}
