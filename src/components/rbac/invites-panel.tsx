"use client";

import clsx from "clsx";
import { useState } from "react";
import { api, errorMessage, firstFieldError } from "@/components/rbac/api";
import { PermissionChipList } from "@/components/rbac/permission-catalog";
import { ConfirmDialog, CopyButton } from "@/components/rbac/primitives";
import type { InviteDTO, PermissionCatalogDTO, RoleDTO } from "@/components/rbac/types";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  FormError,
  Input,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { dateTime, relative } from "@/lib/format";

/**
 * Staff cannot self-signup — an invite is the only door into an existing org, and it
 * carries the roles the new person will be created with. There is no mail server in a
 * hackathon, so the generated accept link is shown here with a copy button: that link
 * IS the staff-bootstrap story.
 */

export function InvitesPanel({
  invites,
  roles,
  catalog,
  onChanged,
}: {
  invites: InviteDTO[];
  roles: RoleDTO[];
  catalog: PermissionCatalogDTO | null;
  onChanged: () => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<InviteDTO | null>(null);
  const [revoking, setRevoking] = useState<InviteDTO | null>(null);
  const [revokePending, setRevokePending] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const byId = new Map(roles.map((r) => [r.id, r]));
  const preview = [
    ...new Set([...selected].flatMap((id) => byId.get(id)?.permissionKeys ?? [])),
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
      const res = await api<{ invite: InviteDTO; acceptUrl: string }>("/api/invites", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), email: email.trim(), roleIds: [...selected] }),
      });
      setCreated(res.invite);
      setName("");
      setEmail("");
      setSelected(new Set());
      await onChanged();
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  async function confirmRevoke() {
    if (!revoking) return;
    setRevokePending(true);
    setRevokeError(null);
    try {
      await api(`/api/invites/${revoking.token}/revoke`, { method: "POST" });
      setRevoking(null);
      await onChanged();
    } catch (err) {
      setRevokeError(errorMessage(err));
    } finally {
      setRevokePending(false);
    }
  }

  const canSubmit =
    name.trim().length >= 2 && email.trim().length > 3 && selected.size > 0 && !pending;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-5">
        {created ? (
          <div className="rounded-card border border-ok/40 bg-ok-soft px-4 py-3.5">
            <p className="text-[13px] font-semibold text-ok">
              Invitation created for {created.name} ({created.email})
            </p>
            <p className="mt-0.5 text-[12px] text-ink-2">
              There is no mail server here. Send them this link — it lets them set a password and be
              created inside {""}
              this organization with exactly the roles on the invite. It expires{" "}
              {relative(created.expiresAt)}.
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-surface px-2.5 py-1.5 font-mono text-[12px] text-ink-2">
                {created.acceptUrl}
              </code>
              <CopyButton value={created.acceptUrl} label="Copy link" />
              <Button variant="ghost" size="sm" onClick={() => setCreated(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        ) : null}

        <Card>
          <CardHeader
            title="Pending invitations"
            subtitle="Not yet accepted, not revoked, not expired. Scoped to this organization."
          />
          {invites.length === 0 ? (
            <EmptyState
              title="No pending invitations"
              hint="Invite someone with the form beside this list — they are created with exactly the roles you tick."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Invitee</Th>
                  <Th>Roles</Th>
                  <Th>Expires</Th>
                  <Th>Invited by</Th>
                  <Th className="text-right">Accept link</Th>
                </tr>
              </thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id}>
                    <Td>
                      <p className="text-[13px] font-medium text-ink">{i.name}</p>
                      <p className="text-[12px] text-ink-3">{i.email}</p>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {i.roles.map((r) => (
                          <Badge key={r.id} tone={r.isSystem ? "brand" : "neutral"}>
                            {r.name}
                          </Badge>
                        ))}
                      </div>
                    </Td>
                    <Td className="tnum whitespace-nowrap text-[12px] text-ink-2">
                      <span title={dateTime(i.expiresAt)}>{relative(i.expiresAt)}</span>
                    </Td>
                    <Td className="text-[12px] text-ink-2">{i.invitedBy?.name ?? "—"}</Td>
                    <Td className="text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <CopyButton value={i.acceptUrl} label="Copy" />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setRevokeError(null);
                            setRevoking(i);
                          }}
                        >
                          Revoke
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card className="h-fit">
        <CardHeader title="Invite a teammate" subtitle="Name, email, and the roles they start with." />
        <form
          className="space-y-3.5 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) void submit();
          }}
        >
          <FormError message={error ? errorMessage(error) : null} />

          <Field label="Full name" error={firstFieldError(error, "name")}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Dana Whitfield"
              maxLength={120}
            />
          </Field>

          <Field label="Email" error={firstFieldError(error, "email")}>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="dana@example.com"
            />
          </Field>

          <div>
            <p className="mb-1 text-[13px] font-medium text-ink-2">Roles</p>
            {roles.length === 0 ? (
              <p className="text-[12px] text-ink-3">Create a role first.</p>
            ) : (
              <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
                {roles.map((r) => {
                  const on = selected.has(r.id);
                  return (
                    <label
                      key={r.id}
                      className={clsx(
                        "flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[13px] transition-colors",
                        on ? "bg-brand-500/6" : "bg-surface hover:bg-surface-2",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(r.id)}
                        disabled={pending}
                        className="h-4 w-4 shrink-0 accent-brand-500"
                      />
                      <span className="min-w-0 flex-1 truncate text-ink">{r.name}</span>
                      <span className="tnum shrink-0 text-[11px] text-ink-3">
                        {r.permissionKeys.length}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            {firstFieldError(error, "roleIds") ? (
              <p className="mt-1 text-[12px] text-danger">{firstFieldError(error, "roleIds")}</p>
            ) : (
              <p className="mt-1 text-[12px] text-ink-3">At least one role is required.</p>
            )}
          </div>

          <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
            <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
              They will be able to
            </p>
            <PermissionChipList
              keys={preview}
              catalog={catalog}
              emptyLabel="Nothing yet — pick a role"
              tone="brand"
            />
          </div>

          <Button type="submit" variant="primary" className="w-full" disabled={!canSubmit}>
            {pending ? "Creating invitation…" : "Create invitation"}
          </Button>
          <p className="text-[11px] text-ink-3">
            We generate a one-time link valid for 7 days. Nothing is emailed.
          </p>
        </form>
      </Card>

      <ConfirmDialog
        open={revoking !== null}
        title={`Revoke the invitation for ${revoking?.email ?? ""}?`}
        confirmLabel="Revoke invitation"
        pending={revokePending}
        error={revokeError}
        onClose={() => setRevoking(null)}
        onConfirm={confirmRevoke}
        body={<p>The link stops working immediately. You can always issue a new one.</p>}
      />
    </div>
  );
}
