import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handler, parseBody } from "@/lib/api/http";
import { requestMeta } from "@/lib/audit/log";
import { acceptInvite } from "@/lib/auth/bootstrap";
import { homePathFor, startSession, type SessionUser } from "@/lib/auth/session";
import { isPermissionKey, type PermissionKey } from "@/lib/authz/permissions";
import { prisma } from "@/lib/db";

const bodySchema = z.object({
  password: z.string().min(8, { error: "Use at least 8 characters." }).max(200),
});

/**
 * POST /api/invites/[token]/accept — public: the invitee has no account yet.
 *
 * The token IS the authorization. Everything that defines the new user — their email,
 * their org, their roles — is read off the invite row, never off the request body: you
 * cannot accept an invite into a different org, under a different address, or with a
 * role you were not granted, because none of those are inputs. The only thing the
 * invitee supplies is a password.
 *
 * `acceptInvite` enforces the rest: unknown/revoked → 404, already used → 409,
 * expired → 409, and it marks the invite consumed inside the same transaction that
 * creates the user, so a token is single-use.
 */
export const POST = handler(
  async (req: NextRequest, ctx: { params: Promise<{ token: string }> }) => {
    const { token } = await ctx.params; // ← Promise in Next 16
    const meta = requestMeta(req);
    const body = await parseBody(req, bodySchema);

    const created = await acceptInvite({ token, password: body.password }, meta);

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
  },
);
