"use client";

import { useState } from "react";
import { api, errorMessage, firstFieldError } from "@/components/rbac/api";
import { PermissionChipList, PermissionPicker } from "@/components/rbac/permission-catalog";
import { ConfirmDialog, Modal } from "@/components/rbac/primitives";
import type { PermissionCatalogDTO, RoleDTO } from "@/components/rbac/types";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  FormError,
  Input,
  LockedHint,
} from "@/components/ui";
import { fullDate } from "@/lib/format";

/**
 * THE ROLE BUILDER. This is where "Dispatcher = load.assign_carrier + rate.confirm"
 * and "Ops Lead = the same, plus load.override_compliance_flag" are authored by hand,
 * out of the catalog, at runtime. No role is hardcoded anywhere in the product.
 *
 * The only immutable role is the org's `isSystem` administrator — and even that is not
 * special-cased in any authorization check. It is simply a role that happens to hold
 * every permission. The API 409s on any attempt to edit or delete it; we say so up
 * front rather than letting the user discover it by failing.
 */

export function RolesPanel({
  roles,
  catalog,
  onChanged,
}: {
  roles: RoleDTO[];
  catalog: PermissionCatalogDTO | null;
  onChanged: () => Promise<void> | void;
}) {
  const [editing, setEditing] = useState<RoleDTO | "new" | null>(null);
  const [deleting, setDeleting] = useState<RoleDTO | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function confirmDelete() {
    if (!deleting) return;
    setDeletePending(true);
    setDeleteError(null);
    try {
      await api(`/api/roles/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      await onChanged();
    } catch (err) {
      // e.g. 409 "“Dispatcher” is still held by 1 user. Reassign them…"
      setDeleteError(errorMessage(err));
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Roles"
          subtitle="A role is a named bundle of permissions, owned by this organization. Its name means nothing to the code — the permissions inside it are what get checked."
          action={
            <Button variant="primary" onClick={() => setEditing("new")} disabled={!catalog}>
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 stroke-current" fill="none" aria-hidden>
                <path d="M8 3.5v9M3.5 8h9" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
              New role
            </Button>
          }
        />

        {roles.length === 0 ? (
          <EmptyState
            title="No roles yet"
            hint="Build one from the permission catalog — start with a dispatcher who can assign carriers and confirm rates."
          />
        ) : (
          <ul className="divide-y divide-line">
            {roles.map((role) => (
              <li key={role.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-ink">{role.name}</h3>
                      {role.isSystem ? (
                        <Badge tone="brand">
                          <LockIcon />
                          System role
                        </Badge>
                      ) : null}
                      {role.grantsStaffManage ? <Badge tone="warn">Can manage staff</Badge> : null}
                      <Badge tone="neutral">
                        <span className="tnum">{role.memberCount}</span>
                        {role.memberCount === 1 ? " member" : " members"}
                      </Badge>
                      <Badge tone="neutral">
                        <span className="tnum">{role.permissionKeys.length}</span>
                        {role.permissionKeys.length === 1 ? " permission" : " permissions"}
                      </Badge>
                    </div>

                    <p className="mt-1 text-[13px] text-ink-3">
                      {role.description ??
                        (role.isSystem
                          ? "The founding administrator role. Holds every permission applicable to this organization type."
                          : "No description.")}
                    </p>

                    <div className="mt-2.5">
                      <PermissionChipList
                        keys={role.permissionKeys}
                        catalog={catalog}
                        emptyLabel="No permissions — read-only"
                        tone={role.isSystem ? "brand" : "neutral"}
                      />
                    </div>

                    {role.isSystem ? (
                      <p className="mt-2 max-w-2xl text-[12px] text-ink-3">
                        Locked. This is the role the organization was founded with — it is not
                        special-cased in the code, it simply contains every permission. Making it
                        editable would let an org rewrite the meaning of “administrator” out from
                        under its own audit trail, so the API rejects any change to it. Create a
                        custom role instead.
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {role.isSystem ? (
                      <LockedHint>Immutable</LockedHint>
                    ) : (
                      <>
                        <Button size="sm" onClick={() => setEditing(role)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setDeleteError(null);
                            setDeleting(role);
                          }}
                        >
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                <p className="mt-2 text-[11px] text-ink-3">
                  Created {fullDate(role.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {catalog && editing ? (
        <RoleBuilderDialog
          catalog={catalog}
          role={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await onChanged();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete “${deleting?.name ?? ""}”?`}
        confirmLabel="Delete role"
        pending={deletePending}
        error={deleteError}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        body={
          <>
            <p>
              Anyone holding this role loses its permissions on their <strong>next request</strong> —
              sessions are database-backed, so nobody has to sign out and back in.
            </p>
            {deleting && deleting.memberCount > 0 ? (
              <p className="text-warn">
                {deleting.memberCount} {deleting.memberCount === 1 ? "person" : "people"} still hold
                this role. The API will refuse until they are reassigned.
              </p>
            ) : null}
          </>
        }
      />
    </>
  );
}

// ── The builder itself ────────────────────────────────────────

function RoleBuilderDialog({
  catalog,
  role,
  onClose,
  onSaved,
}: {
  catalog: PermissionCatalogDTO;
  role: RoleDTO | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const isEdit = role !== null;
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permissionKeys ?? []));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        permissionKeys: [...selected],
      };
      if (isEdit) {
        await api(`/api/roles/${role.id}`, {
          method: "PATCH",
          body: JSON.stringify({ ...payload, description: description.trim() || null }),
        });
      } else {
        await api("/api/roles", { method: "POST", body: JSON.stringify(payload) });
      }
      await onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  const affected = role?.memberCount ?? 0;

  return (
    <Modal
      open
      width="xl"
      onClose={onClose}
      title={isEdit ? `Edit role — ${role.name}` : "New role"}
      subtitle={
        isEdit
          ? `Re-bundling this role changes what ${affected} ${affected === 1 ? "person" : "people"} may do, on their next request.`
          : `Tick the capabilities this role grants. Only permissions applicable to a ${catalog.orgType.toLowerCase()} organization are offered — the server rejects the rest even if you forge them.`
      }
      footer={
        <>
          <span className="tnum mr-auto text-[12px] text-ink-3">
            {selected.size} of {catalog.permissions.length} permissions selected
          </span>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={pending || name.trim().length < 2}>
            {pending ? "Saving…" : isEdit ? "Save changes" : "Create role"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={error ? errorMessage(error) : null} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Role name"
            error={firstFieldError(error, "name")}
            hint="Purely a label for humans. Nothing in the code ever reads it."
          >
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Dispatcher"
              autoFocus
              maxLength={60}
            />
          </Field>
          <Field label="Description" error={firstFieldError(error, "description")}>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Assigns carriers and confirms rates. Cannot override compliance."
              maxLength={300}
            />
          </Field>
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-[13px] font-semibold text-ink">Permissions</h3>
            {selected.size === 0 ? (
              <span className="text-[12px] text-ink-3">
                Zero permissions is valid — that is a read-only role.
              </span>
            ) : null}
          </div>
          <PermissionPicker
            catalog={catalog}
            selected={selected}
            onToggle={toggle}
            disabled={pending}
          />
        </div>

        {selected.has("staff.manage") ? (
          <div className="rounded-lg border border-warn/40 bg-warn-soft px-3 py-2 text-[12px] text-warn">
            Anyone with this role will be able to build roles, invite staff and change permissions —
            including their own.
          </div>
        ) : null}

        {isEdit && role.grantsStaffManage && !selected.has("staff.manage") ? (
          <div className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[12px] text-danger">
            You are removing <code className="font-mono">staff.manage</code> from this role. If it is
            the last role granting it to an active user, the API will refuse the change — an
            organization must never lock itself out.
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3 fill-current" aria-hidden>
      <path d="M3 5V3.5a3 3 0 1 1 6 0V5h.5A1.5 1.5 0 0 1 11 6.5v3A1.5 1.5 0 0 1 9.5 11h-7A1.5 1.5 0 0 1 1 9.5v-3A1.5 1.5 0 0 1 2.5 5H3Zm1.5 0h3V3.5a1.5 1.5 0 0 0-3 0V5Z" />
    </svg>
  );
}
