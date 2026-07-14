"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import clsx from "clsx";
import { Badge, EmptyState, Table, Td, Th } from "@/components/ui";
import { dateTime, relative } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/loads/state-machine";
import { humanizeAction, type AuditEntry } from "@/components/audit/types";

const COLUMNS = 6;

function statusLabel(status: string): string {
  return (STATUS_LABEL as Record<string, string>)[status] ?? status;
}

export function AuditTable({
  entries,
  loadHrefBase,
  filtered,
}: {
  entries: AuditEntry[];
  /** e.g. "/broker/loads" — the load reference deep-links back into the load. */
  loadHrefBase: string;
  filtered: boolean;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (entries.length === 0) {
    return (
      <EmptyState
        icon="∅"
        title={filtered ? "No audit entries match these filters" : "Nothing has happened yet"}
        hint={
          filtered
            ? "Clear the filters, or widen the search. Denied attempts are only recorded when someone actually tries something they cannot do."
            : "Every business event and every denied access attempt in this organization will appear here the moment it happens."
        }
      />
    );
  }

  return (
    <Table>
      <thead>
        <tr>
          <Th className="w-[132px]">When</Th>
          <Th className="w-[200px]">Actor</Th>
          <Th className="w-[210px]">Action</Th>
          <Th className="w-[150px]">Entity</Th>
          <Th className="w-[130px]">Load</Th>
          <Th>Outcome &amp; summary</Th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => {
          const denied = entry.outcome === "DENIED";
          const open = expanded[entry.id] ?? false;

          return (
            <Fragment key={entry.id}>
              <tr
                onClick={() => setExpanded((e) => ({ ...e, [entry.id]: !open }))}
                aria-expanded={open}
                className={clsx(
                  "cursor-pointer transition-colors",
                  denied
                    ? "bg-danger-soft/60 hover:bg-danger-soft"
                    : "hover:bg-surface-2",
                )}
              >
                <Td className={clsx("whitespace-nowrap", denied && "border-l-2 border-l-danger")}>
                  <span className="tnum block text-[13px] text-ink">{dateTime(entry.ts)}</span>
                  <span className="tnum block text-[11px] text-ink-3">{relative(entry.ts)}</span>
                </Td>

                <Td>
                  {entry.actor.email ? (
                    <>
                      <span className="block truncate text-[13px] font-medium text-ink">
                        {entry.actor.name ?? "Unknown"}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-ink-3">
                        {entry.actor.email}
                      </span>
                    </>
                  ) : (
                    <span className="text-[13px] text-ink-3">System</span>
                  )}
                </Td>

                <Td>
                  <span className="block text-[13px] text-ink">{humanizeAction(entry.action)}</span>
                  <span className="block truncate font-mono text-[11px] text-ink-3">
                    {entry.action}
                  </span>
                </Td>

                <Td>
                  <span className="block text-[13px] text-ink-2">{entry.entityType}</span>
                  {entry.entityId ? (
                    <span
                      className="block font-mono text-[11px] text-ink-3"
                      title={entry.entityId}
                    >
                      {entry.entityId.slice(0, 10)}…
                    </span>
                  ) : null}
                </Td>

                <Td onClick={(e) => e.stopPropagation()}>
                  {entry.load ? (
                    <Link
                      href={`${loadHrefBase}/${entry.load.id}`}
                      className="tnum font-mono text-[12px] font-medium text-brand-600 hover:underline dark:text-brand-400"
                    >
                      {entry.load.reference}
                    </Link>
                  ) : (
                    <span className="text-[12px] text-ink-3">—</span>
                  )}
                </Td>

                <Td>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {denied ? (
                      <Badge tone="danger">DENIED</Badge>
                    ) : (
                      <Badge tone="ok">Allowed</Badge>
                    )}

                    {entry.fromStatus && entry.toStatus ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-line-strong bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-2">
                        {statusLabel(entry.fromStatus)}
                        <span className="text-ink-3">→</span>
                        <span className="font-medium text-ink">{statusLabel(entry.toStatus)}</span>
                      </span>
                    ) : null}

                    {denied && entry.permission ? (
                      <span className="rounded-md border border-danger/40 bg-danger/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-danger">
                        missing: {entry.permission}
                      </span>
                    ) : null}
                  </div>
                  <p
                    className={clsx(
                      "mt-1 text-[13px]",
                      denied ? "font-medium text-danger" : "text-ink-2",
                    )}
                  >
                    {entry.summary}
                  </p>
                </Td>
              </tr>

              {open ? <DetailRow entry={entry} /> : null}
            </Fragment>
          );
        })}
      </tbody>
    </Table>
  );
}

function DetailRow({ entry }: { entry: AuditEntry }) {
  const denied = entry.outcome === "DENIED";
  const detail = (entry.detail ?? null) as Record<string, unknown> | null;
  const held = stringList(detail?.heldPermissions);
  const roles = stringList(detail?.roles);
  const rest = detail
    ? Object.fromEntries(
        Object.entries(detail).filter(([k]) => k !== "heldPermissions" && k !== "roles"),
      )
    : {};

  return (
    <tr className={clsx(denied ? "bg-danger-soft/40" : "bg-surface-2/60")}>
      <td colSpan={COLUMNS} className="border-b border-line px-4 py-4">
        <div className="grid gap-4 md:grid-cols-3">
          <DetailBlock label="Request">
            <dl className="space-y-1 text-[12px]">
              <Row k="Method / path">
                <span className="font-mono">
                  {entry.method ?? "—"} {entry.path ?? ""}
                </span>
              </Row>
              <Row k="Source IP">
                <span className="font-mono">{entry.ip ?? "—"}</span>
              </Row>
              <Row k="Entity id">
                <span className="font-mono break-all">{entry.entityId ?? "—"}</span>
              </Row>
              <Row k="Recorded at">
                <span className="tnum">{new Date(entry.ts).toISOString()}</span>
              </Row>
            </dl>
          </DetailBlock>

          <DetailBlock
            label={denied ? "Permission that was missing" : "Actor"}
            tone={denied ? "danger" : "neutral"}
          >
            {denied && entry.permission ? (
              <p className="mb-2 inline-block rounded-md border border-danger/40 bg-danger/10 px-2 py-1 font-mono text-[12px] font-semibold text-danger">
                {entry.permission}
              </p>
            ) : null}
            <dl className="space-y-1 text-[12px]">
              <Row k="Actor">{entry.actor.name ?? "System"}</Row>
              <Row k="Email">
                <span className="font-mono">{entry.actor.email ?? "—"}</span>
              </Row>
              <Row k="Roles held">
                {roles.length > 0 ? roles.join(", ") : <span className="text-ink-3">—</span>}
              </Row>
            </dl>
          </DetailBlock>

          <DetailBlock label={denied ? "Permissions the actor did hold" : "Detail"}>
            {held.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {held.map((p) => (
                  <span
                    key={p}
                    className="rounded-md border border-line-strong bg-surface px-1.5 py-0.5 font-mono text-[11px] text-ink-2"
                  >
                    {p}
                  </span>
                ))}
              </div>
            ) : denied ? (
              <p className="text-[12px] text-ink-3">
                None — this account holds no permissions at all.
              </p>
            ) : null}

            {Object.keys(rest).length > 0 ? (
              <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-line bg-surface p-2 font-mono text-[11px] text-ink-2">
                {JSON.stringify(rest, null, 2)}
              </pre>
            ) : held.length === 0 && !denied ? (
              <p className="text-[12px] text-ink-3">No additional detail recorded.</p>
            ) : null}
          </DetailBlock>
        </div>
      </td>
    </tr>
  );
}

function DetailBlock({
  label,
  tone = "neutral",
  children,
}: {
  label: string;
  tone?: "neutral" | "danger";
  children: React.ReactNode;
}) {
  return (
    <div
      className={clsx(
        "rounded-lg border p-3",
        tone === "danger" ? "border-danger/40 bg-surface" : "border-line bg-surface",
      )}
    >
      <p
        className={clsx(
          "mb-2 text-[11px] font-semibold tracking-wide uppercase",
          tone === "danger" ? "text-danger" : "text-ink-3",
        )}
      >
        {label}
      </p>
      {children}
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-ink-3">{k}</dt>
      <dd className="min-w-0 flex-1 text-ink-2">{children}</dd>
    </div>
  );
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
