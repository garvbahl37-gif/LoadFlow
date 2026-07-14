import { redirect } from "next/navigation";
import { AuditView } from "@/components/audit/audit-view";
import { getSession } from "@/lib/auth/session";

export const metadata = { title: "Audit log · LoadFlow" };

/**
 * Broker audit log. The `audit.view` gate is enforced by `GET /api/audit`, which this
 * page is a client of — a broker without the permission gets a 403 and a DENIED row,
 * and sees the permission-denied state. Nothing here reads the database directly.
 */
export default async function BrokerAuditPage({
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
      basePath="/broker/audit"
      loadHrefBase="/broker/loads"
      searchParams={sp}
    />
  );
}
