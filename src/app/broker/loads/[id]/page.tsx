import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { ActionsRail } from "@/components/loads/actions-rail";
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
  EmptyState,
  StatusBadge,
} from "@/components/ui";
import { getSession } from "@/lib/auth/session";
import { can, loadInScopeOrThrow } from "@/lib/authz/guard";
import { prisma } from "@/lib/db";
import { dateTime, money } from "@/lib/format";
import { transitionsFor } from "@/lib/loads/service";
import { ACCESSORIAL_CATALOG } from "@/lib/rates/service";

/**
 * Load detail — the whole domain on one page.
 *
 * Read through `loadInScopeOrThrow`, so a load belonging to another broker is a 404
 * (and an audited SCOPE_DENIED row), never a 403 that confirms it exists. The action
 * rail is built from `transitionsFor(session, id)` — the SERVER's copy of the state
 * machine — so a move the caller may not make is rendered disabled with the reason,
 * not hidden and not silently allowed.
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
    },
  },
  createdBy: { select: { name: true, email: true } },
} satisfies Prisma.LoadInclude;

export default async function LoadDetailPage({
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

  const latestVersion = load.rateConfirmations[0]?.version ?? 0;
  const negotiable = load.status === "CARRIER_ASSIGNED" || load.status === "RATE_CONFIRMED";
  const pod = load.pods[0] ?? null;

  return (
    <>
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/broker"
              className="text-[13px] text-ink-3 hover:text-ink"
            >
              Load board
            </Link>
            <span className="text-ink-3">/</span>
            <h1 className="tnum font-mono text-xl font-semibold tracking-tight text-ink">
              {load.reference}
            </h1>
            <StatusBadge status={load.status} />
            {openBlocking > 0 ? <Badge tone="danger">Blocked</Badge> : null}
            {load.confirmedRate ? (
              <Badge tone="ok">
                Rate v{load.confirmedRate.version} · {money(load.confirmedRate.totalRateCents)}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-ink-3">
            Posted by {load.createdBy?.name ?? "—"} · {dateTime(load.createdAt)}
          </p>
        </div>
        <Link href="/broker">
          <Button variant="ghost">Back to the board</Button>
        </Link>
      </div>

      <div className="mb-5 space-y-3">
        <StatusPipeline status={load.status} />
        {openBlocking > 0 ? <BlockedBanner count={openBlocking} /> : null}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ── Main column ─────────────────────────────────── */}
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Load"
              subtitle="Equipment, commodity and declared value are what the compliance gate reasons about."
            />
            <LoadSummary load={load} />
          </Card>

          <Card>
            <CardHeader
              title="Compliance"
              subtitle={
                openBlocking > 0
                  ? `${openBlocking} open blocking ${openBlocking === 1 ? "flag" : "flags"} — this load cannot move.`
                  : "Evaluated on tender, and again whenever the carrier's record changes."
              }
            />
            <FlagsPanel
              flags={load.complianceFlags}
              loadId={load.id}
              canOverride={can(session, "load.override_compliance_flag")}
            />
          </Card>

          <Card>
            <CardHeader
              title="Rate confirmations"
              subtitle={
                latestVersion === 0
                  ? "No version yet."
                  : `${latestVersion} ${latestVersion === 1 ? "version" : "versions"} — superseded ones are kept, never edited.`
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
          <ActionsRail
            loadId={load.id}
            status={load.status}
            transitions={transitions}
            canAssign={can(session, "load.assign_carrier")}
            canConfirmRate={can(session, "rate.confirm")}
            hasCarrier={load.carrierOrgId !== null}
            negotiable={negotiable}
            nextVersion={latestVersion + 1}
            offeredRateCents={load.offeredRateCents}
            accessorialCatalog={ACCESSORIAL_CATALOG.map((a) => ({
              code: a.code,
              label: a.label,
            }))}
          />

          <Card>
            <CardHeader
              title="Proof of delivery"
              subtitle="Uploaded by the carrier; required before POD Verified."
            />
            {pod ? (
              <div className="px-5 py-4">
                <p className="text-[13px] font-medium text-ink">{pod.fileName}</p>
                <p className="tnum mt-0.5 text-[12px] text-ink-3">
                  {(pod.sizeBytes / 1024).toFixed(0)} KB · {pod.mimeType} ·{" "}
                  {dateTime(pod.uploadedAt)}
                </p>
                {pod.notes ? (
                  <p className="mt-1.5 text-[12px] text-ink-2">{pod.notes}</p>
                ) : null}
                <div className="mt-3 flex items-center gap-2">
                  <a href={`/api/pods/${pod.id}/file`} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="secondary">
                      Open document
                    </Button>
                  </a>
                  {pod.verifiedAt ? <Badge tone="ok">Verified</Badge> : null}
                </div>
              </div>
            ) : (
              <EmptyState
                title="No POD uploaded"
                hint="The assigned carrier uploads it after delivery. Verify POD stays locked until they do."
              />
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
