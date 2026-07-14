"use client";

import clsx from "clsx";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";

/* Small pieces the RBAC console leans on that aren't general enough for ui.tsx. */

// ── Modal ─────────────────────────────────────────────────────

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = "lg",
}: {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: "md" | "lg" | "xl";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const max = { md: "max-w-md", lg: "max-w-2xl", xl: "max-w-3xl" }[width];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={clsx(
          "w-full rounded-card border border-line bg-surface shadow-xs",
          max,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4 stroke-current" fill="none" aria-hidden>
              <path d="M4 4l8 8M12 4l-8 8" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="max-h-[65vh] overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Confirm dialog ────────────────────────────────────────────

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  pending,
  error,
  onConfirm,
  onClose,
  danger = true,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
  danger?: boolean;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      width="md"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={danger ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px] text-ink-2">
        {body}
        {error ? (
          <div className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

// ── Copy button ───────────────────────────────────────────────

export function CopyButton({
  value,
  label = "Copy",
  size = "sm",
}: {
  value: string;
  label?: string;
  size?: "sm" | "md";
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API is unavailable over plain HTTP on some hosts — fall back.
      const el = document.createElement("textarea");
      el.value = value;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
  }

  return (
    <Button type="button" size={size} onClick={copy} variant="secondary">
      {copied ? (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 stroke-ok" fill="none" aria-hidden>
          <path d="M3.5 8.5l3 3 6-7" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 stroke-current" fill="none" aria-hidden>
          <rect x="5.75" y="5.75" width="7.5" height="7.5" rx="1.5" strokeWidth="1.3" />
          <path d="M10.25 3.75A1.5 1.5 0 0 0 8.75 2.25h-5a1.5 1.5 0 0 0-1.5 1.5v5a1.5 1.5 0 0 0 1.5 1.5" strokeWidth="1.3" />
        </svg>
      )}
      {copied ? "Copied" : label}
    </Button>
  );
}

// ── Tabs ──────────────────────────────────────────────────────

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string; count?: number }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="flex items-center gap-1 border-b border-line">
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={clsx(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
              on
                ? "border-brand-500 text-ink"
                : "border-transparent text-ink-3 hover:text-ink-2",
            )}
          >
            {t.label}
            {t.count !== undefined ? (
              <span
                className={clsx(
                  "tnum rounded-md px-1.5 py-0.5 text-[11px]",
                  on ? "bg-brand-500/15 text-brand-700 dark:text-brand-300" : "bg-surface-2 text-ink-3",
                )}
              >
                {t.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-md bg-surface-2", className)} />;
}
