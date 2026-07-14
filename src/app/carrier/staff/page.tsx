import { redirect } from "next/navigation";
import { NoPermission } from "@/components/rbac/no-permission";
import { RbacConsole } from "@/components/rbac/rbac-console";
import { getSession } from "@/lib/auth/session";
import { authorize, can } from "@/lib/authz/guard";

export const metadata = { title: "Staff & roles · LoadFlow" };

/**
 * The same console a broker gets — no branching on org type anywhere in this module.
 * A carrier admin is offered `pod.upload` and `load.accept_decline` and is never even
 * shown `load.create`, because /api/permissions derives the catalog from the SESSION's
 * org type. The UI could not render a permission it was never handed, and the API
 * would 422 it back even if the UI tried.
 *
 * Permission re-checked server-side: dispatch@ironline.com holds accept/decline only,
 * and gets the denial state, not the data.
 */
export default async function CarrierStaffPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!can(session, "staff.manage")) {
    await authorize(session, "staff.manage").catch(() => {});
    return <NoPermission session={session} permission="staff.manage" home="/carrier" />;
  }

  return <RbacConsole orgName={session.orgName} />;
}
