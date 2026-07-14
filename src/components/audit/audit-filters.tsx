"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {useRef, useState, useTransition } from "react";
import clsx from "clsx";
import { Button, Input, Select } from "@/components/ui";
import {
  AUDIT_PAGE_SIZE,
  hasActiveFilters,
  humanizeAction,
  type AuditFacets,
  type AuditQuery,
} from "@/components/audit/types";

/**
 * Filters live in the URL, not in component state: an auditor can bookmark
 * "every denied attempt by dispatch@" and paste it into a ticket. The server
 * component re-reads `searchParams` and re-queries the API on every change.
 */
export function AuditFilters({
  basePath,
  query,
  facets,
}: {
  basePath: string;
  query: AuditQuery;
  facets: AuditFacets;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(query.q);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the box in sync when the URL changes underneath us (back button, Clear).
  useEffect(() => {
    setText(query.q);
  }, [query.q]);

  function push(mutate: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    params.delete("limit"); // a new filter starts a fresh page
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${basePath}?${qs}` : basePath, { scroll: false }));
  }

  function setParam(key: string, value: string) {
    push((params) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
  }

  function onSearchChange(value: string) {
    setText(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setParam("q", value.trim()), 300);
  }

  const active = hasActiveFilters(query);

  return (
    <div
      className={clsx(
        "flex flex-wrap items-center gap-2 transition-opacity",
        pending && "opacity-60",
      )}
    >
      {/* The point of the whole page: one click to every blocked attempt. */}
      <button
        type="button"
        aria-pressed={query.deniedOnly}
        onClick={() => setParam("outcome", query.deniedOnly ? "" : "DENIED")}
        className={clsx(
          "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
          query.deniedOnly
            ? "border-danger bg-danger text-white"
            : facets.deniedCount > 0
              ? "border-danger/40 bg-danger-soft text-danger hover:border-danger"
              : "border-line-strong bg-surface text-ink-3 hover:bg-surface-2",
        )}
      >
        <svg viewBox="0 0 12 12" className="h-3 w-3 fill-current" aria-hidden>
          <path d="M6 0a6 6 0 1 0 0 12A6 6 0 0 0 6 0Zm0 2.6a.7.7 0 0 1 .7.7v3a.7.7 0 0 1-1.4 0v-3a.7.7 0 0 1 .7-.7Zm0 5.4a.85.85 0 1 1 0 1.7.85.85 0 0 1 0-1.7Z" />
        </svg>
        Denied attempts only
        <span
          className={clsx(
            "tnum rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
            query.deniedOnly ? "bg-white/20 text-white" : "bg-danger/15 text-danger",
          )}
        >
          {facets.deniedCount}
        </span>
      </button>

      <div className="relative">
        <svg
          viewBox="0 0 14 14"
          className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 fill-none stroke-current stroke-[1.6] text-ink-3"
          aria-hidden
        >
          <circle cx="6" cy="6" r="4.2" />
          <path d="M9.2 9.2 12.5 12.5" strokeLinecap="round" />
        </svg>
        <Input
          value={text}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search summary, actor, action…"
          aria-label="Search the audit trail"
          className="w-72 pl-8"
        />
      </div>

      <Select
        value={query.action}
        aria-label="Filter by action"
        onChange={(e) => setParam("action", e.target.value)}
        className="w-56"
      >
        <option value="">All actions ({facets.total})</option>
        {facets.actions.map((a) => (
          <option key={a.action} value={a.action}>
            {humanizeAction(a.action)} ({a.count})
          </option>
        ))}
      </Select>

      {query.loadId ? (
        <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong bg-surface-2 px-2.5 text-[12px] text-ink-2">
          Load <span className="font-mono">{query.loadId.slice(0, 8)}</span>
        </span>
      ) : null}

      {active ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            startTransition(() => router.push(basePath, { scroll: false }))
          }
        >
          Clear filters
        </Button>
      ) : null}

      <span
        className="ml-auto text-[12px] text-ink-3"
        role="status"
        aria-live="polite"
      >
        {pending
          ? "Refreshing…"
          : query.limit > AUDIT_PAGE_SIZE
            ? `Showing up to ${query.limit} rows`
            : null}
      </span>
    </div>
  );
}
