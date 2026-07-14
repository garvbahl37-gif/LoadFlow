import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";
import type { FlagSeverity, FlagStatus, LoadStatus } from "@/generated/prisma/enums";
import { STATUS_LABEL } from "@/lib/loads/state-machine";

/* The whole visual vocabulary of the app, in one file. Every page composes from
   here so the product reads as one system rather than six. */

// ── Buttons ───────────────────────────────────────────────────

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 " +
  "disabled:cursor-not-allowed disabled:opacity-45";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-brand-500 text-[oklch(20%_0_0)] hover:bg-brand-400 active:bg-brand-600",
  secondary:
    "border border-line-strong bg-surface text-ink hover:bg-surface-2 active:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "bg-danger text-white hover:opacity-90 active:opacity-80",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-[13px]",
  md: "h-9 px-3.5 text-sm",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      className={clsx(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)}
      {...props}
    />
  );
}

// ── Surfaces ──────────────────────────────────────────────────

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={clsx("rounded-card border border-line bg-surface", className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "flex items-start justify-between gap-4 border-b border-line px-5 py-3.5",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  icon = "—",
}: {
  title: string;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface-2 text-ink-3">
        {icon}
      </div>
      <p className="text-sm font-medium text-ink-2">{title}</p>
      {hint ? <p className="mt-1 max-w-sm text-[13px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

// ── Badges ────────────────────────────────────────────────────

type Tone = "neutral" | "ok" | "warn" | "danger" | "info" | "brand";

const TONE: Record<Tone, string> = {
  neutral: "border-line-strong bg-surface-2 text-ink-2",
  ok: "border-transparent bg-ok-soft text-ok",
  warn: "border-transparent bg-warn-soft text-warn",
  danger: "border-transparent bg-danger-soft text-danger",
  info: "border-transparent bg-info-soft text-info",
  brand: "border-transparent bg-brand-500/15 text-brand-700 dark:text-brand-300",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Load status → colour. The pipeline reads as a temperature: cool → warm → done. */
const STATUS_TONE: Record<LoadStatus, Tone> = {
  POSTED: "neutral",
  CARRIER_ASSIGNED: "brand",
  RATE_CONFIRMED: "brand",
  DISPATCHED: "info",
  IN_TRANSIT: "info",
  DELIVERED: "ok",
  POD_VERIFIED: "ok",
  INVOICED: "ok",
  CLOSED: "neutral",
  CANCELLED: "danger",
};

export function StatusBadge({ status }: { status: LoadStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export function FlagBadge({
  severity,
  status,
}: {
  severity: FlagSeverity;
  status: FlagStatus;
}) {
  if (status === "OVERRIDDEN") return <Badge tone="warn">Overridden</Badge>;
  if (status === "RESOLVED") return <Badge tone="ok">Resolved</Badge>;
  return severity === "BLOCKING" ? (
    <Badge tone="danger">Blocking</Badge>
  ) : (
    <Badge tone="warn">Warning</Badge>
  );
}

/** The unmissable "this load is stopped" bar. */
export function BlockedBanner({ count, children }: { count: number; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-card border border-danger/40 bg-danger-soft px-4 py-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-danger text-[11px] font-bold text-white">
        !
      </span>
      <div className="min-w-0 text-[13px]">
        <p className="font-semibold text-danger">
          Blocked by compliance — {count} unresolved {count === 1 ? "flag" : "flags"}
        </p>
        <p className="mt-0.5 text-ink-2">
          This load cannot progress past Carrier Assigned until the carrier&apos;s record is
          fixed, or the flag is overridden with a documented reason.
        </p>
        {children}
      </div>
    </div>
  );
}

// ── Forms ─────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-[12px] text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[12px] text-ink-3">{hint}</span>
      ) : null}
    </label>
  );
}

const CONTROL =
  "rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink " +
  "placeholder:text-ink-3 focus-visible:border-brand-500 focus-visible:outline-2 " +
  "focus-visible:outline-offset-0 focus-visible:outline-brand-500/40 disabled:opacity-50";

/**
 * Width is opt-in, not baked into CONTROL.
 *
 * clsx concatenates; it does NOT resolve Tailwind conflicts the way tailwind-merge would
 * (and we deliberately don't ship tailwind-merge). So a hardcoded `w-full` in the base
 * would sit in the class list alongside a caller's `w-44`, and the CSS cascade — not the
 * caller — would decide the winner. `w-full` won, which meant every width passed to an
 * Input or Select in this codebase was silently ignored. That is what turned the load
 * board's filter toolbar into a column of full-width blocks.
 *
 * Default to `w-full` (right for forms), but stand down the moment the caller sets a width.
 */
function control(extra: string, className?: string): string {
  const callerSetsWidth = className ? /(^|\s)(w-|min-w-|max-w-|flex-1|grow)/.test(className) : false;
  return clsx(CONTROL, !callerSetsWidth && "w-full", extra, className);
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={control("h-9", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={control("h-9 pr-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={control("py-2", className)} {...props} />;
}

/** Inline API error, shown above a form. */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[13px] text-danger">
      {message}
    </div>
  );
}

// ── Table ─────────────────────────────────────────────────────

export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto">
      <table className={clsx("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      className={clsx(
        "border-b border-line px-4 py-2.5 text-left text-[11px] font-semibold tracking-wide text-ink-3 uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return (
    <td className={clsx("border-b border-line px-4 py-3 align-middle text-ink", className)} {...props} />
  );
}

// ── Stats ─────────────────────────────────────────────────────

export function Stat({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  hint?: string;
}) {
  const accent: Record<Tone, string> = {
    neutral: "text-ink",
    ok: "text-ok",
    warn: "text-warn",
    danger: "text-danger",
    info: "text-info",
    brand: "text-brand-600 dark:text-brand-400",
  };
  return (
    <Card className="px-4 py-3.5">
      <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{label}</p>
      <p className={clsx("tnum mt-1 text-2xl font-semibold", accent[tone])}>{value}</p>
      {hint ? <p className="mt-0.5 text-[12px] text-ink-3">{hint}</p> : null}
    </Card>
  );
}

/** The "why is this button disabled" affordance. Hiding a control without saying
    why is how RBAC UIs get accused of being broken. */
export function LockedHint({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-[12px] text-ink-3">
      <svg viewBox="0 0 12 12" className="h-3 w-3 fill-current" aria-hidden>
        <path d="M3 5V3.5a3 3 0 1 1 6 0V5h.5A1.5 1.5 0 0 1 11 6.5v3A1.5 1.5 0 0 1 9.5 11h-7A1.5 1.5 0 0 1 1 9.5v-3A1.5 1.5 0 0 1 2.5 5H3Zm1.5 0h3V3.5a1.5 1.5 0 0 0-3 0V5Z" />
      </svg>
      {children}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink-3">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}
