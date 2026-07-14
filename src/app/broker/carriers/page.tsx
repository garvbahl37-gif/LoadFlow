import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertsStrip } from "@/components/compliance/alerts-strip";
import { carrierRoster } from "@/components/compliance/data";
import {
  ChipList,
  ComplianceStateBadge,
  ExpiryCell,
  AuthorityBadge,
} from "@/components/compliance/state-badge";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Input,
  LockedHint,
  PageHeader,
  Stat,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/authz/guard";
import { COMPLIANCE_STATE_LABEL, COMPLIANCE_STATES } from "@/lib/compliance/schema";
import { moneyShort } from "@/lib/format";
import clsx from "clsx";

/**
 * The broker's carrier-vetting screen — a risk dashboard, not a directory.
 *
 * Everything on it is read through the same scope helpers the API uses, and the load
 * counts are ANDed with this broker's own freight: a broker sees the exposure on *its*
 * loads, never on a rival broker's.
 */
export default async function BrokerCarriersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const sp = await searchParams; // Next 16: searchParams is a Promise
  const q = typeof sp.q === "string" ? sp.q : "";
  const state = typeof sp.state === "string" ? sp.state.toUpperCase() : "";

  const { rows, totals } = await carrierRoster(session, { q, state });
  const editor = can(session, "compliance.manage");

  const filters = ["ALL", ...COMPLIANCE_STATES] as const;
  const activeFilter = state && state !== "ALL" ? state : "ALL";

  return (
    <>
      <PageHeader
        title="Carriers & compliance"
        subtitle="Vet before you tender. Every carrier below is scored on the same facts the compliance gate uses to stop a load."
        action={
          editor ? (
            <Badge tone="brand">You can edit compliance records</Badge>
          ) : (
            <LockedHint>Read-only — compliance.manage required to edit</LockedHint>
          )
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Carriers" value={<span className="tnum">{totals.total}</span>} hint="In the network" />
        <Stat
          label="At risk"
          value={<span className="tnum">{totals.atRisk}</span>}
          tone={totals.atRisk > 0 ? "danger" : "ok"}
          hint="Not fully compliant right now"
        />
        <Stat
          label="Expiring ≤30d"
          value={<span className="tnum">{totals.expiringSoon}</span>}
          tone={totals.expiringSoon > 0 ? "warn" : "ok"}
          hint="Insurance renewal window"
        />
        <Stat
          label="Loads held"
          value={<span className="tnum">{totals.blockedLoads}</span>}
          tone={totals.blockedLoads > 0 ? "danger" : "ok"}
          hint="Stopped by the compliance gate"
        />
      </div>

      <div className="mt-4">
        <AlertsStrip />
      </div>

      <div className="mt-4">
        <Card>
          <CardHeader
            title="Carrier roster"
            subtitle="Sorted worst-first: no record, then expired, then authority, then expiring."
            action={
              <form method="GET" className="flex items-center gap-2">
                {state ? <input type="hidden" name="state" value={state} /> : null}
                <Input
                  name="q"
                  defaultValue={q}
                  placeholder="Search name, MC, DOT, city…"
                  className="h-8 w-56 text-[13px]"
                  aria-label="Search carriers"
                />
                <Button type="submit" size="sm">
                  Search
                </Button>
                {q || (state && state !== "ALL") ? (
                  <Link
                    href="/broker/carriers"
                    className="text-[12px] text-ink-3 hover:text-ink"
                  >
                    Clear
                  </Link>
                ) : null}
              </form>
            }
          />

          <div className="flex flex-wrap gap-1.5 border-b border-line px-5 py-2.5">
            {filters.map((f) => {
              const href =
                f === "ALL"
                  ? `/broker/carriers${q ? `?q=${encodeURIComponent(q)}` : ""}`
                  : `/broker/carriers?state=${f}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
              const on = activeFilter === f;
              return (
                <Link
                  key={f}
                  href={href}
                  className={clsx(
                    "rounded-md border px-2 py-1 text-[12px] font-medium transition-colors",
                    on
                      ? "border-brand-500 bg-brand-500/15 text-brand-700 dark:text-brand-300"
                      : "border-line bg-surface text-ink-3 hover:bg-surface-2 hover:text-ink",
                  )}
                >
                  {f === "ALL" ? "All carriers" : COMPLIANCE_STATE_LABEL[f]}
                </Link>
              );
            })}
          </div>

          {rows.length === 0 ? (
            <EmptyState
              title="No carriers match"
              hint={
                q || activeFilter !== "ALL"
                  ? "Nothing matches this search and filter. Clear them to see the whole roster."
                  : "No carrier organizations exist yet. A carrier appears here as soon as it signs up."
              }
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Carrier</Th>
                  <Th>MC / DOT</Th>
                  <Th>Authority</Th>
                  <Th>Insurance expiry</Th>
                  <Th className="text-right">Cargo coverage</Th>
                  <Th>Approved equipment</Th>
                  <Th>Approved commodities</Th>
                  <Th className="text-right">Live</Th>
                  <Th className="text-right">Blocking</Th>
                  <Th>State</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="group hover:bg-surface-2">
                    <Td>
                      <Link href={`/broker/carriers/${c.id}`} className="block">
                        <p className="text-[13px] font-semibold text-ink group-hover:text-brand-600 dark:group-hover:text-brand-400">
                          {c.name}
                        </p>
                        <p className="text-[12px] text-ink-3">
                          {c.city && c.state ? `${c.city}, ${c.state}` : c.contactEmail}
                        </p>
                      </Link>
                    </Td>
                    <Td className="tnum text-[13px] whitespace-nowrap text-ink-2">
                      {c.mcNumber ?? "—"}
                      <span className="text-ink-3"> / {c.dotNumber ?? "—"}</span>
                    </Td>
                    <Td>
                      <AuthorityBadge status={c.authorityStatus} />
                    </Td>
                    <Td>
                      <ExpiryCell expiry={c.insuranceExpiry} days={c.daysUntilExpiry} />
                    </Td>
                    <Td className="tnum text-right text-[13px] text-ink-2">
                      {c.cargoInsuranceCents === null ? (
                        <span className="text-ink-3">—</span>
                      ) : (
                        moneyShort(c.cargoInsuranceCents)
                      )}
                    </Td>
                    <Td>
                      <ChipList items={c.approvedEquipment} />
                    </Td>
                    <Td>
                      <ChipList items={c.approvedCommodities} />
                    </Td>
                    <Td className="tnum text-right text-[13px] text-ink-2">{c.liveLoads}</Td>
                    <Td className="text-right">
                      {c.blockedLoads > 0 ? (
                        <Badge tone="danger">
                          <span className="tnum">{c.blockedLoads}</span> held
                        </Badge>
                      ) : (
                        <span className="tnum text-[13px] text-ink-3">0</span>
                      )}
                    </Td>
                    <Td>
                      <ComplianceStateBadge state={c.complianceState} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <p className="mt-3 text-[12px] text-ink-3">
        A carrier with a blocking state cannot move a load past{" "}
        <span className="font-medium text-ink-2">Carrier Assigned</span> — the gate stops it
        automatically. Fixing the record clears the flags with no further clicks; overriding
        one requires a written reason that stays in the audit trail forever.
      </p>
    </>
  );
}
