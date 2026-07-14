import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Next 16 renamed `middleware.ts` to `proxy.ts` and the exported function to `proxy`.
 *
 * This is a CONVENIENCE redirect for humans who land on an app page without a
 * session — it is emphatically NOT a security boundary. It only checks that a
 * cookie exists; it does not validate it, and it does not know what the user may do.
 * Every page and every API route re-resolves the session and re-checks permissions
 * server-side. Deleting this file would not weaken authorization by one inch.
 */
const PROTECTED = ["/broker", "/carrier", "/shipper"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (!request.cookies.get(SESSION_COOKIE)) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
