/**
 * The API's error envelope, decoded once so every public form surfaces the *real*
 * server message instead of a generic "something went wrong".
 *
 *   ApiError  → { error, detail? }
 *   parseBody → { error: "Validation failed.", detail: { fieldErrors } }
 *   ZodError  → { error: "Validation failed.", fieldErrors }   (top-level)
 *
 * Both field-error shapes exist in `src/lib/api/http.ts`, so we read both.
 */
export type FieldErrors = Record<string, string[] | undefined>;

export type ApiFailure = {
  status: number;
  message: string;
  fieldErrors: FieldErrors;
};

const FALLBACK: Record<number, string> = {
  401: "Not signed in.",
  403: "You do not have permission to do that.",
  404: "Not found.",
  409: "That conflicts with the current state.",
  422: "Please check the fields below.",
};

export async function readFailure(res: Response): Promise<ApiFailure> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON response (a crash, a proxy page) — fall through to the generic message.
  }

  const b = (body ?? {}) as {
    error?: unknown;
    fieldErrors?: unknown;
    detail?: { fieldErrors?: unknown } | unknown;
  };

  const detail = b.detail as { fieldErrors?: unknown } | undefined;
  const raw = (b.fieldErrors ?? detail?.fieldErrors) as FieldErrors | undefined;

  const message =
    typeof b.error === "string" && b.error.length > 0
      ? b.error
      : (FALLBACK[res.status] ?? `Request failed (${res.status}).`);

  return {
    status: res.status,
    message,
    fieldErrors: raw && typeof raw === "object" ? raw : {},
  };
}

/** First message for a field, if the server flagged it. */
export function fieldError(errors: FieldErrors, key: string): string | undefined {
  return errors[key]?.[0];
}

/**
 * A `?next=` value is attacker-controllable. Only ever follow a same-origin, absolute
 * path — never a protocol-relative `//evil.com` or a full URL.
 */
export function safeNext(next: string | undefined | null): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}
