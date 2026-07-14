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
      verifiedAt: true,
      load: { select: { status: true } },
    },
  });

  // A shipper is shown a POD only once the broker has VERIFIED it — the app promises them
  // "we will not show it to you as proof until your broker has verified it." Enforce that
  // at the API, not just in the shipper's page: an unverified POD is 404 for a shipper.
  if (pod && session.orgType === "SHIPPER" && pod.verifiedAt === null) {
    await audit({
      actor: session,
      action: "SCOPE_DENIED",
      entityType: "ProofOfDelivery",
      entityId: podId,
      outcome: "DENIED",
      summary: `Blocked: ${session.email} requested an unverified proof of delivery; PODs are released to shippers only after the broker verifies them.`,
      detail: { reason: "POD_NOT_VERIFIED", loadStatus: pod.load.status },
      meta,
    });
    throw NotFound("Proof of delivery");
  }

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

  // A `sandbox` directive stops the browser's built-in PDF viewer from rendering the
  // document at all, so an embedded POD shows as a blank frame. Images get the strict
  // policy; PDFs get one that still forbids scripts and subresources but permits the
  // viewer to run. `nosniff` plus the upload-time MIME allowlist (png/jpeg/webp/pdf)
  // is what actually prevents this route from serving something executable.
  const isPdf = pod.mimeType === "application/pdf";
  const csp = isPdf
    ? "default-src 'none'; object-src 'self'; plugin-types application/pdf"
    : "default-src 'none'; img-src 'self'; object-src 'none'; sandbox";

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
      "Content-Security-Policy": csp,
    },
  });
});
