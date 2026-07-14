import { NextResponse, type NextRequest } from "next/server";
import { handler, parseBody } from "@/lib/api/http";
import { requestMeta } from "@/lib/audit/log";
import { authorize, requireSession } from "@/lib/authz/guard";
import { createRole, listRoles, roleCreateSchema } from "@/lib/rbac/service";

/** GET /api/roles — this org's roles, their permissions, and how many people hold them. */
export const GET = handler(async (req: NextRequest) => {
  const meta = requestMeta(req);
  const session = await requireSession();
  await authorize(session, "staff.manage", meta, { entityType: "Role" });

  const roles = await listRoles(session);
  return NextResponse.json({ roles });
});

/**
 * POST /api/roles — author a new role from the catalog.
 *
 * The permission list is re-validated against the caller's ORG TYPE server-side (422
 * on anything that does not apply), and the org is taken from the session, never the
 * body. Duplicate names 409 against the @@unique([orgId, name]) constraint.
 */
export const POST = handler(async (req: NextRequest) => {
  const meta = requestMeta(req);
  const session = await requireSession();
  await authorize(session, "staff.manage", meta, { entityType: "Role" });

  const body = await parseBody(req, roleCreateSchema);
  const role = await createRole(session, body, meta);

  return NextResponse.json({ role }, { status: 201 });
});
