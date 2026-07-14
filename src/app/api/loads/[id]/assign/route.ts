import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handler, parseBody } from "@/lib/api/http";
import { requestMeta } from "@/lib/audit/log";
import { loadInScopeOrThrow, requireSession } from "@/lib/authz/guard";
import { FLAG_LABEL, type FlagCode } from "@/lib/compliance/evaluator";
import { assignCarrier, LOAD_DETAIL_INCLUDE, transitionsFor } from "@/lib/loads/service";

const bodySchema = z.object({
  carrierOrgId: z.string().min(1, { error: "Choose a carrier." }),
});

/**
 * Tender a load. assignCarrier() does scope (404), authorize `load.assign_carrier`
 * (403 + DENIED row), the POSTED-only guard (409), the write, the audit row — and
 * then runs the compliance evaluator, because assignment IS the trigger for the gate.
 *
 * We return the evaluation with the load so the UI can say "tendered, but blocked —
 * insurance expired 12 days ago" in a single round trip, which is the whole demo.
 */
export const POST = handler(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const meta = requestMeta(req);
  const session = await requireSession();
  const body = await parseBody(req, bodySchema);

  const { evaluation } = await assignCarrier(session, id, body.carrierOrgId, meta);

  const load = await loadInScopeOrThrow(session, id, LOAD_DETAIL_INCLUDE, meta);

  return NextResponse.json({
    load,
    evaluation: {
      ...evaluation,
      raised: evaluation.raised.map((f) => ({
        ...f,
        label: FLAG_LABEL[f.code as FlagCode] ?? f.code,
      })),
    },
    blocked: evaluation.openBlocking > 0,
    transitions: await transitionsFor(session, id),
  });
});
