"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { fieldError, readFailure, type FieldErrors } from "@/components/auth/api-error";
import { Button, Card, Field, FormError, Input } from "@/components/ui";

/**
 * ORG BOOTSTRAP. This is the only way an organization comes into existence, and the
 * only user ever created without an invite: the founding administrator.
 *
 * We say so on the page, because it is the part of the identity model people get wrong.
 */

type OrgType = "BROKER" | "CARRIER" | "SHIPPER";

const ORG_TYPES: {
  value: OrgType;
  label: string;
  blurb: string;
  grants: string;
}[] = [
  {
    value: "BROKER",
    label: "Broker",
    blurb: "You move other people's freight with other people's trucks.",
    grants:
      "Post loads, assign carriers, confirm rates, run the compliance gate, override a flag on the record, manage staff and roles, read the audit log.",
  },
  {
    value: "CARRIER",
    label: "Carrier",
    blurb: "You own the trucks. Brokers tender loads to you.",
    grants:
      "Accept or decline tenders, advance load status, upload proof of delivery, maintain your own compliance record, manage staff and roles, read the audit log.",
  },
  {
    value: "SHIPPER",
    label: "Shipper",
    blurb: "You own the freight and hand it to a broker.",
    grants:
      "Read-only visibility of your own loads. Shippers have no roles and no permissions by design — access is pure object-level scoping.",
  },
];

export function SignupForm() {
  const router = useRouter();

  const [orgType, setOrgType] = useState<OrgType>("BROKER");
  const [form, setForm] = useState({
    orgName: "",
    name: "",
    email: "",
    password: "",
    mcNumber: "",
    dotNumber: "",
    city: "",
    state: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  const selected = ORG_TYPES.find((t) => t.value === orgType)!;
  const isCarrier = orgType === "CARRIER";

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError(null);
    setFieldErrors({});

    // Optional fields are omitted when blank — an empty string is not "not supplied",
    // and the server's carrier/MC refinement reads it as a missing MC number.
    const payload: Record<string, string> = {
      orgType,
      orgName: form.orgName.trim(),
      name: form.name.trim(),
      email: form.email.trim(),
      password: form.password,
    };
    if (isCarrier && form.mcNumber.trim()) payload.mcNumber = form.mcNumber.trim();
    if (isCarrier && form.dotNumber.trim()) payload.dotNumber = form.dotNumber.trim();
    if (form.city.trim()) payload.city = form.city.trim();
    if (form.state.trim()) payload.state = form.state.trim().toUpperCase();

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const failure = await readFailure(res);
        setError(failure.message);
        setFieldErrors(failure.fieldErrors);
        setPending(false);
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
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-10">
      <Card className="p-6">
        <h1 className="text-lg font-semibold tracking-tight text-ink">
          Create an organization
        </h1>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
          This creates the organization <em>and</em> makes you its first administrator —
          a system role holding every permission that org type is allowed to hold. It is
          the only way an org is born.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
          {/* ── Segmented control ── */}
          <div>
            <span className="mb-1.5 block text-[13px] font-medium text-ink-2">
              What are you?
            </span>
            <div
              role="radiogroup"
              aria-label="Organization type"
              className="grid grid-cols-3 gap-1 rounded-lg border border-line-strong bg-surface-2 p-1"
            >
              {ORG_TYPES.map((t) => {
                const active = t.value === orgType;
                return (
                  <button
                    key={t.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={pending}
                    onClick={() => {
                      setOrgType(t.value);
                      setFieldErrors({});
                    }}
                    className={clsx(
                      "h-8 rounded-md text-[13px] font-medium transition-colors",
                      "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500",
                      "disabled:cursor-not-allowed disabled:opacity-45",
                      active
                        ? "bg-brand-500 text-[oklch(20%_0_0)] shadow-xs"
                        : "text-ink-2 hover:bg-surface hover:text-ink",
                    )}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-ink-3">
              <span className="text-ink-2">{selected.blurb}</span> As founding admin
              you&apos;ll hold: {selected.grants}
            </p>
          </div>

          <FormError message={error} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Company name"
              className="sm:col-span-2"
              error={fieldError(fieldErrors, "orgName")}
            >
              <Input
                required
                autoFocus
                placeholder={
                  isCarrier
                    ? "Ironline Trucking"
                    : orgType === "BROKER"
                      ? "Meridian Freight Solutions"
                      : "Cascade Manufacturing"
                }
                value={form.orgName}
                onChange={(e) => set("orgName", e.target.value)}
                disabled={pending}
              />
            </Field>

            {isCarrier ? (
              <>
                <Field
                  label="MC number"
                  hint="Required for carriers — the compliance engine keys off your operating authority."
                  error={fieldError(fieldErrors, "mcNumber")}
                >
                  <Input
                    required
                    placeholder="MC-441029"
                    value={form.mcNumber}
                    onChange={(e) => set("mcNumber", e.target.value)}
                    disabled={pending}
                  />
                </Field>
                <Field
                  label="DOT number"
                  hint="Optional."
                  error={fieldError(fieldErrors, "dotNumber")}
                >
                  <Input
                    placeholder="2551043"
                    className="tnum"
                    value={form.dotNumber}
                    onChange={(e) => set("dotNumber", e.target.value)}
                    disabled={pending}
                  />
                </Field>
              </>
            ) : null}

            <Field label="City" error={fieldError(fieldErrors, "city")}>
              <Input
                placeholder="Portland"
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
                disabled={pending}
              />
            </Field>

            <Field label="State" hint="Two letters." error={fieldError(fieldErrors, "state")}>
              <Input
                placeholder="OR"
                maxLength={2}
                className="uppercase"
                value={form.state}
                onChange={(e) => set("state", e.target.value)}
                disabled={pending}
              />
            </Field>
          </div>

          <div className="border-t border-line pt-5">
            <p className="mb-3 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
              Your administrator account
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Your name" error={fieldError(fieldErrors, "name")}>
                <Input
                  required
                  autoComplete="name"
                  placeholder="Dana Whitfield"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  disabled={pending}
                />
              </Field>
              <Field label="Work email" error={fieldError(fieldErrors, "email")}>
                <Input
                  type="email"
                  required
                  autoComplete="username"
                  placeholder="you@company.com"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  disabled={pending}
                />
              </Field>
              <Field
                label="Password"
                className="sm:col-span-2"
                hint="At least 8 characters. Hashed with scrypt and a per-user salt."
                error={fieldError(fieldErrors, "password")}
              >
                <Input
                  type="password"
                  required
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  disabled={pending}
                />
              </Field>
            </div>
          </div>

          <Button type="submit" variant="primary" className="w-full" disabled={pending}>
            {pending ? "Creating organization…" : `Create ${selected.label.toLowerCase()} organization`}
          </Button>

          <p className="text-center text-[13px] text-ink-3">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              Sign in
            </Link>
          </p>
        </form>
      </Card>

      <StaffNotice />
    </div>
  );
}

/** The single most misunderstood rule in the identity model, stated plainly. */
function StaffNotice() {
  return (
    <aside className="space-y-4 lg:sticky lg:top-10">
      <Card className="border-brand-500/30 bg-brand-500/5 p-5">
        <div className="flex items-start gap-2.5">
          <svg
            viewBox="0 0 16 16"
            className="mt-0.5 h-4 w-4 shrink-0 fill-brand-600 dark:fill-brand-400"
            aria-hidden
          >
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 3a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm1 8H7V7h2v5Z" />
          </svg>
          <div>
            <p className="text-[13px] font-semibold text-ink">Staff cannot self-signup</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
              This page creates a <em>new</em> organization. It cannot add you to one
              that already exists — there is no field on it for choosing an org, and the
              server would ignore one if you sent it.
            </p>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
              To join an existing broker or carrier, an administrator with{" "}
              <code className="rounded-xs bg-surface-2 px-1 font-mono text-[11.5px] text-ink">
                staff.manage
              </code>{" "}
              issues you an invite. The invite pins your org and your exact roles; you
              only choose a password. That is the whole staff path.
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
          What happens on submit
        </p>
        <ol className="mt-3 space-y-2.5 text-[12.5px] leading-relaxed text-ink-2">
          {[
            "The Org row and your User row are created in one transaction — you never get a half-built org.",
            "A system role, “Organization Administrator”, is minted holding every permission legal for that org type, and granted to you.",
            "An ORG_CREATED row is written to the audit log before you ever see a page.",
            "You are signed in and dropped into your console.",
          ].map((step, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="tnum mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line-strong text-[10px] font-semibold text-ink-3">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </Card>
    </aside>
  );
}
