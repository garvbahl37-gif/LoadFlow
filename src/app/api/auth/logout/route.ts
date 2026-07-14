import { NextResponse, type NextRequest } from "next/server";
import { handler } from "@/lib/api/http";
import { audit, requestMeta } from "@/lib/audit/log";
import { endSession, getSession } from "@/lib/auth/session";

/**
 * POST /api/auth/logout — deletes the session ROW (not just the cookie), so a stolen
 * cookie is dead the moment its owner signs out. Idempotent: signing out without a
 * session is a 200, not a 401.
 */
export const POST = handler(async (req: NextRequest) => {
  const meta = requestMeta(req);
  const session = await getSession();

  if (session) {
    await audit({
      actor: session,
      action: "LOGOUT",
      entityType: "User",
      entityId: session.userId,
      summary: `${session.name} (${session.email}) signed out.`,
      meta,
    });
  }

  await endSession();

  return NextResponse.json({ ok: true });
});
