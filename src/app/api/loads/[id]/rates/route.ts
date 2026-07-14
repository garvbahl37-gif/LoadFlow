import { NextResponse, type NextRequest } from "next/server";
import { handler, parseBody } from "@/lib/api/http";
import { requestMeta } from "@/lib/audit/log";
import { loadInScopeOrThrow, requireOrgType, requireSession } from "@/lib/authz/guard";
import { prisma } from "@/lib/db";
import { confirmRate, parseAccessorials, rateInputSchema } from "@/lib/rates/service";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Every version of the rate, newest first, for the two parties to the agreement — the
 * broker and the assigned carrier. A shipper is NOT a party: the brief limits them to
 * "their own load status and delivery confirmation", and the rate history carries the
 * broker's margin and internal negotiation notes. Shippers are refused here (and their
 * own page never calls this), so the boundary is enforced at the API, not just the UI.
 */
export const GET = handler(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const meta = requestMeta(req);
  const session = await requireSession();
  await requireOrgType(session, ["BROKER", "CARRIER"], meta);

  const load = await loadInScopeOrThrow(session, id, undefined, meta);

  const rows = await prisma.rateConfirmation.findMany({
    where: { loadId: load.id },
    orderBy: { version: "desc" },
    include: { createdBy: { select: { id: true, name: true, email: true } } },
  });

  const rates = rows.map((r) => ({
    id: r.id,
    loadId: r.loadId,
    version: r.version,
    baseRateCents: r.baseRateCents,
    accessorials: parseAccessorials(r.accessorials),
    totalRateCents: r.totalRateCents,
    status: r.status,
    notes: r.notes,
    createdAt: r.createdAt,
    isConfirmedForLoad: load.confirmedRateConfirmationId === r.id,
    createdBy: r.createdBy
      ? { id: r.createdBy.id, name: r.createdBy.name, email: r.createdBy.email }
      : null,
  }));

  return NextResponse.json({
    rates,
    confirmedRateId: load.confirmedRateConfirmationId,
    // Once the truck rolls the agreement is frozen; the UI reads this rather than
    // re-deriving the rule, but the API re-checks it regardless (409 from confirmRate).
    negotiable: load.status === "CARRIER_ASSIGNED" || load.status === "RATE_CONFIRMED",
  });
});

/**
 * Confirm a rate — always a NEW immutable version.
 * confirmRate() owns scope (404), `rate.confirm` (403 + DENIED row), the
 * dispatched-freeze (409), the supersede, the Load.confirmedRate repoint, and the
 * ALLOWED audit row. This route is only a transport adapter over it.
 */
export const POST = handler(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const meta = requestMeta(req);
  const session = await requireSession();
  const input = await parseBody(req, rateInputSchema);

  const rate = await confirmRate(session, id, input, meta);

  return NextResponse.json(
    {
      rate: {
        ...rate,
        accessorials: parseAccessorials(rate.accessorials),
      },
    },
    { status: 201 },
  );
});
