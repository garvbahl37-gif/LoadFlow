import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, handler, parseBody } from "@/lib/api/http";
import { audit, requestMeta } from "@/lib/audit/log";
import { verifyPassword } from "@/lib/auth/password";
import { homePathFor, startSession, type SessionUser } from "@/lib/auth/session";
import { isPermissionKey, type PermissionKey } from "@/lib/authz/permissions";
import { prisma } from "@/lib/db";

/**
 * POST /api/auth/login — { email, password } → { user, home }, sets the session cookie.
 *
 * A failed login NEVER reveals which half of the credential was wrong: a bad email and
 * a bad password produce the byte-identical 401. A DISABLED user is also a 401 (not a
 * 403) — they are not authenticated at all — but with a distinct message, because that
 * is a fact about their own account and telling them saves a support ticket.
 *
 * Both outcomes are audited. A failed attempt has no actor (there is no authenticated
 * identity), so the attempted email is preserved in `summary`/`detail` instead — a
 * password-spray against one org is exactly the pattern an ops team needs to see.
 */

const bodySchema = z.object({
  email: z.email({ error: "Enter a valid email address." }),
  password: z.string().min(1, { error: "Enter your password." }).max(200),
});

const BAD_CREDENTIALS = "Incorrect email or password.";
const DISABLED_ACCOUNT =
  "This account has been disabled. Contact an administrator at your organization.";

export const POST = handler(async (req: NextRequest) => {
  const meta = requestMeta(req);
  const body = await parseBody(req, bodySchema);
  const email = body.email.toLowerCase().trim();

  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      org: true,
      roles: { include: { role: { include: { permissions: true } } } },
    },
  });

  const passwordOk = user ? await verifyPassword(body.password, user.passwordHash) : false;

  if (!user || !passwordOk) {
    await audit({
      actor: null,
      action: "LOGIN_FAILED",
      entityType: "User",
      entityId: user?.id ?? null,
      outcome: "DENIED",
      summary: `Failed sign-in attempt for ${email}.`,
      detail: { email, reason: user ? "bad_password" : "unknown_email" },
      meta,
    });
    // Identical response either way — the detail above is for the audit trail, not the client.
    throw new ApiError(401, BAD_CREDENTIALS);
  }

  if (user.status !== "ACTIVE") {
    await audit({
      actor: null,
      action: "LOGIN_FAILED",
      entityType: "User",
      entityId: user.id,
      outcome: "DENIED",
      summary: `Failed sign-in attempt for ${email}: the account is disabled.`,
      detail: { email, reason: "disabled" },
      meta,
    });
    throw new ApiError(401, DISABLED_ACCOUNT);
  }

  const sessionId = await startSession(user.id, {
    ip: meta.ip,
    userAgent: req.headers.get("user-agent"),
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

  await audit({
    actor: sessionUser,
    action: "LOGIN",
    entityType: "User",
    entityId: user.id,
    summary: `${user.name} (${user.email}) signed in to ${user.org.name}.`,
    detail: { orgType: user.org.type, roles: sessionUser.roles.map((r) => r.name) },
    meta,
  });

  return NextResponse.json({ user: sessionUser, home: homePathFor(user.org.type) });
});
