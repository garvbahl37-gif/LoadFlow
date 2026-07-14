/**
 * The shape of `GET /api/audit` (src/app/api/audit/route.ts), as the UI sees it
 * after JSON serialization — `ts` arrives as an ISO string, `detail` as unknown JSON.
 */

export type AuditActorRef = {
  userId: string | null;
  /** Denormalized onto the row: the trail must survive the user being deleted. */
  name: string | null;
  email: string | null;
};

export type AuditLoadRef = {
  id: string;
  reference: string;
  status: string;
};

export type AuditEntry = {
  id: string;
  ts: string;
  action: string;
  entityType: string;
  entityId: string | null;
  outcome: "ALLOWED" | "DENIED";
  permission: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  summary: string;
  detail: unknown;
  ip: string | null;
  method: string | null;
  path: string | null;
  actor: AuditActorRef;
  load: AuditLoadRef | null;
};

export type AuditFacets = {
  total: number;
  deniedCount: number;
  allowedCount: number;
  actions: { action: string; count: number }[];
};

export type AuditResponse = {
  entries: AuditEntry[];
  nextCursor: string | null;
  facets: AuditFacets;
};

/** What the page actually filters on. Mirrored 1:1 into the URL. */
export type AuditQuery = {
  q: string;
  action: string;
  deniedOnly: boolean;
  loadId: string;
  limit: number;
};

export const AUDIT_PAGE_SIZE = 100;
export const AUDIT_MAX_LIMIT = 500;

/** `?q=&action=&outcome=DENIED&limit=` → a typed query, ignoring junk. */
export function parseAuditQuery(sp: Record<string, string | string[] | undefined>): AuditQuery {
  const one = (key: string): string => {
    const v = sp[key];
    const s = Array.isArray(v) ? v[0] : v;
    return (s ?? "").trim();
  };

  const limit = Number.parseInt(one("limit"), 10);

  return {
    q: one("q"),
    action: one("action"),
    deniedOnly: one("outcome").toUpperCase() === "DENIED",
    loadId: one("loadId"),
    limit:
      Number.isFinite(limit) && limit > 0
        ? Math.min(limit, AUDIT_MAX_LIMIT)
        : AUDIT_PAGE_SIZE,
  };
}

export function auditQueryToParams(query: AuditQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.action) params.set("action", query.action);
  if (query.deniedOnly) params.set("outcome", "DENIED");
  if (query.loadId) params.set("loadId", query.loadId);
  if (query.limit !== AUDIT_PAGE_SIZE) params.set("limit", String(query.limit));
  return params;
}

export function hasActiveFilters(query: AuditQuery): boolean {
  return Boolean(query.q || query.action || query.deniedOnly || query.loadId);
}

/** `LOAD_TRANSITIONED` → `Load transitioned`. The raw token is still shown in mono. */
export function humanizeAction(action: string): string {
  const words = action.toLowerCase().replace(/[._]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
