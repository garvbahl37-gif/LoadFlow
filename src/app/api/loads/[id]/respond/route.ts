import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handler, parseBody } from "@/lib/api/http";
import { requestMeta } from "@/lib/audit/log";
import { loadInScopeOrThrow, requireSession } from "@/lib/authz/guard";
import { LOAD_DETAIL_INCLUDE, respondToTender, transitionsFor } from "@/lib/loads/service";

const bodySchema = z.object({
  accept: z.boolean({ error: "Accept or decline." }),
  note: z.string().max(300).optional(),
});

/**
 * The carrier's answer to a tender. respondToTender() owns scope (404),
 * `load.accept_decline` (403 + DENIED row) and the CARRIER_ASSIGNED-only guard (409).
 *
 * Declining detaches the carrier and returns the load to the board — so on a decline
 * the load may no longer be in this carrier's scope at all. Re-reading it would 404,
 * so we only re-read on accept and report the outcome either way.
 */
export const POST = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const meta = requestMeta(req);
  const session = await requireSession();
  const body = await parseBody(req, bodySchema);

  const result = await respondToTender(session, id, body.accept, meta);

  if (!result.accepted) {
    return NextResponse.json({
      accepted: false,
      load: null,
      transitions: [],
      message: "Tender declined. The load has returned to the broker's board.",
    });
  }

  const load = await loadInScopeOrThrow(session, id, LOAD_DETAIL_INCLUDE, meta);

  return NextResponse.json({
    accepted: true,
    load,
    transitions: await transitionsFor(session, id),
    message: "Tender accepted.",
  });
});
