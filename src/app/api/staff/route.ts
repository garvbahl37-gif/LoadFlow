import { NextResponse, type NextRequest } from "next/server";
import { handler } from "@/lib/api/http";
import { requestMeta } from "@/lib/audit/log";
import { authorize, requireSession } from "@/lib/authz/guard";
import { listStaff } from "@/lib/rbac/service";

/**
 * GET /api/staff — this org's people, their roles, and the union of permissions those
 * roles actually resolve to. Scoped to session.orgId: one org can never enumerate
 * another's staff.
 */
export const GET = handler(async (req: NextRequest) => {
  const meta = requestMeta(req);
  const session = await requireSession();
  await authorize(session, "staff.manage", meta, { entityType: "User" });

  const staff = await listStaff(session);
  return NextResponse.json({ staff });
});
