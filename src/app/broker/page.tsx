import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import type { LoadStatus } from "@/generated/prisma/enums";
import { LinkButton } from "@/components/link-button";
import { AlertsStrip } from "@/components/loads/alerts-strip";
import { BoardFilters } from "@/components/loads/board-filters";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  LockedHint,
  PageHeader,
  Stat,
  StatusBadge,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { getSession } from "@/lib/auth/session";
import { can, loadScope } from "@/lib/authz/guard";
import { prisma } from "@/lib/db";
import { lane, money, relative, shortDate } from "@/lib/format";
import { LOAD_STATUSES, TERMINAL_STATUSES } from "@/lib/loads/state-machine";

/**
 * The load board.
 *
 * Every query on this page is ANDed with `loadScope(session)` — a broker sees the
 * freight it brokered and nothing else, and no searchParam can widen that. The filters
 * live in the URL so a view is shareable and back-buttonable; the server re-reads them
 * and re-applies the scope on every request.
 *
 * The one thing that must be impossible to miss: freight the compliance gate is holding.
 */

const ORG = { select: { id: true, name: true } } as const;

export default async function BrokerBoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const sp = await searchParams;
  const one = (key: string) => {
    const value = sp[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  };

  const q = one("q");
  const statusRaw = one("status").toUpperCase();
  const status = (LOAD_STATUSES as string[]).includes(statusRaw) ? (statusRaw as LoadStatus) : "";
  const carrierOrgId = one("carrierOrgId");
  const flagged = one("flagged") === "true";

  // Scope first, always. Filters are ANDed on top and can only ever narrow it.
  const scope = loadScope(session);
  const and: Prisma.LoadWhereInput[] = [scope];

  if (q) {
    and.push({
      OR: [
        { reference: { contains: q } },
        { originCity: { contains: q } },
        { originState: { contains: q } },
        { destCity: { contains: q } },
        { destState: { contains: q } },
        { commodity: { contains: q } },
        { equipmentType: { contains: q } },
        { carrierOrg: { name: { contains: q } } },
        { shipperOrg: { name: { contains: q } } },
      ],
    });
  }
  if (status) and.push({ status });
  if (carrierOrgId) and.push({ carrierOrgId });
  if (flagged) and.push({ complianceFlags: { some: { status: "OPEN", severity: "BLOCKING" } } });

  const where: Prisma.LoadWhereInput = { AND: and };

  const [rows, byStatus, blockedRows, carriers] = await Promise.all([
    prisma.load.findMany({
      where,
      include: {
        shipperOrg: ORG,
        carrierOrg: ORG,
        confirmedRate: { select: { id: true, version: true, totalRateCents: true } },
        complianceFlags: {
          where: { status: "OPEN" },
          select: { id: true, severity: true },
        },
      },
      orderBy: [{ pickupAt: "asc" }],
      take: 200,
    }),
    prisma.load.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    prisma.load.findMany({
      where: {
        AND: [scope, { complianceFlags: { some: { status: "OPEN", severity: "BLOCKING" } } }],
      },
      select: {
        id: true,
        reference: true,
        carrierOrg: { select: { name: true } },
        _count: { select: { complianceFlags: true } },
      },
      orderBy: { pickupAt: "asc" },
    }),
    prisma.org.findMany({
      where: { type: "CARRIER" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const loads = rows
    .map((load) => {
      const openBlocking = load.complianceFlags.filter((f) => f.severity === "BLOCKING").length;
      return {
        ...load,
        openBlocking,
        openWarning: load.complianceFlags.length - openBlocking,
        blocked: openBlocking > 0,
      };
    })
    // Blocked freight first; then the truck that leaves soonest.
    .sort((a, b) =>
      a.blocked === b.blocked
        ? a.pickupAt.getTime() - b.pickupAt.getTime()
        : a.blocked
          ? -1
          : 1,
    );

  const count = (s: LoadStatus) => byStatus.find((g) => g.status === s)?._count._all ?? 0;
  const live = byStatus
    .filter((g) => !TERMINAL_STATUSES.includes(g.status))
    .reduce((sum, g) => sum + g._count._all, 0);

  const canCreate = can(session, "load.create");
  const filtered = Boolean(q || status || carrierOrgId || flagged);

  return (
    <>
      <PageHeader
        title="Load board"
        subtitle={`${session.orgName} · every action below is re-authorized server-side`}
        action={
          canCreate ? (
            <LinkButton href="/broker/loads/new" variant="primary" prefetch>
              + Post a load
            </LinkButton>
          ) : (
            <LockedHint>
              Posting a load requires the{" "}
              <code className="mx-1 rounded-xs bg-surface-2 px-1 font-mono text-[11px]">
                load.create
              </code>{" "}
              permission.
            </LockedHint>
          )
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Live loads" value={live} hint="Not closed or cancelled" />
        <Stat
          label="Blocked by compliance"
          value={blockedRows.length}
          tone={blockedRows.length > 0 ? "danger" : "neutral"}
          hint="Held at Carrier Assigned"
        />
        <Stat
          label="Awaiting rate"
          value={count("CARRIER_ASSIGNED")}
          tone={count("CARRIER_ASSIGNED") > 0 ? "warn" : "neutral"}
          hint="Tendered, not yet priced"
        />
        <Stat label="In transit" value={count("IN_TRANSIT")} tone="info" hint="Wheels rolling" />
        <Stat
          label="Awaiting POD"
          value={count("DELIVERED")}
          hint="Delivered, POD not verified"
        />
      </div>

      <div className="mb-5">
        <AlertsStrip
          blockedLoads={blockedRows.map((l) => ({
            id: l.id,
            reference: l.reference,
            carrierName: l.carrierOrg?.name ?? null,
            flagCount: l._count.complianceFlags,
          }))}
        />
      </div>

      <Card>
        <div className="border-b border-line px-4 py-3">
          <BoardFilters
            q={q}
            status={status}
            carrierOrgId={carrierOrgId}
            flagged={flagged}
            carriers={carriers}
            total={loads.length}
          />
        </div>

        {loads.length === 0 ? (
          filtered ? (
            <div className="py-4">
              <EmptyState
                icon="∅"
                title="No loads match those filters"
                hint="Nothing on this board matches the current search. Clear the filters to see the whole book."
              />
              <div className="flex justify-center pb-8">
                <Link href="/broker">
                  <Button variant="secondary">Clear filters</Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="py-4">
              <EmptyState
                title="No freight on the board"
                hint="Post a load to get started. Once you tender it to a carrier, compliance is checked automatically."
              />
              {canCreate ? (
                <div className="flex justify-center pb-8">
                  <Link href="/broker/loads/new">
                    <Button variant="primary">+ Post a load</Button>
                  </Link>
                </div>
              ) : null}
            </div>
          )
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Ref</Th>
                <Th>Lane</Th>
                <Th>Shipper</Th>
                <Th>Carrier</Th>
                <Th>Equipment</Th>
                <Th>Pickup</Th>
                <Th className="text-right">Rate</Th>
                <Th>Status</Th>
                <Th>Flags</Th>
              </tr>
            </thead>
            <tbody>
              {loads.map((load) => (
                <tr
                  key={load.id}
                  className={`relative transition-colors hover:bg-surface-2 ${
                    load.blocked ? "bg-danger-soft/40" : ""
                  }`}
                >
                  <Td className="font-mono text-[13px] whitespace-nowrap">
                    <Link
                      href={`/broker/loads/${load.id}`}
                      className="tnum font-medium text-ink after:absolute after:inset-0 after:content-[''] hover:text-brand-600"
                    >
                      {load.blocked ? (
                        <span className="mr-1.5 text-danger" aria-label="Blocked">
                          ●
                        </span>
                      ) : null}
                      {load.reference}
                    </Link>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {lane(load.originCity, load.originState, load.destCity, load.destState)}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-2">{load.shipperOrg.name}</Td>
                  <Td className="whitespace-nowrap">
                    {load.carrierOrg ? (
                      load.carrierOrg.name
                    ) : (
                      <span className="text-ink-3">Unassigned</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-2">{load.equipmentType}</Td>
                  <Td className="tnum whitespace-nowrap">
                    {shortDate(load.pickupAt)}
                    <span className="ml-1.5 text-[11px] text-ink-3">
                      {relative(load.pickupAt)}
                    </span>
                  </Td>
                  <Td className="tnum text-right whitespace-nowrap">
                    {load.confirmedRate ? (
                      <span className="font-medium">
                        {money(load.confirmedRate.totalRateCents)}
                        <span className="ml-1 text-[11px] text-ink-3">
                          v{load.confirmedRate.version}
                        </span>
                      </span>
                    ) : (
                      <span className="text-ink-3">
                        {money(load.offeredRateCents)}
                        <span className="ml-1 text-[11px]">offered</span>
                      </span>
                    )}
                  </Td>
                  <Td>
                    <StatusBadge status={load.status} />
                  </Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      {load.openBlocking > 0 ? (
                        <Badge tone="danger">
                          {load.openBlocking} blocking
                        </Badge>
                      ) : null}
                      {load.openWarning > 0 ? (
                        <Badge tone="warn">{load.openWarning} warning</Badge>
                      ) : null}
                      {load.complianceFlags.length === 0 ? (
                        <span className="text-[12px] text-ink-3">—</span>
                      ) : null}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
