import { NextResponse } from "next/server";
import { handler, NotFound } from "@/lib/api/http";
import { previewInvite } from "@/lib/auth/bootstrap";

/**
 * GET /api/invites/[token] — public, unauthenticated: the invitee has no account yet.
 *
 * `previewInvite` returns a deliberately thin summary (who it is for, which org, which
 * role names, and whether it is still usable). No ids, no permission keys, no org
 * internals — a guessed token must not become a reconnaissance tool. An unknown token
 * is a 404; an expired/used/revoked one still resolves, because the accept page has to
 * be able to say *why* it cannot be used.
 */
export const GET = handler(async (_req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params; // ← Promise in Next 16

  const invite = await previewInvite(token);
  if (!invite) throw NotFound("Invitation");

  // Returned both nested and flat: the accept page reads `invite`, and the flat copy
  // keeps a plain `res.json().orgName` style read working too.
  return NextResponse.json({ invite, ...invite });
});
