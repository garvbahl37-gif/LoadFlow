"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { fieldError, readFailure, type FieldErrors } from "@/components/auth/api-error";
import { Button, Field, FormError, Input } from "@/components/ui";

/**
 * The invitee supplies exactly one thing: a password.
 *
 * Their email, their org and their roles are read off the invite row server-side and
 * are not inputs here — you cannot accept into a different org, under a different
 * address, or with a role you weren't granted, because none of those are fields.
 */
export function AcceptInviteForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || mismatch) return;

    setPending(true);
    setError(null);
    setFieldErrors({});

    try {
      const res = await fetch(`/api/invites/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const failure = await readFailure(res);
        setError(failure.message);
        setFieldErrors(failure.fieldErrors);
        setPending(false);
        // 404/409 mean the invite died under us (revoked, used, expired). Re-render the
        // server component so the page swaps to the right terminal state.
        if (res.status === 404 || res.status === 409) router.refresh();
        return;
      }

      const data = (await res.json()) as { home: string };
      router.push(data.home);
      router.refresh();
    } catch {
      setError("Could not reach the server. Is the app still running?");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormError message={error} />

      {/* Shown, not editable: the invite decides who you are. */}
      <Field label="Email" hint="Fixed by the invitation — you cannot change it here.">
        <Input value={email} readOnly disabled className="font-mono text-[13px]" />
      </Field>

      <Field
        label="Choose a password"
        hint="At least 8 characters."
        error={fieldError(fieldErrors, "password")}
      >
        <Input
          type="password"
          required
          autoFocus
          autoComplete="new-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
        />
      </Field>

      <Field
        label="Confirm password"
        error={mismatch ? "Those two passwords don't match." : undefined}
      >
        <Input
          type="password"
          required
          autoComplete="new-password"
          placeholder="••••••••"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={pending}
        />
      </Field>

      <Button
        type="submit"
        variant="primary"
        className="w-full"
        disabled={pending || mismatch || password.length < 8 || confirm.length === 0}
      >
        {pending ? "Creating your account…" : "Accept invitation"}
      </Button>

      <p className="text-center text-[12px] text-ink-3">
        Accepting creates your account and signs you in. The invitation is then spent —
        the link stops working.
      </p>
    </form>
  );
}
