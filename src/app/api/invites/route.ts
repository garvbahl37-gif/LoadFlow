import { NextResponse, type NextRequest } from "next/server";
import { handler, parseBody } from "@/lib/api/http";
import { requestMeta } from "@/lib/audit/log";
import { createInvite, inviteSchema } from "@/lib/auth/bootstrap";
import { authorize, requireSession } from "@/lib/authz/guard";
import { prisma } from "@/lib/db";

/** There is no mail server in a hackathon: the admin copies this link and sends it. */
function acceptUrlFor(req: NextRequest, token: string): string {
  return new URL(`/invite/${token}`, new URL(req.url).origin).toString();
}

type InviteRow = {
  id: string;
  email: string;
  name: string;
  token: string;
  createdAt: Date;
  expiresAt: Date;
  roles: { role: { id: string; name: string; isSystem: boolean } }[];
  invitedBy?: { name: string; email: string } | null;
};

function serialize(req: NextRequest, invite: InviteRow) {
  return {
    id: invite.id,
    email: invite.email,
    name: invite.name,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    token: invite.token,
    acceptUrl: acceptUrlFor(req, invite.token),
    roles: invite.roles.map((r) => ({
      id: r.role.id,
      name: r.role.name,
      isSystem: r.role.isSystem,
    })),
    invitedBy: invite.invitedBy
      ? { name: invite.invitedBy.name, email: invite.invitedBy.email }
      : null,
  };
}

/**
 * GET /api/invites — PENDING invites for the caller's org only.
 * Pending = not accepted, not revoked, not expired. Scoped by `session.orgId`, which
 * comes from the session and never from the client.
 */
export const GET = handler(async (req: NextRequest) => {
  const meta = requestMeta(req);
  const session = await requireSession();
  await authorize(session, "staff.manage", meta, { entityType: "Invite" });

  const invites = await prisma.invite.findMany({
    where: {
      orgId: session.orgId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      roles: { include: { role: true } },
      invitedBy: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ invites: invites.map((i) => serialize(req, i)) });
});

/**
 * POST /api/invites — `staff.manage`. Staff cannot self-signup; this is the only door.
 *
 * The org id and the inviter id come from the SESSION. `createInvite` re-checks that
 * every roleId belongs to that org (422 otherwise), so an admin cannot mint an invite
 * carrying another org's role — even by posting its id directly at this endpoint.
 */
export const POST = handler(async (req: NextRequest) => {
  const meta = requestMeta(req);
  const session = await requireSession();
  await authorize(session, "staff.manage", meta, { entityType: "Invite" });

  const input = await parseBody(req, inviteSchema);

  const invite = await createInvite(
    {
      userId: session.userId,
      orgId: session.orgId, // ← from the session. Never from the body.
      email: session.email,
      name: session.name,
      orgName: session.orgName,
    },
    input,
    meta,
  );

  const payload = serialize(req, invite);

  return NextResponse.json({ invite: payload, acceptUrl: payload.acceptUrl }, { status: 201 });
});
