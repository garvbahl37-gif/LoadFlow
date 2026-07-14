import { redirect } from "next/navigation";
import { AuditView } from "@/components/audit/audit-view";
import { getSession } from "@/lib/auth/session";

export const metadata = { title: "Audit log · LoadFlow" };

/**
 * Carrier audit log — the same viewer, the same API, the same `audit.view` gate.
 * The API scopes every row to `actorOrgId === session.orgId`, so a carrier sees its
 * own people's actions and its own denied attempts, and never the broker's.
 */
export default async function CarrierAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const sp = await searchParams; // Next 16: searchParams is a Promise

  return (
    <AuditView
      session={session}
      basePath="/carrier/audit"
      loadHrefBase="/carrier/loads"
      searchParams={sp}
    />
  );
}
