import { NextResponse, type NextRequest } from "next/server";
import { handler } from "@/lib/api/http";
import { requestMeta } from "@/lib/audit/log";
import { authorize, requireSession } from "@/lib/authz/guard";
import { catalogFor } from "@/lib/rbac/service";

/**
 * GET /api/permissions — the role builder's vocabulary.
 *
 * Filtered by the CALLER'S org type, derived from the session and never from a query
 * string. A carrier admin is not merely prevented from granting `load.create` — it is
 * never in the payload, so it cannot be rendered, guessed, or copy-pasted back at us.
 */
export const GET = handler(async (req: NextRequest) => {
  const meta = requestMeta(req);
  const session = await requireSession();
  await authorize(session, "staff.manage", meta, { entityType: "Permission" });

  return NextResponse.json(catalogFor(session));
});
