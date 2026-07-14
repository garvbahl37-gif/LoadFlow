import Link from "next/link";
import { redirect } from "next/navigation";
import { LoadForm } from "@/components/loads/load-form";
import { Button, Card, PageHeader } from "@/components/ui";
import { getSession } from "@/lib/auth/session";
import { can } from "@/lib/authz/guard";
import { prisma } from "@/lib/db";

/**
 * Post a load.
 *
 * The page checks `load.create` before rendering the form — but that is a courtesy.
 * POST /api/loads re-checks the same permission, derives brokerOrgId and createdById
 * from the session, and writes a DENIED audit row if the caller does not hold it. A
 * user without the permission who curls the endpoint gets a 403, not a load.
 */
export default async function NewLoadPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!can(session, "load.create")) {
    return (
      <>
        <PageHeader title="Post a load" subtitle="Permission required" />
        <Card className="px-5 py-6">
          <p className="text-sm font-medium text-ink">
            You do not hold the{" "}
            <code className="rounded-xs bg-surface-2 px-1 font-mono text-[12px]">
              load.create
            </code>{" "}
            permission.
          </p>
          <p className="mt-1 text-[13px] text-ink-2">
            Your roles ({session.roles.map((r) => r.name).join(", ") || "none"}) do not include
            it. An administrator at {session.orgName} can grant it from Staff &amp; roles. The
            API enforces this independently — this page is not the lock.
          </p>
          <div className="mt-4">
            <Link href="/broker">
              <Button variant="secondary">Back to the board</Button>
            </Link>
          </div>
        </Card>
      </>
    );
  }

  const shippers = await prisma.org.findMany({
    where: { type: "SHIPPER" },
    select: { id: true, name: true, city: true, state: true },
    orderBy: { name: "asc" },
  });

  return (
    <>
      <PageHeader
        title="Post a load"
        subtitle="The reference is generated server-side; the broker on the load is your organization."
        action={
          <Link href="/broker">
            <Button variant="ghost">Back to the board</Button>
          </Link>
        }
      />
      <div className="max-w-3xl">
        <LoadForm shippers={shippers} />
      </div>
    </>
  );
}
