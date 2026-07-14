import { redirect } from "next/navigation";
import { NoPermission } from "@/components/rbac/no-permission";
import { RbacConsole } from "@/components/rbac/rbac-console";
import { getSession } from "@/lib/auth/session";
import { authorize, can } from "@/lib/authz/guard";

export const metadata = { title: "Staff & roles · LoadFlow" };

/**
 * The RBAC console for a broker org.
 *
 * The nav hides this link for anyone without `staff.manage`, but that is decoration:
 * dispatch@meridian.com can type the URL. So the permission is re-checked HERE, on the
 * server, before a single row of staff data is rendered — and `authorize()` writes the
 * DENIED audit row, which is exactly the "log permission-denied attempts" requirement.
 *
 * The console itself is org-type agnostic; the catalog it renders comes from
 * /api/permissions, which filters by the caller's org type server-side.
 */
export default async function BrokerStaffPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!can(session, "staff.manage")) {
    // Records the denial in the audit trail, then swallows the 403 so we can render a
    // clean, honest denial state instead of an error page.
    await authorize(session, "staff.manage").catch(() => {});
    return <NoPermission session={session} permission="staff.manage" home="/broker" />;
  }

  return <RbacConsole orgName={session.orgName} />;
}
