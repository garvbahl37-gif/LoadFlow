import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LoadForm } from "@/components/loads/load-form";
import { Button, Card, PageHeader } from "@/components/ui";
import { getSession } from "@/lib/auth/session";
import { can, loadScope } from "@/lib/authz/guard";
import { prisma } from "@/lib/db";
import { STATUS_LABEL } from "@/lib/loads/state-machine";

/**
 * Edit a load. Mirrors the create page's guards: `load.create` is checked here as a
 * courtesy, but PATCH /api/loads/[id] re-checks it, re-applies the scope filter, refuses
 * edits once the load is past Carrier Assigned, and re-runs the compliance evaluator when
 * equipment/commodity/declared value change — none of which this page is trusted to do.
 */
const EDITABLE = ["POSTED", "CARRIER_ASSIGNED"];

export default async function EditLoadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.orgType !== "BROKER") redirect("/");

  if (!can(session, "load.create")) {
    return (
      <>
        <PageHeader title="Edit load" subtitle="Permission required" />
        <Card className="px-5 py-6">
          <p className="text-sm font-medium text-ink">
            You do not hold the{" "}
            <code className="rounded-xs bg-surface-2 px-1 font-mono text-[12px]">load.create</code>{" "}
            permission, which is required to edit a load.
          </p>
          <div className="mt-4">
            <Link href={`/broker/loads/${id}`}>
              <Button variant="secondary">Back to the load</Button>
            </Link>
          </div>
        </Card>
      </>
    );
  }

  // Scope filter ANDed in — a broker can only reach a load it brokered.
  const load = await prisma.load.findFirst({
    where: { AND: [{ id }, loadScope(session)] },
  });
  if (!load) notFound();

  if (!EDITABLE.includes(load.status)) {
    return (
      <>
        <PageHeader title={`Edit ${load.reference}`} subtitle="This load can no longer be edited" />
        <Card className="px-5 py-6">
          <p className="text-sm text-ink-2">
            Load {load.reference} is {STATUS_LABEL[load.status]}. A load is editable only while it is
            Posted or Carrier Assigned — once a rate is confirmed the agreed details are frozen.
          </p>
          <div className="mt-4">
            <Link href={`/broker/loads/${id}`}>
              <Button variant="secondary">Back to the load</Button>
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
        title={`Edit ${load.reference}`}
        subtitle="Correct the load's details. Compliance is re-checked automatically if you change what the carrier is approved for."
        action={
          <Link href={`/broker/loads/${id}`}>
            <Button variant="ghost">Back to the load</Button>
          </Link>
        }
      />
      <div className="max-w-3xl">
        <LoadForm shippers={shippers} load={load} />
      </div>
    </>
  );
}
