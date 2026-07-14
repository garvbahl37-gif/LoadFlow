import { NextResponse, type NextRequest } from "next/server";
import { handler, parseBody } from "@/lib/api/http";
import { requestMeta } from "@/lib/audit/log";
import { authorize, requireSession } from "@/lib/authz/guard";
import { staffUpdateSchema, updateStaff } from "@/lib/rbac/service";

type Ctx = { params: Promise<{ userId: string }> };

/**
 * PATCH /api/staff/[userId] — re-role or enable/disable a member of YOUR org.
 *
 *   404 if the user is not in the caller's org — never let one org touch another's people.
 *   422 if any roleId is not one of the caller's org's roles.
 *   409 if the change would leave the org with zero ACTIVE holders of `staff.manage`
 *       (including an admin demoting or disabling themselves). See assertStaffManageSurvives().
 *
 * Role changes take effect on the target's NEXT REQUEST — sessions are DB-backed and
 * permissions are recomputed per request, so nobody has to log out and back in.
 */
export const PATCH = handler(async (req: NextRequest, ctx: Ctx) => {
  const { userId } = await ctx.params;
  const meta = requestMeta(req);
  const session = await requireSession();
  await authorize(session, "staff.manage", meta, { entityType: "User", entityId: userId });

  const body = await parseBody(req, staffUpdateSchema);
  const member = await updateStaff(session, userId, body, meta);

  return NextResponse.json({ member });
});
