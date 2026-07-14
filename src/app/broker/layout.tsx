import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { getSession, homePathFor } from "@/lib/auth/session";

/**
 * Org-type gate for every page in this section. An account of the wrong type that
 * types this URL straight into the address bar is bounced to its own home — it never
 * renders another org's data. This is a convenience layer, not the control: the API
 * behind every page on it enforces the same rule independently.
 */
export default async function BrokerLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.orgType !== "BROKER") redirect(homePathFor(session.orgType));

  return <AppShell session={session}>{children}</AppShell>;
}
