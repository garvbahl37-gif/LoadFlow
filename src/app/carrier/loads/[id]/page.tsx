import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { CarrierRail } from "@/components/carrier/carrier-rail";
import { PodUpload } from "@/components/carrier/pod-upload";
import { PodViewer } from "@/components/carrier/pod-viewer";
import { FlagsPanel } from "@/components/loads/flags-panel";
import { LoadSummary } from "@/components/loads/load-summary";
import { RateHistory } from "@/components/loads/rate-history";
import { StatusPipeline } from "@/components/loads/status-pipeline";
import { LoadTimeline } from "@/components/loads/timeline";
import {
  Badge,
  BlockedBanner,
  Button,
  Card,
  CardHeader,
  StatusBadge,
} from "@/components/ui";
import { getSession } from "@/lib/auth/session";
import { can, loadInScopeOrThrow } from "@/lib/authz/guard";
import { prisma } from "@/lib/db";
import { dateTime, money } from "@/lib/format";
import { transitionsFor } from "@/lib/loads/service";

/**
 * A load, from the carrier's side of the deal.
 *
 * Read through `loadInScopeOrThrow` — a load tendered to a rival carrier is a 404 here
 * and an audited SCOPE_DENIED row, never a 403 that would confirm it exists. The action
 * rail is built from `transitionsFor(session, id)`, the SERVER's copy of the state machine,
 * filtered to `actor === "CARRIER"`: the broker's moves (assign, confirm rate, dispatch,
 * verify POD, invoice, close) and the broker-only override control are not hidden from
 * this page — they are never produced for it.
 */

const DETAIL_INCLUDE = {
  shipperOrg: { select: { id: true, name: true } },
  brokerOrg: { select: { id: true, name: true } },
  carrierOrg: { select: { id: true, name: true } },
  confirmedRate: { select: { id: true, version: true, totalRateCents: true } },
  complianceFlags: {
    orderBy: { raisedAt: "desc" },
    include: { overriddenBy: { select: { name: true } } },
  },
  rateConfirmations: {
    orderBy: { version: "desc" },
    include: { createdBy: { select: { name: true } } },
  },
  pods: {
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      notes: true,
      uploadedAt: true,
      verifiedAt: true,
      uploadedBy: { select: { name: true, email: true } },
      verifiedBy: { select: { name: true } },
    },
  },
} satisfies Prisma.LoadInclude;

export default async function CarrierLoadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const load = await loadInScopeOrThrow(session, id, DETAIL_INCLUDE).catch(() => null);
  if (!load) notFound();

  const [transitions, events] = await Promise.all([
    transitionsFor(session, load.id),
    prisma.auditLog.findMany({
      where: { loadId: load.id },
      orderBy: { ts: "desc" },
      take: 200,
      select: {
        id: true,
        ts: true,
        action: true,
        summary: true,
        outcome: true,
        actorName: true,
        actorEmail: true,
        fromStatus: true,
        toStatus: true,
      },
    }),
  ]);

  const openBlocking = load.complianceFlags.filter(
    (f) => f.status === "OPEN" && f.severity === "BLOCKING",
  ).length;

  const pendingTender =
    load.status === "CARRIER_ASSIGNED" && load.carrierResponse === "PENDING";
  const latestVersion = load.rateConfirmations[0]?.version ?? 0;

  return (
    <>
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/carrier" className="text-[13px] text-ink-3 hover:text-ink">
              My loads
            </Link>
            <span className="text-ink-3">/</span>
            <h1 className="tnum font-mono text-xl font-semibold tracking-tight text-ink">
              {load.reference}
            </h1>
            <StatusBadge status={load.status} />
            {openBlocking > 0 ? <Badge tone="danger">Blocked</Badge> : null}
            {pendingTender ? <Badge tone="warn">Tender awaiting your response</Badge> : null}
            {load.confirmedRate ? (
              <Badge tone="ok">
                Rate v{load.confirmedRate.version} ·{" "}
                {money(load.confirmedRate.totalRateCents)}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-ink-3">
            Brokered by {load.brokerOrg.name} · tendered {dateTime(load.updatedAt)}
          </p>
        </div>
        <Link href="/carrier">
          <Button variant="ghost">Back to my loads</Button>
        </Link>
      </div>

      <div className="mb-5 space-y-3">
        <StatusPipeline status={load.status} />
        {openBlocking > 0 ? (
          <BlockedBanner count={openBlocking}>
            <p className="mt-1.5">
              <Link
                href="/carrier/compliance"
                className="font-medium text-danger underline"
              >
                Fix your compliance record
              </Link>{" "}
              — every affected load is re-evaluated the moment you do, and the flags clear
              themselves. Only the broker can override a flag.
            </p>
          </BlockedBanner>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ── Main column ─────────────────────────────────── */}
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Load"
              subtitle="Equipment, commodity and declared value are exactly what the compliance gate checks your record against."
            />
            <LoadSummary load={load} />
          </Card>

          <Card>
            <CardHeader
              title="Proof of delivery"
              subtitle="The signed bill of lading. The broker cannot verify or invoice this load without it."
            />
            <PodViewer pods={load.pods} />
          </Card>

          <Card>
            <CardHeader
              title="Compliance"
              subtitle={
                openBlocking > 0
                  ? `${openBlocking} open blocking ${openBlocking === 1 ? "flag" : "flags"} against you — this load cannot move.`
                  : "Raised against your record at the moment of tender, and re-checked whenever it changes."
              }
            />
            <FlagsPanel
              flags={load.complianceFlags}
              loadId={load.id}
              /* A carrier can never hold load.override_compliance_flag — it is a
                 broker-only permission. can() returns false on the org type alone, so no
                 override control is rendered here, ever. Carriers clear flags by fixing
                 the underlying record. */
              canOverride={can(session, "load.override_compliance_flag")}
            />
          </Card>

          <Card>
            <CardHeader
              title="Rate confirmations"
              subtitle={
                latestVersion === 0
                  ? "The broker has not confirmed a rate yet. They cannot until you accept the tender."
                  : `${latestVersion} ${latestVersion === 1 ? "version" : "versions"} — what was agreed, and what it superseded.`
              }
            />
            <RateHistory
              rates={load.rateConfirmations}
              confirmedRateId={load.confirmedRateConfirmationId}
            />
          </Card>

          <Card>
            <CardHeader
              title="Audit trail"
              subtitle="Every action on this load, attributed and timestamped — including the ones that were denied."
            />
            <LoadTimeline events={events} />
          </Card>
        </div>

        {/* ── Action rail ─────────────────────────────────── */}
        <div className="space-y-5">
          <CarrierRail
            loadId={load.id}
            reference={load.reference}
            status={load.status}
            carrierResponse={load.carrierResponse}
            transitions={transitions}
            canRespond={can(session, "load.accept_decline")}
          />

          <Card>
            <CardHeader
              title="Upload a POD"
              subtitle={
                load.pods.length > 0
                  ? `${load.pods.length} ${load.pods.length === 1 ? "document" : "documents"} on file.`
                  : "PNG, JPEG, WebP or PDF · up to 5 MB."
              }
            />
            <PodUpload
              loadId={load.id}
              status={load.status}
              canUpload={can(session, "pod.upload")}
              hasPod={load.pods.length > 0}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
