import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { LoadStatus } from "@/generated/prisma/enums";
import { handler, parseBody } from "@/lib/api/http";
import { requestMeta } from "@/lib/audit/log";
import { requireSession } from "@/lib/authz/guard";
import { transitionLoad, transitionsFor } from "@/lib/loads/service";

const bodySchema = z.object({
  to: z.enum(LoadStatus, { error: "Choose a target status." }),
  note: z.string().max(300).optional(),
});

/**
 * The ONLY way a status moves. This route is a thin shell on purpose:
 * transitionLoad() owns the scope check (404), looks the required permission up in
 * the TRANSITION TABLE — never from the client — authorizes it (403 + a DENIED audit
 * row), runs the guards including the compliance gate (409), writes, and audits.
 */
export const POST = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const meta = requestMeta(req);
  const session = await requireSession();
  const body = await parseBody(req, bodySchema);

  const load = await transitionLoad(session, id, body.to, meta, body.note);

  return NextResponse.json({
    load,
    // The board re-renders straight from this: what may this actor do *next*.
    transitions: await transitionsFor(session, id),
  });
});
