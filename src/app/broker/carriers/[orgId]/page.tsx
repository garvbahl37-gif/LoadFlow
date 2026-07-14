import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CarrierLoads } from "@/components/compliance/carrier-loads";
import { ComplianceForm } from "@/components/compliance/compliance-form";
import { ConsequenceBanner } from "@/components/compliance/consequence-banner";
import { carrierComplianceView } from "@/components/compliance/data";
import { AuthorityBadge, ComplianceStateBadge } from "@/components/compliance/state-badge";
import { Card, PageHeader, Stat } from "@/components/ui";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/authz/guard";
import { dateTime, money } from "@/lib/format";

/**
 * One carrier's full compliance record, from the broker's side of the deal.
 *
 * The record is readable by any broker staffer (they must be able to vet), and editable
 * only with `compliance.manage`. `canEdit` here decides what to *show*; the PUT behind
 * the form re-checks the permission and the scope independently, so a Dispatcher who
 * forges the request by hand still gets a 403 with a DENIED row in the audit log.
 */
export default async function BrokerCarrierDetailPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params; // Next 16: params is a Promise
  const session = await getSession();
  if (!session) redirect("/login");

  // Out of scope → 404. We never confirm the existence of a record you may not see.
  const view = await carrierComplianceView(session, orgId);
  if (!view) notFound();

  const { org, compliance, state, daysUntilExpiry, liveLoads, blockedLoads, loads } = view;
  const canEdit = can(session, "compliance.manage");

  return (
    <>
      <div className="mb-4">
        <Link href="/broker/carriers" className="text-[13px] text-ink-3 hover:text-ink">
          ← Carriers &amp; compliance
        </Link>
      </div>

      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {org.name}
            <ComplianceStateBadge state={state} />
            <AuthorityBadge status={compliance?.authorityStatus ?? null} />
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="tnum">
              MC {org.mcNumber ?? "—"} · DOT {org.dotNumber ?? "—"}
            </span>
            {org.city && org.state ? (
              <span>
                {org.city}, {org.state}
              </span>
            ) : null}
            <span>{org.contactEmail}</span>
            {org.phone ? <span className="tnum">{org.phone}</span> : null}
          </span>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Live loads"
          value={<span className="tnum">{liveLoads}</span>}
          hint="Your freight on this carrier"
        />
        <Stat
          label="Held by the gate"
          value={<span className="tnum">{blockedLoads}</span>}
          tone={blockedLoads > 0 ? "danger" : "ok"}
          hint={blockedLoads > 0 ? "Cannot be dispatched" : "Nothing blocked"}
        />
        <Stat
          label="Insurance"
          value={
            daysUntilExpiry === null ? (
              "—"
            ) : daysUntilExpiry < 0 ? (
              <span className="tnum">{Math.abs(daysUntilExpiry)}d lapsed</span>
            ) : (
              <span className="tnum">{daysUntilExpiry}d left</span>
            )
          }
          tone={
            daysUntilExpiry === null
              ? "neutral"
              : daysUntilExpiry < 0
                ? "danger"
                : daysUntilExpiry <= 30
                  ? "warn"
                  : "ok"
          }
          hint={compliance ? compliance.insuranceProvider : "No policy on file"}
        />
        <Stat
          label="Cargo coverage"
          value={
            compliance ? (
              <span className="tnum">{money(compliance.cargoInsuranceCents)}</span>
            ) : (
              "—"
            )
          }
          hint="Compared to each load's declared value"
        />
      </div>

      <div className="mt-4">
        <ConsequenceBanner
          state={state}
          days={daysUntilExpiry}
          blockedLoads={blockedLoads}
          liveLoads={liveLoads}
          loads={loads}
          audience="BROKER"
          carrierName={org.name}
        />
      </div>

      <div className="mt-4">
        <ComplianceForm
          orgId={org.id}
          initial={compliance}
          canEdit={canEdit}
          lockedReason={`You can read ${org.name}'s record — every broker staffer can, because vetting a carrier is not a privilege. Editing it requires the “Manage compliance records” permission, which your roles do not include.`}
          loadHrefBase="/broker/loads"
        />
      </div>

      {compliance ? (
        <Card className="mt-3 px-4 py-2.5">
          <p className="text-[12px] text-ink-3">
            Last updated {dateTime(compliance.updatedAt)}
            {view.updatedByName ? ` by ${view.updatedByName}` : ""} · policy{" "}
            <span className="tnum">{compliance.insurancePolicyNumber}</span> ·{" "}
            {compliance.insuranceProvider} · auto liability{" "}
            <span className="tnum">{money(compliance.autoLiabilityCents)}</span>
            {compliance.notes ? ` · ${compliance.notes}` : ""}
          </p>
        </Card>
      ) : null}

      <div className="mt-4">
        <CarrierLoads
          loads={loads}
          hrefBase="/broker/loads"
          title={`${org.name} — loads with your brokerage`}
          emptyHint="You have never tendered a load to this carrier. Their record is clean paperwork with nothing riding on it."
        />
      </div>
    </>
  );
}
