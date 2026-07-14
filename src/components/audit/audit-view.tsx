import Link from "next/link";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import type { SessionUser } from "@/lib/auth/session";
import { AuditFilters } from "@/components/audit/audit-filters";
import { AuditTable } from "@/components/audit/audit-table";
import { AuditPermissionDenied } from "@/components/audit/permission-denied";
import { fetchAudit } from "@/components/audit/fetch-audit";
import {
  AUDIT_MAX_LIMIT,
  AUDIT_PAGE_SIZE,
  auditQueryToParams,
  hasActiveFilters,
  parseAuditQuery,
} from "@/components/audit/types";

/**
 * The audit log viewer, shared by the broker and carrier sections. Both are gated on
 * `audit.view`, and the gate is the API's — this component never touches the database.
 */
export async function AuditView({
  session,
  basePath,
  loadHrefBase,
  searchParams,
}: {
  session: SessionUser;
  /** "/broker/audit" | "/carrier/audit" — filters rewrite this URL. */
  basePath: string;
  /** "/broker/loads" | "/carrier/loads" — where a load reference links to. */
  loadHrefBase: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const query = parseAuditQuery(searchParams);
  const result = await fetchAudit(query);

  // 403 → the API already recorded the attempt. 401 is impossible (the layout
  // redirects), so anything else non-OK is a genuine failure worth showing.
  if (!result.ok) {
    if (result.status === 403) {
      return <AuditPermissionDenied session={session} error={result.error} />;
    }
    return (
      <>
        <PageHeader title="Audit log" />
        <Card className="border-danger/40 bg-danger-soft px-5 py-4 text-[13px] text-danger">
          Could not load the audit trail — {result.error}
        </Card>
      </>
    );
  }

  const { entries, facets, nextCursor } = result.data;
  const filtered = hasActiveFilters(query);

  const moreParams = auditQueryToParams({
    ...query,
    limit: Math.min(query.limit + AUDIT_PAGE_SIZE, AUDIT_MAX_LIMIT),
  });
  const canLoadMore = Boolean(nextCursor) && query.limit < AUDIT_MAX_LIMIT;

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle={`Every business event and every denied access attempt at ${session.orgName}, newest first.`}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Events recorded"
          value={facets.total.toLocaleString("en-US")}
          hint={filtered ? "Matching the current search" : "In this organization"}
        />
        <Stat
          label="Denied attempts"
          value={facets.deniedCount.toLocaleString("en-US")}
          tone={facets.deniedCount > 0 ? "danger" : "neutral"}
          hint="Blocked server-side, and recorded"
        />
        <Stat
          label="Allowed actions"
          value={facets.allowedCount.toLocaleString("en-US")}
          tone="ok"
          hint="Completed business events"
        />
        <Stat
          label="Distinct actions"
          value={facets.actions.length.toLocaleString("en-US")}
          hint="Event types in this trail"
        />
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title="Trail"
          subtitle={
            <>
              Showing{" "}
              <span className="tnum font-medium text-ink-2">{entries.length}</span> of{" "}
              <span className="tnum font-medium text-ink-2">{facets.total}</span> matching entries.
              Click any row to expand its recorded detail. The actor&apos;s name and email are{" "}
              <strong className="font-medium text-ink-2">denormalized onto every row</strong>, so
              the trail stays attributable even if the user is later deleted.
            </>
          }
        />

        <div className="border-b border-line px-5 py-3">
          <AuditFilters basePath={basePath} query={query} facets={facets} />
        </div>

        <AuditTable entries={entries} loadHrefBase={loadHrefBase} filtered={filtered} />

        {canLoadMore ? (
          <div className="flex items-center justify-center border-t border-line px-5 py-3">
            <Link
              href={`${basePath}?${moreParams.toString()}`}
              scroll={false}
              className="inline-flex h-8 items-center rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-surface-2"
            >
              Load {AUDIT_PAGE_SIZE} more
            </Link>
          </div>
        ) : entries.length > 0 ? (
          <p className="border-t border-line px-5 py-2.5 text-center text-[12px] text-ink-3">
            End of the trail{query.limit >= AUDIT_MAX_LIMIT ? ` — capped at ${AUDIT_MAX_LIMIT} rows` : ""}.
          </p>
        ) : null}
      </Card>
    </>
  );
}
