import { redirect } from "next/navigation";
import { CarrierLoads } from "@/components/compliance/carrier-loads";
import { ComplianceForm } from "@/components/compliance/compliance-form";
import { ConsequenceBanner } from "@/components/compliance/consequence-banner";
import { carrierComplianceView } from "@/components/compliance/data";
import { AuthorityBadge, ComplianceStateBadge } from "@/components/compliance/state-badge";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui";
import { getSession, homePathFor } from "@/lib/auth/session";
import { can } from "@/lib/authz/guard";
import { dateTime, money } from "@/lib/format";

/**
 * The same compliance record, from the other side of the deal — the carrier's own.
 *
 * Scope, not a hidden button, is what keeps a carrier here: `carrierComplianceView` is
 * called with the org id from the SESSION, and the API behind the form 404s a carrier
 * that points a PUT at anyone else's org id. `compliance.manage` decides whether the
 * form is editable; a carrier dispatcher or driver reads it and is told exactly why.
 */
export default async function CarrierCompliancePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.orgType !== "CARRIER") redirect(homePathFor(session.orgType));

  // The org id comes from the session. It is never accepted from the URL or the client.
  const view = await carrierComplianceView(session, session.orgId);

  if (!view) {
    return (
      <>
        <PageHeader title="Compliance" />
        <Card>
          <EmptyState
            title="Your organization record could not be loaded"
            hint="Sign out and back in. If this persists, your org may have been removed."
          />
        </Card>
      </>
    );
  }

  const { org, compliance, state, daysUntilExpiry, liveLoads, blockedLoads, loads } = view;
  const canEdit = can(session, "compliance.manage");

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            Compliance
            <ComplianceStateBadge state={state} />
            <AuthorityBadge status={compliance?.authorityStatus ?? null} />
          </span>
        }
        subtitle={
          <>
            This is the record every broker checks before tendering you a load — and the
            record the compliance gate reads before letting one dispatch.{" "}
            <span className="tnum">
              MC {org.mcNumber ?? "—"} · DOT {org.dotNumber ?? "—"}
            </span>
          </>
        }
      />

      {/* The consequence, first thing on the page, in plain English. */}
      <ConsequenceBanner
        state={state}
        days={daysUntilExpiry}
        blockedLoads={blockedLoads}
        liveLoads={liveLoads}
        loads={loads}
        audience="CARRIER"
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Live loads"
          value={<span className="tnum">{liveLoads}</span>}
          hint="Tendered to you and not yet closed"
        />
        <Stat
          label="Blocked right now"
          value={<span className="tnum">{blockedLoads}</span>}
          tone={blockedLoads > 0 ? "danger" : "ok"}
          hint={
            blockedLoads > 0
              ? "Cannot be dispatched until this record is fixed"
              : "Nothing is being held"
          }
        />
        <Stat
          label="Insurance"
          value={
            daysUntilExpiry === null ? (
              "Not filed"
            ) : daysUntilExpiry < 0 ? (
              <span className="tnum">{Math.abs(daysUntilExpiry)}d lapsed</span>
            ) : (
              <span className="tnum">{daysUntilExpiry}d left</span>
            )
          }
          tone={
            daysUntilExpiry === null
              ? "danger"
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
          hint="A load worth more than this is flagged"
        />
      </div>

      <div className="mt-4">
        <ComplianceForm
          orgId={org.id}
          initial={compliance}
          canEdit={canEdit}
          lockedReason="You can see your organization's compliance record, but editing it requires the “Manage compliance records” permission — which your roles do not include. Ask your organization administrator to grant it, or to make the change for you."
          loadHrefBase="/carrier/loads"
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
          hrefBase="/carrier/loads"
          title="What is riding on this record"
          emptyHint="No broker has tendered you a load yet. Keeping this record current is how you stay eligible for the ones that come."
        />
      </div>
    </>
  );
}
