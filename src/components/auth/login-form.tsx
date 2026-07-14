"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { fieldError, readFailure, type FieldErrors } from "@/components/auth/api-error";
import { DEMO_PASSWORD, DemoAccounts } from "@/components/auth/demo-accounts";
import { Button, Card, Field, FormError, Input } from "@/components/ui";

/**
 * Sign in. The form is the only thing that talks to `/api/auth/login`; the demo panel
 * just fills it. On success the API has already set the HttpOnly session cookie, so we
 * only need to navigate — and `router.refresh()` so the server components on the
 * destination re-render with the new session instead of a cached signed-out tree.
 */
export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  function pick(addr: string) {
    setEmail(addr);
    setPassword(DEMO_PASSWORD);
    setPicked(addr);
    setError(null);
    setFieldErrors({});
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError(null);
    setFieldErrors({});

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const failure = await readFailure(res);
        setError(failure.message);
        setFieldErrors(failure.fieldErrors);
        setPending(false);
        return;
      }

      const data = (await res.json()) as { home: string };
      // `next` is validated server-side before it reaches us; the API decides `home`.
      router.push(next ?? data.home);
      router.refresh();
      // Deliberately stay `pending` — the navigation is the completion of the action,
      // and re-enabling the button mid-transition invites a double submit.
    } catch {
      setError("Could not reach the server. Is the app still running?");
      setPending(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(360px,400px)] lg:items-start lg:gap-10">
      {/* Demo panel — second on mobile so the form is what you land on. */}
      <div className="order-2 lg:order-1">
        <DemoAccounts onPick={pick} selected={picked} />
      </div>

      <div className="order-1 lg:order-2 lg:sticky lg:top-10">
        <Card className="p-6">
          <h1 className="text-lg font-semibold tracking-tight text-ink">Sign in</h1>
          <p className="mt-1 text-[13px] text-ink-3">
            {next
              ? "You need to be signed in to open that page."
              : "Use your work address. Staff accounts are created by invitation."}
          </p>

          <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate>
            <FormError message={error} />

            <Field label="Email" error={fieldError(fieldErrors, "email")}>
              <Input
                type="email"
                name="email"
                autoComplete="username"
                autoFocus
                required
                placeholder="you@company.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setPicked(undefined);
                }}
                disabled={pending}
              />
            </Field>

            <Field label="Password" error={fieldError(fieldErrors, "password")}>
              <Input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={pending}
              />
            </Field>

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={pending || !email || !password}
            >
              {pending ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <div className="mt-5 border-t border-line pt-4 text-[13px] text-ink-3">
            Don&apos;t have an organization yet?{" "}
            <Link
              href="/signup"
              className="font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              Create one
            </Link>
            .
            <p className="mt-1.5 text-[12px]">
              Joining an existing broker or carrier? Ask an administrator for an invite —
              staff cannot self-signup.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
