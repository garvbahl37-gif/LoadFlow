import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handler, NotFound, parseBody } from "@/lib/api/http";
import { requestMeta } from "@/lib/audit/log";
import { requireSession } from "@/lib/authz/guard";
import { FLAG_LABEL, type FlagCode } from "@/lib/compliance/evaluator";
import { prisma } from "@/lib/db";
import { factsFor, overrideFlag, transitionsFor } from "@/lib/loads/service";

const bodySchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, { error: "Explain why this risk is acceptable (10+ characters)." })
    .max(500, { error: "Keep the reason under 500 characters." }),
});

/**
 * Accept the risk, on the record, forever.
 *
 * overrideFlag() owns scope (404), `load.override_compliance_flag` (403 + a DENIED
 * audit row — this is the exact denial the Dispatcher account demonstrates), the
 * reason length check, the flag-is-open check (409), the write and the audit row.
 *
 * Overriding does NOT advance the load. A human still has to move it — the override
 * only removes the gate. We return the new flag state and the freshly-recomputed
 * transitions so the UI can light up the next legal button.
 */
export const POST = handler(
  async (req: NextRequest, ctx: { params: Promise<{ id: string; flagId: string }> }) => {
    const { id, flagId } = await ctx.params;
    const meta = requestMeta(req);
    const session = await requireSession();
    const body = await parseBody(req, bodySchema);

    await overrideFlag(session, id, flagId, body.reason, meta);

    const flag = await prisma.complianceFlag.findFirst({
      where: { id: flagId, loadId: id },
      include: { overriddenBy: { select: { id: true, name: true, email: true } } },
    });
    if (!flag) throw NotFound("Compliance flag");

    const [facts, transitions] = await Promise.all([factsFor(id), transitionsFor(session, id)]);

    return NextResponse.json({
      flag: { ...flag, label: FLAG_LABEL[flag.code as FlagCode] ?? flag.code },
      openBlocking: facts.openBlockingFlags,
      blocked: facts.openBlockingFlags > 0,
      // The load is deliberately NOT auto-advanced. These are the moves now open.
      transitions,
    });
  },
);
