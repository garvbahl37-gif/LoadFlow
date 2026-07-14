import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { StatusPipeline } from "@/components/loads/status-pipeline";
import { LoadTimeline } from "@/components/loads/timeline";
import { DeliveryPanel } from "@/components/shipper/delivery-panel";
import { toCustomerTimeline } from "@/components/shipper/customer-events";
import { SHIPPER_STATUS_LINE, isLate } from "@/components/shipper/phase";
import { ShipmentSummary } from "@/components/shipper/shipment-summary";
import { Badge, Card, CardHeader, LockedHint, PageHeader, StatusBadge } from "@/components/ui";
import { audit } from "@/lib/audit/log";
import { getSession, homePathFor } from "@/lib/auth/session";
import { loadScope } from "@/lib/authz/guard";
import { prisma } from "@/lib/db";
import { lane } from "@/lib/format";

/**
 * One shipment, from the customer's side of the glass.
 *
 * Two things are load-bearing here and neither is cosmetic:
 *
 *   1. The load is fetched THROUGH `loadScope(session)` → `{ shipperOrgId: orgId }`.
 *      A shipper pasting a rival's load id gets a 404 — never a 403, because we do not
 *      confirm the existence of a record they may not see — and the probe lands in the
 *      audit log as SCOPE_DENIED.
 *   2. The timeline is filtered by an ALLOWLIST (see components/shipper/customer-events)
 *      before it ever reaches the renderer. The raw trail contains the broker's rate
 *      confirmations, the carrier's compliance flags, override reasons and permission
 *      denials. None of that crosses to the counterparty.
 */
export default async function ShipperLoadDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params; // Next 16: params is a Promise
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.orgType !== "SHIPPER") redirect(homePathFor(session.orgType));

  const load = await prisma.load.findFirst({
    // The scope filter is ANDed in, always. It is the whole control.
    where: { AND: [{ id }, loadScope(session)] },
    select: {
      id: true,
      reference: true,
      status: true,
      carrierResponse: true,
      originCity: true,
      originState: true,
      destCity: true,
      destState: true,
      pickupAt: true,
      deliverBy: true,
      commodity: true,
      equipmentType: true,
      weightLbs: true,
      declaredValueCents: true,
      notes: true,
      createdAt: true,
      brokerOrgId: true,
      carrierOrgId: true,
      brokerOrg: { select: { name: true } },
      carrierOrg: { select: { name: true, mcNumber: true, dotNumber: true } },
      pods: {
        // NOT `data` — the bytes are streamed from /api/pods/[podId]/file, which
        // re-resolves the POD through this same scope filter on its own.
        select: {
          id: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          uploadedAt: true,
          verifiedAt: true,
        },
        orderBy: { uploadedAt: "desc" },
      },
    },
  });

  if (!load) {
    await audit({
      actor: session,
      action: "SCOPE_DENIED",
      entityType: "Load",
      entityId: id,
      outcome: "DENIED",
      summary: `Blocked: ${session.email} requested load ${id}, which is outside their organization's scope.`,
      detail: { orgType: session.orgType, orgId: session.orgId },
    });
    notFound();
  }

  const rows = await prisma.auditLog.findMany({
    where: { loadId: load.id },
    orderBy: { ts: "desc" },
    select: {
      id: true,
      ts: true,
      action: true,
      outcome: true,
      actorOrgId: true,
      fromStatus: true,
      toStatus: true,
      // `summary` and `detail` are deliberately NOT selected. They are written for an
      // ops desk and carry internal notes, flag codes and override reasons. The
      // customer-facing copy is re-derived from the action and the status.
    },
  });

  const events = toCustomerTimeline(rows, {
    brokerOrgId: load.brokerOrgId,
    brokerName: load.brokerOrg.name,
    carrierOrgId: load.carrierOrgId,
    carrierName: load.carrierOrg?.name ?? null,
  });

  const deliveredAt =
    rows.find((r) => r.outcome === "ALLOWED" && r.toStatus === "DELIVERED")?.ts ?? null;

  const late = isLate(load.status, load.deliverBy);

  return (
    <>
      <Link
        href="/shipper"
        className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-ink-3 transition-colors hover:text-ink"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-none stroke-current stroke-2" aria-hidden>
          <path d="M10 3 5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        All shipments
      </Link>

      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="tnum font-mono text-ink-2">{load.reference}</span>
            <span>{lane(load.originCity, load.originState, load.destCity, load.destState)}</span>
            <StatusBadge status={load.status} />
            {late ? <Badge tone="warn">Past deliver-by</Badge> : null}
          </span>
        }
        subtitle={SHIPPER_STATUS_LINE[load.status]}
        action={<LockedHint>Read-only — your broker and carrier move this shipment.</LockedHint>}
      />

      <div className="mb-6">
        <StatusPipeline status={load.status} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          <Card>
            <CardHeader
              title="Delivery confirmation"
              subtitle="Proof of delivery is released to you once your broker has verified it."
            />
            <DeliveryPanel
              status={load.status}
              deliverBy={load.deliverBy}
              deliveredAt={deliveredAt}
              pods={load.pods}
            />
          </Card>

          <Card>
            <CardHeader
              title="Shipment details"
              subtitle="Your freight, the lane, and who is hauling it."
            />
            <ShipmentSummary load={load} />
          </Card>
        </div>

        <Card className="lg:sticky lg:top-20 lg:self-start">
          <CardHeader
            title="Shipment history"
            subtitle="Milestones only — your broker's internal activity is not shown."
          />
          <LoadTimeline events={events} />
        </Card>
      </div>
    </>
  );
}
