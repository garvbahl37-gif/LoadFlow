"use client";

import clsx from "clsx";
import { useState } from "react";
import { api, errorMessage } from "@/components/rbac/api";
import { PermissionChipList } from "@/components/rbac/permission-catalog";
import { ConfirmDialog, Modal } from "@/components/rbac/primitives";
import type { PermissionCatalogDTO, RoleDTO, StaffDTO } from "@/components/rbac/types";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  FormError,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { dateTime, relative } from "@/lib/format";

/**
 * The staff list makes "a role is a bundle of permissions" visceral: every person
 * shows the roles they hold AND the union those roles resolve to — the exact set
 * `can()` will consult on their next request.
 *
 * Both mutations here (re-role, disable/enable) go through PATCH /api/staff/[userId],
 * which re-checks `staff.manage`, re-scopes the user to the caller's org (404 if not),
 * and refuses inside the transaction if the change would leave the org with nobody
 * able to manage staff (409). We surface that message verbatim.
 */

export function StaffPanel({
  staff,
  roles,
  catalog,
  onChanged,
}: {
  staff: StaffDTO[];
  roles: RoleDTO[];
  catalog: PermissionCatalogDTO | null;
  onChanged: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState<StaffDTO | null>(null);
  const [toggling, setToggling] = useState<StaffDTO | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmToggle() {
    if (!toggling) return;
    const next = toggling.status === "ACTIVE" ? "DISABLED" : "ACTIVE";
    setPending(true);
    setError(null);
    try {
      await api(`/api/staff/${toggling.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      setToggling(null);
      await onChanged();
    } catch (err) {
      // The lockout guard lands here: "That change would leave this organization with
      // nobody able to manage staff and roles."
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader
          title="People"
          subtitle="Roles are editable here. Effective permissions are the union across every role a person holds — that union is what the authorization engine checks, per request."
        />

        {staff.length === 0 ? (
          <EmptyState title="Nobody here yet" hint="Invite your first teammate to get started." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>Roles</Th>
                <Th>Effective permissions</Th>
                <Th>Status</Th>
                <Th>Last sign-in</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {staff.map((m) => (
                <tr
                  key={m.id}
                  className={clsx(m.status === "DISABLED" && "bg-surface-2/60")}
                >
                  <Td>
                    <div className="flex items-center gap-2">
                      <Avatar name={m.name} muted={m.status === "DISABLED"} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] font-medium text-ink">{m.name}</span>
                          {m.isSelf ? <Badge tone="info">You</Badge> : null}
                        </div>
                        <p className="text-[12px] text-ink-3">{m.email}</p>
                      </div>
                    </div>
                  </Td>

                  <Td>
                    {m.roles.length === 0 ? (
                      <span className="text-[12px] text-ink-3">No role</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {m.roles.map((r) => (
                          <Badge key={r.id} tone={r.isSystem ? "brand" : "neutral"}>
                            {r.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </Td>

                  <Td className="max-w-[380px]">
                    <PermissionChipList
                      keys={m.effectivePermissions}
                      catalog={catalog}
                      emptyLabel="No permissions — read-only"
                      max={4}
                    />
                  </Td>

                  <Td>
                    {m.status === "ACTIVE" ? (
                      <Badge tone="ok">Active</Badge>
                    ) : (
                      <Badge tone="danger">Disabled</Badge>
                    )}
                  </Td>

                  <Td className="tnum whitespace-nowrap text-[12px] text-ink-2">
                    {m.lastLoginAt ? (
                      <span title={dateTime(m.lastLoginAt)}>{relative(m.lastLoginAt)}</span>
                    ) : (
                      <span className="text-ink-3">Never</span>
                    )}
                  </Td>

                  <Td className="text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <Button size="sm" onClick={() => setEditing(m)}>
                        Edit roles
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setError(null);
                          setToggling(m);
                        }}
                      >
                        {m.status === "ACTIVE" ? "Disable" : "Enable"}
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {editing ? (
        <RoleAssignDialog
          member={editing}
          roles={roles}
          catalog={catalog}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onChanged();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={toggling !== null}
        title={
          toggling?.status === "ACTIVE"
            ? `Disable ${toggling?.isSelf ? "your own account" : (toggling?.name ?? "")}?`
            : `Re-activate ${toggling?.name ?? ""}?`
        }
        confirmLabel={toggling?.status === "ACTIVE" ? "Disable account" : "Re-activate"}
        danger={toggling?.status === "ACTIVE"}
        pending={pending}
        error={error}
        onClose={() => setToggling(null)}
        onConfirm={confirmToggle}
        body={
          toggling?.status === "ACTIVE" ? (
            <>
              <p>
                Their live sessions are deleted immediately — they are signed out on their very next
                request, not whenever a token happens to expire.
              </p>
              {toggling?.canManageStaff ? (
                <p className="text-warn">
                  This person can manage staff. If they are the last active one who can, the API
                  will refuse.
                </p>
              ) : null}
            </>
          ) : (
            <p>They will be able to sign in again with the roles they already hold.</p>
          )
        }
      />
    </>
  );
}

// ── Role assignment ───────────────────────────────────────────

function RoleAssignDialog({
  member,
  roles,
  catalog,
  onClose,
  onSaved,
}: {
  member: StaffDTO;
  roles: RoleDTO[];
  catalog: PermissionCatalogDTO | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(member.roles.map((r) => r.id)));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byId = new Map(roles.map((r) => [r.id, r]));

  // The same union the server computes — previewed live, before you commit.
  const preview = [
    ...new Set(
      [...selected].flatMap((id) => byId.get(id)?.permissionKeys ?? []),
    ),
  ].sort();

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    setPending(true);
    setError(null);
    try {
      await api(`/api/staff/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify({ roleIds: [...selected] }),
      });
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open
      width="lg"
      onClose={onClose}
      title={`Roles — ${member.name}`}
      subtitle={`${member.email} · changes take effect on their next request; sessions are database-backed.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={pending}>
            {pending ? "Saving…" : "Save roles"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error} />

        {roles.length === 0 ? (
          <p className="text-[13px] text-ink-3">This organization has no roles yet.</p>
        ) : (
          <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {roles.map((r) => {
              const on = selected.has(r.id);
              return (
                <label
                  key={r.id}
                  className={clsx(
                    "flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors",
                    on ? "bg-brand-500/6" : "bg-surface hover:bg-surface-2",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(r.id)}
                    disabled={pending}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-ink">{r.name}</span>
                      {r.isSystem ? <Badge tone="brand">System</Badge> : null}
                      <span className="tnum text-[11px] text-ink-3">
                        {r.permissionKeys.length} permission
                        {r.permissionKeys.length === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="mt-1 block">
                      <PermissionChipList
                        keys={r.permissionKeys}
                        catalog={catalog}
                        emptyLabel="No permissions"
                        tone="muted"
                      />
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}

        <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
          <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
            Effective permissions after saving
          </p>
          <PermissionChipList
            keys={preview}
            catalog={catalog}
            emptyLabel="None — this person would be read-only"
            tone="brand"
          />
        </div>
      </div>
    </Modal>
  );
}

function Avatar({ name, muted }: { name: string; muted?: boolean }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      className={clsx(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line text-[11px] font-semibold",
        muted ? "bg-surface-2 text-ink-3" : "bg-brand-500/15 text-brand-700 dark:text-brand-300",
      )}
      aria-hidden
    >
      {initials || "?"}
    </span>
  );
}
