import { Card } from "@/components/ui";
import type { SessionUser } from "@/lib/auth/session";

/**
 * What a user without `audit.view` sees. Note what already happened by the time this
 * renders: the page asked `GET /api/audit`, the API answered 403, and `authorize()`
 * wrote a DENIED row into the very log this person cannot read. Their own admin can
 * see the attempt. The UI is not the control — this screen is just the courtesy.
 */
export function AuditPermissionDenied({
  session,
  error,
}: {
  session: SessionUser;
  error?: string;
}) {
  return (
    <Card className="mx-auto max-w-2xl overflow-hidden">
      <div className="flex items-start gap-4 border-b border-line bg-danger-soft px-6 py-5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-danger text-white">
          <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden>
            <path d="M4.5 6.5V5a3.5 3.5 0 1 1 7 0v1.5h.25A1.75 1.75 0 0 1 13.5 8.25v4A1.75 1.75 0 0 1 11.75 14h-7.5A1.75 1.75 0 0 1 2.5 12.25v-4A1.75 1.75 0 0 1 4.25 6.5H4.5Zm1.75 0h3.5V5a1.75 1.75 0 1 0-3.5 0v1.5Z" />
          </svg>
        </span>
        <div>
          <h1 className="text-base font-semibold text-danger">
            You do not have permission to view the audit log
          </h1>
          <p className="mt-1 text-[13px] text-ink-2">
            {error ?? 'This page requires the "audit.view" permission.'}
          </p>
        </div>
      </div>

      <div className="space-y-4 px-6 py-5 text-[13px]">
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
            Permission required
          </p>
          <p className="mt-1 inline-block rounded-md border border-danger/40 bg-danger/10 px-2 py-1 font-mono text-[12px] font-semibold text-danger">
            audit.view
          </p>
        </div>

        <div>
          <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
            Permissions you hold
          </p>
          {session.permissions.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {session.permissions.map((p) => (
                <span
                  key={p}
                  className="rounded-md border border-line-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink-2"
                >
                  {p}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-ink-3">
              None. Your roles ({session.roles.map((r) => r.name).join(", ") || "none assigned"})
              carry no permissions.
            </p>
          )}
        </div>

        <p className="rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[12px] text-ink-2">
          This was not merely hidden from you — the request reached{" "}
          <span className="font-mono">GET /api/audit</span>, was rejected server-side with a{" "}
          <span className="font-mono">403</span>, and{" "}
          <strong className="font-semibold text-ink">was written to the audit trail</strong> as a
          denied attempt. An administrator at {session.orgName} can see it. Ask them for a role
          that includes <span className="font-mono">audit.view</span>.
        </p>
      </div>
    </Card>
  );
}
