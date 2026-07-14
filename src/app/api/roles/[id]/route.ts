import { NextResponse, type NextRequest } from "next/server";
import { handler, parseBody } from "@/lib/api/http";
import { requestMeta } from "@/lib/audit/log";
import { authorize, requireSession } from "@/lib/authz/guard";
import { deleteRole, roleUpdateSchema, updateRole } from "@/lib/rbac/service";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/roles/[id] — rename and/or re-bundle permissions.
 *
 * 409 if the role isSystem (the administrator role is immutable). 404 if it belongs
 * to another org. The audit row carries the added/removed permission diff — the
 * single most important thing an auditor will ever ask this system for.
 */
export const PATCH = handler(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const meta = requestMeta(req);
  const session = await requireSession();
  await authorize(session, "staff.manage", meta, { entityType: "Role", entityId: id });

  const body = await parseBody(req, roleUpdateSchema);
  const role = await updateRole(session, id, body, meta);

  return NextResponse.json({ role });
});

/** DELETE /api/roles/[id] — 409 if isSystem or if anyone still holds it. */
export const DELETE = handler(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const meta = requestMeta(req);
  const session = await requireSession();
  await authorize(session, "staff.manage", meta, { entityType: "Role", entityId: id });

  const deleted = await deleteRole(session, id, meta);

  return NextResponse.json({ deleted });
});
