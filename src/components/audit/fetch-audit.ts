import { cookies, headers } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { auditQueryToParams, type AuditQuery, type AuditResponse } from "@/components/audit/types";

/**
 * The viewer reads the audit trail through `GET /api/audit` — the same curl-able
 * endpoint anyone else would use — rather than reaching into Prisma behind it.
 *
 * That is deliberate: the API is the enforcement boundary, so the page inherits the
 * scope filter (`actorOrgId === session.orgId`) and the `audit.view` check for free,
 * and cannot accidentally out-privilege the API it is a client of. It also means a
 * user without `audit.view` who loads this page gets a real 403 *and a DENIED audit
 * row written by `authorize()`* — the denial is recorded, not just rendered.
 */
export type AuditFetchResult =
  | { ok: true; data: AuditResponse }
  | { ok: false; status: number; error: string };

export async function fetchAudit(query: AuditQuery): Promise<AuditFetchResult> {
  const [jar, head] = await Promise.all([cookies(), headers()]); // Next 16: both are Promises

  const host = head.get("x-forwarded-host") ?? head.get("host");
  if (!host) return { ok: false, status: 500, error: "Could not resolve the request host." };
  const proto =
    head.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");

  const sid = jar.get(SESSION_COOKIE)?.value;
  const url = `${proto}://${host}/api/audit?${auditQueryToParams(query).toString()}`;

  try {
    const res = await fetch(url, {
      headers: sid ? { cookie: `${SESSION_COOKIE}=${sid}` } : {},
      cache: "no-store",
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return {
        ok: false,
        status: res.status,
        error: body?.error ?? `The audit API returned ${res.status}.`,
      };
    }

    return { ok: true, data: (await res.json()) as AuditResponse };
  } catch {
    return { ok: false, status: 503, error: "The audit API could not be reached." };
  }
}
