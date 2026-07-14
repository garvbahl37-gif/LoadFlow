import Link from "next/link";
import type { ReactNode } from "react";
import clsx from "clsx";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The unauthenticated shell. Deliberately NOT `app-shell.tsx`: there is no session
 * yet, so there is no org, no nav, no permissions — showing that chrome empty would
 * be a lie. A hairline top bar, a considered backdrop, and the content. That's it.
 */

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-2", className)}>
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500 text-[oklch(20%_0_0)]">
        <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden>
          {/* A tractor-trailer silhouette, abstracted to two boxes and two wheels. */}
          <path d="M1 3.5A.5.5 0 0 1 1.5 3h6a.5.5 0 0 1 .5.5V10H1V3.5Zm8 1.5h2.7a.5.5 0 0 1 .43.25L14 8v2H9V5ZM3.75 10.5a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5Zm7.5 0a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5Z" />
        </svg>
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-ink">LoadFlow</span>
    </span>
  );
}

/** Very low-contrast grid + a single warm glow. Enough to feel built, not decorated. */
function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.35] dark:opacity-[0.22]"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--line) 1px, transparent 1px)," +
            "linear-gradient(to bottom, var(--line) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "radial-gradient(ellipse 90% 60% at 50% 0%, black 30%, transparent 78%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 90% 60% at 50% 0%, black 30%, transparent 78%)",
        }}
      />
      <div className="absolute -top-40 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-brand-500/8 blur-[120px] dark:bg-brand-500/10" />
    </div>
  );
}

export function AuthShell({
  children,
  aside,
  footerNote,
}: {
  children: ReactNode;
  /** Link shown at the far right of the top bar, e.g. "Sign in" / "Create an org". */
  aside?: ReactNode;
  footerNote?: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <Backdrop />

      <header className="border-b border-line/70 bg-surface/60 backdrop-blur-sm">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-5">
          <Link href="/login" className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-500">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-3">
            {aside}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl grow px-5 py-10 sm:py-14">{children}</main>

      <footer className="border-t border-line/70 px-5 py-4">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 text-[12px] text-ink-3">
          <span>
            LoadFlow — freight brokerage operations. Every action is permission-checked
            server-side and written to an immutable audit trail.
          </span>
          {footerNote}
        </div>
      </footer>
    </div>
  );
}

/** The small "why this exists" strip used on login and signup. */
export function ProductPitch() {
  const points: { title: string; body: string }[] = [
    {
      title: "A compliance gate that actually holds",
      body: "A load cannot move past Carrier Assigned while the carrier's insurance is lapsed or its authority is revoked. Not a warning banner — a blocked transition, enforced in the API.",
    },
    {
      title: "Permissions, never role names",
      body: "Roles are admin-authored bundles of a fixed permission catalog. The code never asks who you are, only what you may do — and it re-asks on every request.",
    },
    {
      title: "One audit spine",
      body: "Business events and permission denials land in the same table. If a dispatcher tried to override a flag and was refused, that attempt is on the record.",
    },
  ];

  return (
    <div className="grid gap-x-8 gap-y-5 sm:grid-cols-3">
      {points.map((p) => (
        <div key={p.title} className="flex gap-3">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden />
          <div>
            <p className="text-[13px] font-semibold text-ink">{p.title}</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink-3">{p.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
