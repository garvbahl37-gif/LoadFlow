import { NextResponse } from "next/server";
import { handler } from "@/lib/api/http";
import { homePathFor } from "@/lib/auth/session";
import { effectivePermissions, requireSession } from "@/lib/authz/guard";

/**
 * GET /api/auth/me — the current SessionUser, or 401.
 *
 * `permissions` is the EFFECTIVE set: the union across the user's roles, after the
 * org-type filter that `can()` applies. So what the UI renders and what the API will
 * actually allow are computed from the same numbers — a shipper sees `[]` here because
 * `can()` returns false for a shipper on every key, roles or not.
 *
 * The UI uses this to decide what to *show*. It is never what decides what is *allowed*:
 * every route re-derives the session and re-checks server-side.
 */
export const GET = handler(async () => {
  const session = await requireSession();

  return NextResponse.json({
    user: { ...session, permissions: effectivePermissions(session) },
    home: homePathFor(session.orgType),
  });
});
