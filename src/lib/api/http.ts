import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Status code contract (docs/CONVENTIONS.md):
 *   401 not authenticated
 *   403 authenticated, but missing the required permission
 *   404 out of scope — we do NOT confirm the existence of a record you may not see
 *   409 illegal state transition / compliance block
 *   422 validation failure
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const Unauthenticated = () => new ApiError(401, "Not signed in.");

export const Forbidden = (permission: string) =>
  new ApiError(403, `Permission denied: you do not have "${permission}".`, { permission });

/**
 * Deliberately 404, not 403. Telling a carrier "403 — that load belongs to another
 * carrier" leaks the existence of loads it must not know about. Out-of-scope
 * records simply do not exist as far as the caller is concerned.
 */
export const NotFound = (what = "Resource") => new ApiError(404, `${what} not found.`);

export const Conflict = (message: string, detail?: unknown) => new ApiError(409, message, detail);

export const Invalid = (message: string, detail?: unknown) => new ApiError(422, message, detail);

export function toResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: err.message, ...(err.detail ? { detail: err.detail } : {}) },
      { status: err.status },
    );
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      { error: "Validation failed.", fieldErrors: z.flattenError(err).fieldErrors },
      { status: 422 },
    );
  }
  console.error("[api] unhandled error", err);
  return NextResponse.json({ error: "Internal server error." }, { status: 500 });
}

/** Wraps a route handler so thrown ApiErrors/ZodErrors become correct HTTP responses. */
export function handler<Args extends unknown[]>(
  fn: (...args: Args) => Promise<NextResponse | Response>,
): (...args: Args) => Promise<NextResponse | Response> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (err) {
      return toResponse(err);
    }
  };
}

/**
 * CSRF defence for non-JSON mutations.
 *
 * Every other mutating endpoint takes `application/json`, which a cross-site HTML form
 * cannot produce — the browser would have to send a preflight, and CORS refuses it. So
 * `SameSite=Lax` plus JSON-only is already sufficient there.
 *
 * The POD upload is the exception: `multipart/form-data` IS a "simple" content type, so
 * a malicious page COULD make a logged-in carrier's browser submit one cross-site. This
 * closes that hole. `Sec-Fetch-Site` is sent by every browser that matters; we fall back
 * to comparing Origin against Host for anything that does not send it.
 */
export function requireSameOrigin(req: Request): void {
  const site = req.headers.get("sec-fetch-site");
  if (site) {
    if (site === "same-origin" || site === "none") return;
    throw new ApiError(403, "Cross-site requests are not accepted for this endpoint.");
  }

  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser client (curl, the RBAC proof) — no ambient cookie risk

  const host = req.headers.get("host");
  try {
    if (new URL(origin).host === host) return;
  } catch {
    // fall through
  }
  throw new ApiError(403, "Cross-site requests are not accepted for this endpoint.");
}

/** Parse a JSON body with a Zod schema; malformed JSON becomes a 422, not a 500. */
export async function parseBody<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw Invalid("Request body must be valid JSON.");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(422, "Validation failed.", {
      fieldErrors: z.flattenError(result.error).fieldErrors,
    });
  }
  return result.data;
}
