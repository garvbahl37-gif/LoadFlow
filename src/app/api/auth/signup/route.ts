import { NextResponse, type NextRequest } from "next/server";
import { handler, parseBody } from "@/lib/api/http";
import { requestMeta } from "@/lib/audit/log";
import { signupSchema, signupOrg } from "@/lib/auth/bootstrap";
import { homePathFor, startSession, type SessionUser } from "@/lib/auth/session";
import { isPermissionKey, type PermissionKey } from "@/lib/authz/permissions";
import { prisma } from "@/lib/db";

/**
 * POST /api/auth/signup — public. The ONLY way an org is born.
 *
 * `signupOrg` creates the Org, its founding administrator, and (for BROKER/CARRIER)
 * the system admin role holding every permission that org type may hold, in one
 * transaction — and writes the ORG_CREATED audit row. We then sign the founder in and
 * hand back `home` so the client can redirect to the right console.
 *
 * Note what is NOT here: nothing from the body decides permissions or org id. Staff
 * cannot self-signup into an existing org — that path is invite-only.
 */
export const POST = handler(async (req: NextRequest) => {
  const meta = requestMeta(req);
  const input = await parseBody(req, signupSchema); // 422 on validation, 409 on dup email

  const created = await signupOrg(input, meta);

  const sessionId = await startSession(created.id, {
    ip: meta.ip,
    userAgent: req.headers.get("user-agent"),
  });

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: created.id },
    include: {
      org: true,
      roles: { include: { role: { include: { permissions: true } } } },
    },
  });

  const permissions = [
    ...new Set(
      user.roles
        .flatMap((ur) => ur.role.permissions.map((rp) => rp.permissionKey))
        .filter((key): key is PermissionKey => isPermissionKey(key)),
    ),
  ];

  const sessionUser: SessionUser = {
    sessionId,
    userId: user.id,
    email: user.email,
    name: user.name,
    orgId: user.orgId,
    orgName: user.org.name,
    orgType: user.org.type,
    roles: user.roles.map((ur) => ({
      id: ur.role.id,
      name: ur.role.name,
      isSystem: ur.role.isSystem,
    })),
    permissions,
  };

  return NextResponse.json(
    { user: sessionUser, home: homePathFor(user.org.type) },
    { status: 201 },
  );
});
