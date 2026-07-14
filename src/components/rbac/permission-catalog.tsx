"use client";

import clsx from "clsx";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import type { PermissionCatalogDTO, PermissionDTO, RoleDTO } from "@/components/rbac/types";

/**
 * The permission catalog is a first-class object in this UI, not a checkbox list.
 * The KEY is rendered in mono next to the human label everywhere, because the key is
 * what the code actually checks — `can(session, "load.assign_carrier")`. Role names
 * are labels for humans; keys are the contract.
 */

// ── Chips ─────────────────────────────────────────────────────

export function PermissionChip({
  permissionKey,
  label,
  tone = "neutral",
  title,
}: {
  permissionKey: string;
  label?: string;
  tone?: "neutral" | "brand" | "muted";
  title?: string;
}) {
  return (
    <span
      title={title ?? label ?? permissionKey}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] whitespace-nowrap",
        tone === "brand" && "border-brand-500/30 bg-brand-500/10 text-brand-700 dark:text-brand-300",
        tone === "neutral" && "border-line-strong bg-surface-2 text-ink-2",
        tone === "muted" && "border-line bg-surface text-ink-3",
      )}
    >
      <span className="font-mono text-[10.5px] tracking-tight">{permissionKey}</span>
      {label ? <span className="hidden text-ink-3 sm:inline">· {label}</span> : null}
    </span>
  );
}

export function PermissionChipList({
  keys,
  catalog,
  emptyLabel = "No permissions",
  max,
  tone = "neutral",
}: {
  keys: string[];
  catalog?: PermissionCatalogDTO | null;
  emptyLabel?: string;
  max?: number;
  tone?: "neutral" | "brand" | "muted";
}) {
  if (keys.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] text-ink-3">
        {emptyLabel}
      </span>
    );
  }

  const byKey = new Map((catalog?.permissions ?? []).map((p) => [p.key, p]));
  const shown = max ? keys.slice(0, max) : keys;
  const hidden = keys.length - shown.length;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((k) => {
        const def = byKey.get(k);
        return (
          <PermissionChip
            key={k}
            permissionKey={k}
            label={def?.label}
            tone={tone}
            title={def ? `${def.label} — ${def.description}` : k}
          />
        );
      })}
      {hidden > 0 ? (
        <span className="tnum text-[11px] text-ink-3">+{hidden} more</span>
      ) : null}
    </div>
  );
}

// ── Picker (the role builder's core control) ──────────────────

export function PermissionPicker({
  catalog,
  selected,
  onToggle,
  disabled,
}: {
  catalog: PermissionCatalogDTO;
  selected: Set<string>;
  onToggle: (key: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-4">
      {catalog.groups.map((group) => (
        <div key={group.category}>
          <div className="mb-1.5 flex items-baseline justify-between">
            <h4 className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
              {group.category}
            </h4>
            <span className="tnum text-[11px] text-ink-3">
              {group.permissions.filter((p) => selected.has(p.key)).length}/
              {group.permissions.length} selected
            </span>
          </div>

          <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {group.permissions.map((p) => (
              <PermissionRow
                key={p.key}
                permission={p}
                checked={selected.has(p.key)}
                onToggle={() => onToggle(p.key)}
                disabled={disabled}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PermissionRow({
  permission,
  checked,
  onToggle,
  disabled,
}: {
  permission: PermissionDTO;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={clsx(
        "flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors",
        checked ? "bg-brand-500/6" : "bg-surface hover:bg-surface-2",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      />
      <span className="min-w-0">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[13px] font-medium text-ink">{permission.label}</span>
          <code className="rounded-xs bg-surface-2 px-1 font-mono text-[11px] text-ink-3">
            {permission.key}
          </code>
        </span>
        <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">
          {permission.description}
        </span>
      </span>
    </label>
  );
}

// ── The catalog, as a reference panel ─────────────────────────

/**
 * Every capability this org type can grant, and which of its roles currently grant
 * it. A permission nobody holds is a real finding — it means a capability is dark.
 */
export function CatalogReference({
  catalog,
  roles,
}: {
  catalog: PermissionCatalogDTO | null;
  roles: RoleDTO[];
}) {
  if (!catalog) return null;

  if (catalog.permissions.length === 0) {
    return (
      <Card>
        <CardHeader title="Permission catalog" />
        <EmptyState
          title="This organization type grants no permissions"
          hint="Shipper access is defined entirely by object-level scoping — they see their own freight, read-only."
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Permission catalog"
        subtitle={`${catalog.permissions.length} capabilities a ${catalog.orgType.toLowerCase()} organization may grant. The key on the right is the string the code checks.`}
      />
      <div className="divide-y divide-line">
        {catalog.groups.map((group) => (
          <div key={group.category} className="px-5 py-3.5">
            <h4 className="mb-2 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
              {group.category}
            </h4>
            <ul className="space-y-2.5">
              {group.permissions.map((p) => {
                const granting = roles.filter((r) => r.permissionKeys.includes(p.key));
                return (
                  <li key={p.key} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-[13px] font-medium text-ink">{p.label}</span>
                        <code className="rounded-xs bg-surface-2 px-1 font-mono text-[11px] text-ink-3">
                          {p.key}
                        </code>
                      </div>
                      <p className="mt-0.5 text-[12px] leading-snug text-ink-3">{p.description}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      {granting.length === 0 ? (
                        <span className="text-[11px] text-ink-3">granted by no role</span>
                      ) : (
                        <span className="text-[11px] text-ink-2">
                          {granting.map((r) => r.name).join(", ")}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}
