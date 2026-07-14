import Link from "next/link";
import { Button, Card, PageHeader } from "@/components/ui";
import type { SessionUser } from "@/lib/auth/session";

/**
 * The honest denial screen. The nav already hides this link for anyone without
 * `staff.manage` — but hiding a link is a courtesy, never a control, and a user can
 * always type the URL. So the page re-checks the permission server-side and renders
 * this instead of the console: no staff list, no roles, no invites, no data at all.
 *
 * (The API behind the console enforces the same rule a third time, independently: even
 * a hand-rolled `curl` at /api/staff gets a 403 and a DENIED audit row.)
 */
export function NoPermission({
  session,
  permission,
  home,
}: {
  session: SessionUser;
  permission: string;
  home: string;
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Staff & roles"
        subtitle="This area is restricted to people who can manage staff."
      />

      <Card className="px-6 py-7">
        <div className="flex items-start gap-4">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-ink-3">
            <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden>
              <path d="M4 6.5V5a4 4 0 1 1 8 0v1.5h.5A1.5 1.5 0 0 1 14 8v5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13V8a1.5 1.5 0 0 1 1.5-1.5H4Zm1.5 0h5V5a2.5 2.5 0 0 0-5 0v1.5Z" />
            </svg>
          </span>

          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink">
              You do not have permission to manage staff and roles
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
              This page requires the{" "}
              <code className="rounded-xs bg-surface-2 px-1 font-mono text-[12px] text-ink">
                {permission}
              </code>{" "}
              permission. Your {session.roles.length === 1 ? "role" : "roles"} (
              {session.roles.length > 0
                ? session.roles.map((r) => r.name).join(", ")
                : "none assigned"}
              ){" "}
              {session.roles.length > 0 ? "do not include it" : "grant nothing"}. Ask an
              administrator at {session.orgName} to add it to one of your roles — it takes effect on
              your next request.
            </p>

            <div className="mt-4 rounded-lg border border-line bg-surface-2 px-3.5 py-2.5">
              <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
                Permissions you currently hold
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {session.permissions.length === 0 ? (
                  <span className="text-[12px] text-ink-3">
                    None — your account is read-only.
                  </span>
                ) : (
                  session.permissions.map((p) => (
                    <span
                      key={p}
                      className="rounded-md border border-line-strong bg-surface px-1.5 py-0.5 font-mono text-[11px] text-ink-2"
                    >
                      {p}
                    </span>
                  ))
                )}
              </div>
            </div>

            <p className="mt-4 text-[12px] text-ink-3">
              Nothing was loaded for this page. The check runs on the server, and the API behind it
              would refuse the same request independently — this attempt is in the audit log.
            </p>

            <div className="mt-5">
              <Link href={home}>
                <Button variant="secondary">Back to safety</Button>
              </Link>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
