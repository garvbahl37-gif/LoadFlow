import { NextResponse, type NextRequest } from "next/server";
import { Conflict, handler, Invalid, requireSameOrigin } from "@/lib/api/http";
import { audit, requestMeta } from "@/lib/audit/log";
import { authorize, loadInScopeOrThrow, requireSession } from "@/lib/authz/guard";
import { prisma } from "@/lib/db";
import { STATUS_LABEL } from "@/lib/loads/state-machine";

type Ctx = { params: Promise<{ id: string }> };

/** A POD is a scan or a photo of a signed bill of lading. Nothing else. */
const ALLOWED_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/** You cannot prove delivery of a load that has not shipped. */
const PODABLE_STATUSES = ["DISPATCHED", "IN_TRANSIT", "DELIVERED"] as const;

/** Metadata only — never the bytes. The bytes are served by /api/pods/[podId]/file. */
export const GET = handler(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const meta = requestMeta(req);
  const session = await requireSession();

  const load = await loadInScopeOrThrow(session, id, undefined, meta);

  const rows = await prisma.proofOfDelivery.findMany({
    where: { loadId: load.id },
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      loadId: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      notes: true,
      uploadedAt: true,
      verifiedAt: true,
      uploadedBy: { select: { id: true, name: true, email: true } },
      verifiedBy: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({
    pods: rows.map((p) => ({ ...p, url: `/api/pods/${p.id}/file` })),
  });
});

/**
 * Upload a POD. `multipart/form-data`: `file` (+ optional `notes`).
 *
 * Enforcement order is the house order: session → scope (404, and the probe is
 * audited) → permission (403 + DENIED row) → state (409) → validation (422) → write
 * → audit. `pod.upload` is a CARRIER-only permission and the scope filter pins the
 * load to the caller's own carrier org, so a broker, a shipper, or a rival carrier
 * cannot reach this write from any angle.
 */
export const POST = handler(async (req: NextRequest, ctx: Ctx) => {
  // The only mutation in the app that is not application/json. multipart/form-data is a
  // "simple" content type, so a cross-site form could otherwise make a signed-in
  // carrier's browser post one. Every JSON endpoint is already immune to that.
  requireSameOrigin(req);

  const { id } = await ctx.params;
  const meta = requestMeta(req);
  const session = await requireSession();

  // Carrier scope means carrierOrgId === session.orgId — i.e. the load really is
  // assigned to the caller. Anyone else gets a 404, never a 403.
  const load = await loadInScopeOrThrow(session, id, undefined, meta);

  await authorize(session, "pod.upload", meta, {
    entityType: "ProofOfDelivery",
    entityId: null,
    loadId: load.id,
  });

  if (!(PODABLE_STATUSES as readonly string[]).includes(load.status)) {
    throw Conflict(
      `Load ${load.reference} is ${STATUS_LABEL[load.status]}. A proof of delivery can only be attached once the load has been dispatched.`,
      { status: load.status, allowed: PODABLE_STATUSES },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw Invalid("Expected a multipart/form-data upload.", {
      fieldErrors: { file: ["Expected a multipart/form-data upload."] },
    });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw Invalid("Attach a POD document.", {
      fieldErrors: { file: ["Attach a POD document."] },
    });
  }

  const notesRaw = form.get("notes");
  const notes = typeof notesRaw === "string" && notesRaw.trim() ? notesRaw.trim().slice(0, 500) : null;

  const mimeType = file.type.split(";")[0]!.trim().toLowerCase();
  if (!ALLOWED_MIME[mimeType]) {
    throw Invalid(
      `${mimeType || "That file type"} is not an accepted POD format. Upload a PNG, JPEG, WebP or PDF.`,
      {
        fieldErrors: {
          file: ["Accepted formats: PNG, JPEG, WebP, PDF."],
        },
        received: mimeType || null,
        accepted: Object.keys(ALLOWED_MIME),
      },
    );
  }

  // Cheap reject on the reported size before we buffer anything…
  if (file.size > MAX_BYTES) {
    throw tooLarge(file.size);
  }

  // …then the only number that actually matters: the real byte length. A client can
  // lie about `size`; it cannot lie about what it sent.
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) {
    throw tooLarge(bytes.byteLength);
  }
  if (bytes.byteLength === 0) {
    throw Invalid("That file is empty.", { fieldErrors: { file: ["That file is empty."] } });
  }

  const fileName = safeFileName(file.name, ALLOWED_MIME[mimeType]!);

  const pod = await prisma.proofOfDelivery.create({
    data: {
      loadId: load.id,
      fileName,
      mimeType,
      sizeBytes: bytes.byteLength,
      data: bytes,
      notes,
      uploadedById: session.userId,
    },
    select: {
      id: true,
      loadId: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      notes: true,
      uploadedAt: true,
    },
  });

  await audit({
    actor: session,
    action: "POD_UPLOADED",
    entityType: "ProofOfDelivery",
    entityId: pod.id,
    loadId: load.id,
    summary: `Proof of delivery "${fileName}" (${formatBytes(pod.sizeBytes)}) uploaded on load ${load.reference} by ${session.orgName}.`,
    detail: {
      fileName,
      mimeType,
      sizeBytes: pod.sizeBytes,
      loadStatus: load.status,
      notes,
    },
    meta,
  });

  return NextResponse.json({ pod: { ...pod, url: `/api/pods/${pod.id}/file` } }, { status: 201 });
});

function tooLarge(size: number) {
  return Invalid(`That file is ${formatBytes(size)}. The maximum POD size is 5 MB.`, {
    fieldErrors: { file: ["Maximum file size is 5 MB."] },
    sizeBytes: size,
    maxBytes: MAX_BYTES,
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Never echo a client-supplied path back into a filename. */
function safeFileName(raw: string, ext: string): string {
  const base = (raw.split(/[\\/]/).pop() ?? "").replace(/[^\w.\- ]+/g, "").trim();
  const cleaned = base.replace(/^\.+/, "").slice(0, 120);
  if (!cleaned) return `pod.${ext}`;
  return cleaned.includes(".") ? cleaned : `${cleaned}.${ext}`;
}
