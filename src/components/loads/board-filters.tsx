"use client";

import { useRouter } from "next/navigation";
import {useState, useTransition } from "react";
import type { LoadStatus } from "@/generated/prisma/enums";
import { Button, Input, Select } from "@/components/ui";
import { LOAD_STATUSES, STATUS_LABEL } from "@/lib/loads/state-machine";

/**
 * Search + filter, driven entirely through the URL.
 *
 * The board itself is a Server Component reading `await searchParams`, so every view
 * here is a real, shareable, back-buttonable URL — and the query it produces is ANDed
 * with the caller's load scope on the server. A filter can only ever narrow what the
 * session may already see; it can never widen it.
 */
export function BoardFilters({
  q,
  status,
  carrierOrgId,
  flagged,
  carriers,
  total,
}: {
  q: string;
  status: string;
  carrierOrgId: string;
  flagged: boolean;
  carriers: Array<{ id: string; name: string }>;
  total: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [term, setTerm] = useState(q);

  useEffect(() => setTerm(q), [q]);

  function push(next: Partial<Record<string, string | null>>) {
    const params = new URLSearchParams();
    const merged: Record<string, string | null> = {
      q: term.trim() || null,
      status: status || null,
      carrierOrgId: carrierOrgId || null,
      flagged: flagged ? "true" : null,
      ...next,
    };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    startTransition(() => router.push(query ? `/broker?${query}` : "/broker"));
  }

  const dirty = Boolean(q || status || carrierOrgId || flagged);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          push({ q: term.trim() || null });
        }}
      >
        <svg
          viewBox="0 0 16 16"
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 fill-none stroke-ink-3"
        >
          <circle cx="7" cy="7" r="4.5" strokeWidth="1.5" />
          <path d="M10.5 10.5 14 14" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Reference, lane, commodity, carrier…"
          aria-label="Search loads"
          className="w-64 pl-8"
        />
      </form>

      <Select
        aria-label="Filter by status"
        value={status}
        onChange={(e) => push({ status: e.target.value || null })}
        className="w-44"
      >
        <option value="">All statuses</option>
        {LOAD_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s as LoadStatus]}
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by carrier"
        value={carrierOrgId}
        onChange={(e) => push({ carrierOrgId: e.target.value || null })}
        className="w-52"
      >
        <option value="">All carriers</option>
        {carriers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>

      <Button
        variant={flagged ? "primary" : "secondary"}
        onClick={() => push({ flagged: flagged ? null : "true" })}
      >
        Blocked only
      </Button>

      {dirty ? (
        <Button variant="ghost" onClick={() => startTransition(() => router.push("/broker"))}>
          Clear
        </Button>
      ) : null}

      <span className="tnum ml-auto text-[12px] text-ink-3">
        {pending ? "Filtering…" : `${total} ${total === 1 ? "load" : "loads"}`}
      </span>
    </div>
  );
}
