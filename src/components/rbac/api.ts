/**
 * The console's only door to the server. Every mutation on this screen goes through
 * `/api/**`, which re-authenticates, re-authorizes (`staff.manage`), re-scopes to the
 * caller's org and writes an audit row. Nothing here is trusted; this module just
 * turns the API's error contract into something a human can read.
 *
 * Error bodies come in two shapes from `src/lib/api/http.ts`:
 *   { error, detail: { fieldErrors } }   ← thrown ApiError (422 from parseBody)
 *   { error, fieldErrors }               ← a raw ZodError that reached toResponse
 */

export class RbacApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = "RbacApiError";
  }
}

type ErrorBody = {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  detail?: { fieldErrors?: Record<string, string[]> };
};

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers:
        init?.body !== undefined
          ? { "content-type": "application/json", ...(init?.headers ?? {}) }
          : init?.headers,
    });
  } catch {
    throw new RbacApiError(0, "Could not reach the server. Check your connection and retry.");
  }

  if (res.status === 204) return undefined as T;

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const b = (body ?? {}) as ErrorBody;
    throw new RbacApiError(
      res.status,
      b.error ?? `Request failed (${res.status}).`,
      b.detail?.fieldErrors ?? b.fieldErrors ?? {},
    );
  }

  return body as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof RbacApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

export function fieldErrorsOf(err: unknown): Record<string, string[]> {
  return err instanceof RbacApiError ? err.fieldErrors : {};
}

export function firstFieldError(err: unknown, field: string): string | undefined {
  return fieldErrorsOf(err)[field]?.[0];
}
