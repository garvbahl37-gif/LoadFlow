import Link from "next/link";
import { redirect } from "next/navigation";
import type { LoadStatus } from "@/generated/prisma/enums";
import { ComplianceAlert } from "@/components/carrier/compliance-alert";
import { CarrierLoadTable, type CarrierLoadRow } from "@/components/carrier/load-table";
import { TenderCard } from "@/components/carrier/tender-card";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Stat,
} from "@/components/ui";
import { getSession } from "@/lib/auth/session";
import { can, loadScope } from "@/lib/authz/guard";
import { prisma } from "@/lib/db";
import { isPast, money, relative } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/loads/state-machine";

/**
 * The carrier's desk.
 *
 * Every query on this page is `loadScope(session)` — for a CARRIER that is
 * `carrierOrgId === session.orgId`. There is no marketplace here and no way to reach one:
 * a load that has not been tendered to this carrier does not appear, cannot be fetched by
 * id (404 + an audited SCOPE_DENIED row), and cannot be acted on by any endpoint.
 *
 * The sections are the carrier's actual day, in order: what needs an answer, what is
 * rolling, what is waiting on paperwork, what is done.
 */

export default async function CarrierLoadsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const scope = loadScope(session);

  const [rows, compliance] = await Promise.all([
    prisma.load.findMany({
      where: scope,
      include: {
        brokerOrg: { select: { id: true, name: true } },
        shipperOrg: { select: { id: true, name: true } },
        confirmedRate: { select: { version: true, totalRateCents: true } },
        complianceFlags: {
          where: { status: "OPEN" },
          select: { id: true, code: true, severity: true },
        },
        pods: { select: { id: true, verifiedAt: true } },
      },
      orderBy: [{ pickupAt: "asc" }],
      take: 300,
    }),
    prisma.carrierCompliance.findUnique({
      where: { orgId: session.orgId },
      select: { insuranceExpiry: true, authorityStatus: true },
    }),
  ]);

  const loads = rows.map((load) => {
    const openBlocking = load.complianceFlags.filter((f) => f.severity === "BLOCKING");
    const openWarning = load.complianceFlags.length - openBlocking.length;
    return {
      ...load,
      openBlocking: openBlocking.length,
      openWarning,
      blockingCodes: [...new Set(openBlocking.map((f) => f.code))],
      podCount: load.pods.length,
      podVerified: load.pods.some((p) => p.verifiedAt !== null),
    };
  });

  type Row = (typeof loads)[number];

  const tenders = loads.filter(
    (l) => l.status === "CARRIER_ASSIGNED" && l.carrierResponse === "PENDING",
  );

  // Accepted-but-not-yet-priced loads are live work too — they are waiting on the broker,
  // and a carrier that cannot see them would think the freight vanished.
  const active = loads.filter(
    (l) =>
      (l.status === "CARRIER_ASSIGNED" && l.carrierResponse === "ACCEPTED") ||
      l.status === "RATE_CONFIRMED" ||
      l.status === "DISPATCHED" ||
      l.status === "IN_TRANSIT",
  );

  const awaitingPod = loads.filter((l) => l.status === "DELIVERED");

  const recent = loads
    .filter((l) =>
      (["POD_VERIFIED", "INVOICED", "CLOSED", "CANCELLED"] as LoadStatus[]).includes(l.status),
    )
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 10);

  const blocked = loads.filter((l) => l.openBlocking > 0);
  const blockingCodes = [...new Set(blocked.flatMap((l) => l.blockingCodes))];

  const inTransit = loads.filter((l) => l.status === "IN_TRANSIT").length;
  const bookedCents = loads
    .filter((l) => l.status !== "CANCELLED" && l.confirmedRate)
    .reduce((sum, l) => sum + (l.confirmedRate?.totalRateCents ?? 0), 0);

  const canRespond = can(session, "load.accept_decline");
  const canManageCompliance = can(session, "compliance.manage");

  const insuranceLapsed = compliance ? isPast(compliance.insuranceExpiry) : true;
  const authorityBad = compliance ? compliance.authorityStatus !== "ACTIVE" : true;

  /** What is this carrier expected to do next on this load — or who are they waiting on? */
  function hintFor(l: Row): string {
    if (l.openBlocking > 0) return "Blocked — fix compliance";
    switch (l.status) {
      case "CARRIER_ASSIGNED":
        return l.carrierResponse === "ACCEPTED"
          ? "Broker is confirming the rate"
          : "Answer the tender";
      case "RATE_CONFIRMED":
        return "Broker will dispatch";
      case "DISPATCHED":
        return "Mark in transit";
      case "IN_TRANSIT":
        return "Mark delivered";
      case "DELIVERED":
        return l.podCount === 0 ? "Upload the POD" : "Broker is verifying the POD";
      case "POD_VERIFIED":
        return "Broker is invoicing";
      case "INVOICED":
        return "Awaiting close";
      case "CLOSED":
        return "Complete";
      case "CANCELLED":
        return "Cancelled by the broker";
      default:
        return STATUS_LABEL[l.status];
    }
  }

  const toRow = (l: Row): CarrierLoadRow => ({
    id: l.id,
    reference: l.reference,
    originCity: l.originCity,
    originState: l.originState,
    destCity: l.destCity,
    destState: l.destState,
    equipmentType: l.equipmentType,
    commodity: l.commodity,
    pickupAt: l.pickupAt,
    deliverBy: l.deliverBy,
    status: l.status,
    carrierResponse: l.carrierResponse,
    offeredRateCents: l.offeredRateCents,
    confirmedRate: l.confirmedRate,
    openBlocking: l.openBlocking,
    openWarning: l.openWarning,
    hint: hintFor(l),
  });

  return (
    <>
      <PageHeader
        title="My loads"
        subtitle={`${session.orgName} · freight tendered to you, and nothing else`}
        action={
          <Link href="/carrier/compliance">
            <Button variant={blocked.length > 0 ? "danger" : "secondary"}>
              {blocked.length > 0 ? "Compliance is blocking freight" : "Compliance record"}
            </Button>
          </Link>
        }
      />

      {/* The loudest thing on the page, when it applies. */}
      {blocked.length > 0 ? (
        <div className="mb-5">
          <ComplianceAlert
            blockedLoads={blocked.map((l) => ({ id: l.id, reference: l.reference }))}
            codes={blockingCodes}
            canManage={canManageCompliance}
          />
        </div>
      ) : compliance && (insuranceLapsed || authorityBad) ? (
        <div className="mb-5 rounded-card border border-warn/40 bg-warn-soft px-4 py-3">
          <p className="text-[13px] font-semibold text-warn">
            Your compliance record has a problem
          </p>
          <p className="mt-0.5 text-[13px] text-ink-2">
            {insuranceLapsed
              ? `Insurance expired ${relative(compliance.insuranceExpiry)}.`
              : `Operating authority is ${compliance.authorityStatus}.`}{" "}
            No load is blocked right now, but the next one tendered to you will be.{" "}
            <Link href="/carrier/compliance" className="font-medium underline">
              Fix it now
            </Link>
            .
          </p>
        </div>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label="Open tenders"
          value={tenders.length}
          tone={tenders.length > 0 ? "warn" : "neutral"}
          hint="Waiting on your answer"
        />
        <Stat label="Active loads" value={active.length} hint="Accepted through in transit" />
        <Stat label="In transit" value={inTransit} tone="info" hint="Wheels rolling" />
        <Stat
          label="Awaiting POD"
          value={awaitingPod.length}
          tone={awaitingPod.filter((l) => l.podCount === 0).length > 0 ? "warn" : "neutral"}
          hint="Delivered, paperwork open"
        />
        <Stat
          label="Blocked"
          value={blocked.length}
          tone={blocked.length > 0 ? "danger" : "neutral"}
          hint="Held by the compliance gate"
        />
      </div>

      <div className="space-y-5">
        {/* ── Tenders ─────────────────────────────────────── */}
        <section>
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-ink">Tenders awaiting response</h2>
            {tenders.length > 0 ? (
              <Badge tone="warn">{tenders.length}</Badge>
            ) : null}
            {!canRespond && tenders.length > 0 ? (
              <span className="text-[12px] text-ink-3">
                You are missing <code className="font-mono">load.accept_decline</code> — your
                dispatcher answers these.
              </span>
            ) : null}
          </div>

          {tenders.length === 0 ? (
            <Card>
              <EmptyState
                icon="✓"
                title="No open tenders"
                hint="When a broker tenders freight to you it lands here, with the lane, the dates and the money, waiting on a yes or a no."
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {tenders.map((l) => (
                <TenderCard
                  key={l.id}
                  canRespond={canRespond}
                  load={{
                    id: l.id,
                    reference: l.reference,
                    originCity: l.originCity,
                    originState: l.originState,
                    destCity: l.destCity,
                    destState: l.destState,
                    pickupAt: l.pickupAt,
                    deliverBy: l.deliverBy,
                    equipmentType: l.equipmentType,
                    commodity: l.commodity,
                    weightLbs: l.weightLbs,
                    offeredRateCents: l.offeredRateCents,
                    brokerName: l.brokerOrg.name,
                    shipperName: l.shipperOrg.name,
                    blockingCodes: l.blockingCodes,
                  }}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Active ──────────────────────────────────────── */}
        <Card>
          <CardHeader
            title="Active"
            subtitle="Accepted, priced, dispatched, rolling. The status you can move is named in the last column."
            action={
              bookedCents > 0 ? (
                <span className="tnum text-[13px] text-ink-3">
                  <span className="font-semibold text-ink">{money(bookedCents)}</span> booked
                </span>
              ) : null
            }
          />
          {active.length === 0 ? (
            <EmptyState
              title="Nothing on the road"
              hint="Loads you have accepted appear here until they are delivered."
            />
          ) : (
            <CarrierLoadTable rows={active.map(toRow)} />
          )}
        </Card>

        {/* ── Awaiting POD ────────────────────────────────── */}
        <Card>
          <CardHeader
            title="Awaiting proof of delivery"
            subtitle="A delivered load is not a paid load. The broker cannot verify — or invoice — until the signed BOL is attached."
          />
          {awaitingPod.length === 0 ? (
            <EmptyState
              icon="✓"
              title="No paperwork outstanding"
              hint="Delivered loads without a POD on file show up here."
            />
          ) : (
            <CarrierLoadTable rows={awaitingPod.map(toRow)} hintLabel="Paperwork" />
          )}
        </Card>

        {/* ── Recent ──────────────────────────────────────── */}
        <Card>
          <CardHeader
            title="Recently closed"
            subtitle="Verified, invoiced, closed or cancelled — kept in full, with their rate versions and audit trail."
          />
          {recent.length === 0 ? (
            <EmptyState
              title="No completed loads yet"
              hint="Finished freight lands here."
            />
          ) : (
            <CarrierLoadTable rows={recent.map(toRow)} hintLabel="Outcome" />
          )}
        </Card>
      </div>
    </>
  );
}
