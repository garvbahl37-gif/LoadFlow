import { cookies } from "next/headers";
import type { OrgType } from "@/generated/prisma/enums";
import { generateToken } from "@/lib/auth/password";
import type { PermissionKey } from "@/lib/authz/permissions";
import { isPermissionKey } from "@/lib/authz/permissions";
import { prisma } from "@/lib/db";

export const SESSION_COOKIE = "lf_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export type SessionRole = { id: string; name: string; isSystem: boolean };

/** Everything authorization needs, resolved fresh from the DB on every request. */
export type SessionUser = {
  sessionId: string;
  userId: string;
  email: string;
  name: string;
  orgId: string;
  orgName: string;
  orgType: OrgType;
  roles: SessionRole[];
  /** Union of every permission across every role the user holds. */
  permissions: PermissionKey[];
};

/**
 * Sessions are DB-backed rather than a stateless JWT: when an admin edits a role
 * or disables a user, it must take effect on the *next request* — not whenever a
 * token happens to expire. That guarantee is the whole point of an RBAC system.
 */
export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies(); // Next 16: cookies() is async
  const sid = jar.get(SESSION_COOKIE)?.value;
  if (!sid) return null;

  const session = await prisma.session.findUnique({
    where: { id: sid },
    include: {
      user: {
        include: {
          org: true,
          roles: { include: { role: { include: { permissions: true } } } },
        },
      },
    },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: sid } }).catch(() => {});
    return null;
  }

  const { user } = session;
  // A disabled user's existing session is dead on arrival.
  if (user.status !== "ACTIVE") return null;

  const permissions = new Set<PermissionKey>();
  for (const ur of user.roles) {
    for (const rp of ur.role.permissions) {
      if (isPermissionKey(rp.permissionKey)) permissions.add(rp.permissionKey);
    }
  }

  return {
    sessionId: session.id,
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
    permissions: [...permissions],
  };
}

/** Only legal inside a Server Action or a Route Handler (Next 16 rule). */
export async function startSession(
  userId: string,
  meta?: { ip?: string | null; userAgent?: string | null },
): Promise<string> {
  const id = generateToken(32);
  await prisma.session.create({
    data: {
      id,
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      ip: meta?.ip ?? null,
      userAgent: meta?.userAgent ?? null,
    },
  });
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return id;
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value;
  if (sid) {
    await prisma.session.delete({ where: { id: sid } }).catch(() => {});
  }
  jar.delete(SESSION_COOKIE);
}

/** Where a signed-in user's home is. */
export function homePathFor(orgType: OrgType): string {
  switch (orgType) {
    case "BROKER":
      return "/broker";
    case "CARRIER":
      return "/carrier";
    case "SHIPPER":
      return "/shipper";
  }
}
