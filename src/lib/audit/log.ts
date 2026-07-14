import type { AuditOutcome } from "@/generated/prisma/enums";
import type { SessionUser } from "@/lib/auth/session";
import type { PermissionKey } from "@/lib/authz/permissions";
import { prisma } from "@/lib/db";

/** Where the request came from — attached to every audit row. */
export type RequestMeta = {
  ip: string | null;
  method: string | null;
  path: string | null;
};

export const NO_META: RequestMeta = { ip: null, method: null, path: null };

export function requestMeta(req: Request): RequestMeta {
  const url = new URL(req.url);
  return {
    // NextRequest.ip was removed in Next 15 — read the header.
    ip:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      null,
    method: req.method,
    path: url.pathname + url.search,
  };
}

/**
 * Just enough to attribute an action. SessionUser structurally satisfies this, but
 * bootstrap flows (signup, invite acceptance) have no session yet and still must be
 * attributable — so the audit spine does not demand one.
 */
export type AuditActor = {
  userId: string;
  email: string;
  name: string;
  orgId: string;
  orgName?: string;
};

export type AuditInput = {
  actor: AuditActor | SessionUser | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  loadId?: string | null;
  outcome?: AuditOutcome;
  permission?: PermissionKey | null;
  fromStatus?: string | null;
  toStatus?: string | null;
  summary: string;
  detail?: unknown;
  meta?: RequestMeta;
};

/**
 * The single audit spine. Business events and permission denials land in the same
 * table, so the audit viewer can show "who did what" and "who *tried* what" side
 * by side — and denials are queryable, not just printed.
 */
export async function audit(input: AuditInput): Promise<void> {
  const meta = input.meta ?? NO_META;
  const outcome: AuditOutcome = input.outcome ?? "ALLOWED";

  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: input.actor?.userId ?? null,
        actorEmail: input.actor?.email ?? null,
        actorName: input.actor?.name ?? null,
        actorOrgId: input.actor?.orgId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        loadId: input.loadId ?? null,
        outcome,
        permission: input.permission ?? null,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        summary: input.summary,
        detail: input.detail === undefined ? undefined : JSON.parse(JSON.stringify(input.detail)),
        ip: meta.ip,
        method: meta.method,
        path: meta.path,
      },
    });
  } catch (err) {
    // An audit write must never take down the request it is recording, but a
    // silent failure here would be worse than the original error — shout about it.
    console.error("[audit] FAILED TO WRITE AUDIT ROW", err, input);
  }

  if (outcome === "DENIED") {
    console.warn(
      `[authz] DENIED ${meta.method ?? "-"} ${meta.path ?? "-"} — ` +
        `user=${input.actor?.email ?? "anonymous"} org=${input.actor?.orgName ?? "-"} ` +
        `missing=${input.permission ?? "-"} :: ${input.summary}`,
    );
  }
}
