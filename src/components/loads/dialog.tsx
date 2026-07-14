"use client";

import { useEffect, type ReactNode } from "react";

/**
 * A minimal modal. No dependency, no portal — every dialog in the product is a form
 * that posts to the API, so it only has to be focusable, escapable and unmissable.
 */
export function Dialog({
  title,
  subtitle,
  onClose,
  children,
  width = "max-w-lg",
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-[8vh] backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`w-full ${width} rounded-card border border-line bg-surface shadow-lg`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mt-1 -mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            <svg viewBox="0 0 14 14" className="h-3.5 w-3.5 stroke-current" aria-hidden>
              <path d="M3 3l8 8M11 3l-8 8" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
