import { type NextRequest } from "next/server";
import { handler, NotFound } from "@/lib/api/http";
import { audit, requestMeta } from "@/lib/audit/log";
import { loadScope, requireSession } from "@/lib/authz/guard";
import { prisma } from "@/lib/db";

type Ctx = { params: Promise<{ podId: string }> };

/**
 * Stream the POD bytes.
 *
 * SECURITY: the POD is resolved THROUGH its load's scope filter — never by a raw
 * findUnique on the id. A signed BOL carries the shipper, the lane, the rate and a
 * signature; an unguessable-ish cuid is not an access control. A rival carrier, an
 * unrelated shipper, or a broker who did not broker this load gets a 404 (never a
 * 403 — we do not confirm that a document they may not see exists), and the attempt
 * lands in the audit log as SCOPE_DENIED, which is exactly the signal an ops team
 * wants to see.
 */
export const GET = handler(async (req: NextRequest, ctx: Ctx) => {
  const { podId } = await ctx.params;
  const meta = requestMeta(req);
  const session = await requireSession();

  const pod = await prisma.proofOfDelivery.findFirst({
    where: {
      id: podId,
      // The load must itself be in scope. This is the whole control.
      load: { is: loadScope(session) },
    },
    select: {
      id: true,
      loadId: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      data: true,
    },
  });

  if (!pod) {
    await audit({
      actor: session,
      action: "SCOPE_DENIED",
      entityType: "ProofOfDelivery",
      entityId: podId,
      outcome: "DENIED",
      summary: `Blocked: ${session.email} requested proof-of-delivery document ${podId}, which is outside their organization's scope.`,
      detail: { orgType: session.orgType, orgId: session.orgId },
      meta,
    });
    throw NotFound("Proof of delivery");
  }

  const body = new Uint8Array(pod.data);
  const filename = pod.fileName.replace(/["\r\n]/g, "");

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": pod.mimeType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `inline; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(pod.fileName)}`,
      // The bytes are immutable, but they are also somebody's freight paperwork:
      // keep them out of shared caches and off intermediary disks.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; object-src 'none'; sandbox",
    },
  });
});
