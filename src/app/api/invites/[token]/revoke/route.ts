import { NextResponse, type NextRequest } from "next/server";
import { Conflict, handler, NotFound } from "@/lib/api/http";
import { audit, requestMeta } from "@/lib/audit/log";
import { authorize, requireSession } from "@/lib/authz/guard";
import { prisma } from "@/lib/db";

/**
 * POST /api/invites/[token]/revoke — `staff.manage`, and the invite must be in the
 * caller's org.
 *
 * The org filter is ANDed into the lookup itself, so another org's invite is simply
 * NOT FOUND — a 404, never a 403. Answering "403, that invite isn't yours" would
 * confirm the token is real to anyone holding `staff.manage` anywhere.
 */
export const POST = handler(
  async (req: NextRequest, ctx: { params: Promise<{ token: string }> }) => {
    const { token } = await ctx.params; // ← Promise in Next 16
    const meta = requestMeta(req);

    const session = await requireSession();
    await authorize(session, "staff.manage", meta, { entityType: "Invite" });

    const invite = await prisma.invite.findFirst({
      where: { token, orgId: session.orgId }, // ← scope filter, from the session
      include: { roles: { include: { role: true } } },
    });

    if (!invite) throw NotFound("Invitation");
    if (invite.acceptedAt) throw Conflict("That invitation has already been accepted.");
    if (invite.revokedAt) throw Conflict("That invitation has already been revoked.");

    const revoked = await prisma.invite.update({
      where: { id: invite.id },
      data: { revokedAt: new Date() },
    });

    await audit({
      actor: session,
      action: "INVITE_REVOKED",
      entityType: "Invite",
      entityId: invite.id,
      summary: `${session.name} revoked the invitation for ${invite.email} to ${session.orgName}.`,
      detail: {
        email: invite.email,
        roles: invite.roles.map((r) => r.role.name),
      },
      meta,
    });

    return NextResponse.json({
      invite: {
        id: revoked.id,
        email: revoked.email,
        name: revoked.name,
        revokedAt: revoked.revokedAt,
      },
    });
  },
);
