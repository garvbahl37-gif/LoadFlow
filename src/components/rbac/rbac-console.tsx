"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/components/rbac/api";
import { CatalogReference } from "@/components/rbac/permission-catalog";
import { Skeleton, Tabs } from "@/components/rbac/primitives";
import { InvitesPanel } from "@/components/rbac/invites-panel";
import { RolesPanel } from "@/components/rbac/roles-panel";
import { StaffPanel } from "@/components/rbac/staff-panel";
import type {
  InviteDTO,
  PermissionCatalogDTO,
  RoleDTO,
  StaffDTO,
} from "@/components/rbac/types";
import { Button, Card, FormError, PageHeader, Stat } from "@/components/ui";

/**
 * THE RBAC CONSOLE — org-type agnostic. It renders whatever the API says this org may
 * grant: /api/permissions returns the catalog already filtered by the caller's org
 * type, so a carrier admin is never even offered `load.create`, and a broker is never
 * offered `pod.upload`. One console, two org types, zero branching on org type here.
 *
 * Every read and every write on this screen is an authenticated, authorized, org-scoped
 * call to the REST API. Nothing on this page has a privileged path around it.
 */

type Tab = "roles" | "staff" | "invites";

type ConsoleData = {
  catalog: PermissionCatalogDTO;
  roles: RoleDTO[];
  staff: StaffDTO[];
  invites: InviteDTO[];
};

/** Everything the console shows, in one round trip. Four authorized, org-scoped reads. */
async function fetchConsole(): Promise<ConsoleData> {
  const [catalog, roles, staff, invites] = await Promise.all([
    api<PermissionCatalogDTO>("/api/permissions"),
    api<{ roles: RoleDTO[] }>("/api/roles"),
    api<{ staff: StaffDTO[] }>("/api/staff"),
    api<{ invites: InviteDTO[] }>("/api/invites"),
  ]);
  return { catalog, roles: roles.roles, staff: staff.staff, invites: invites.invites };
}

export function RbacConsole({ orgName }: { orgName: string }) {
  const [data, setData] = useState<ConsoleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("roles");

  useEffect(() => {
    let live = true;
    fetchConsole()
      .then((d) => {
        if (!live) return;
        setData(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setLoadError(errorMessage(err));
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  /** Called after every successful mutation — the API is the only source of truth. */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await fetchConsole());
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  const catalog = data?.catalog ?? null;
  const roles = data?.roles ?? [];
  const staff = data?.staff ?? [];
  const invites = data?.invites ?? [];

  const activeStaff = staff.filter((s) => s.status === "ACTIVE");
  const admins = activeStaff.filter((s) => s.canManageStaff);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff & roles"
        subtitle={`${orgName} · roles are bundles of permissions, authored here at runtime.`}
        action={
          <Button variant="ghost" onClick={() => void refresh()} disabled={loading || refreshing}>
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 stroke-current" fill="none" aria-hidden>
              <path
                d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13 2v3h-3"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />

      <Explainer />

      {loadError ? <FormError message={loadError} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="People"
          value={loading ? "—" : activeStaff.length}
          hint={
            loading
              ? undefined
              : `${staff.length - activeStaff.length} disabled · ${staff.length} total`
          }
        />
        <Stat
          label="Roles"
          value={loading ? "—" : roles.length}
          hint={loading ? undefined : `${roles.filter((r) => !r.isSystem).length} custom-built`}
        />
        <Stat
          label="Can manage staff"
          value={loading ? "—" : admins.length}
          tone={!loading && admins.length === 1 ? "warn" : "neutral"}
          hint={
            loading
              ? undefined
              : admins.length === 1
                ? "Only one — the org cannot disable them"
                : "Active holders of staff.manage"
          }
        />
        <Stat
          label="Pending invites"
          value={loading ? "—" : invites.length}
          tone={!loading && invites.length > 0 ? "info" : "neutral"}
          hint={loading ? undefined : "Awaiting acceptance"}
        />
      </div>

      <Tabs<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "roles", label: "Roles", count: loading ? undefined : roles.length },
          { id: "staff", label: "People", count: loading ? undefined : staff.length },
          { id: "invites", label: "Invitations", count: loading ? undefined : invites.length },
        ]}
      />

      {loading ? (
        <LoadingState />
      ) : tab === "roles" ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_440px]">
          <RolesPanel roles={roles} catalog={catalog} onChanged={refresh} />
          <CatalogReference catalog={catalog} roles={roles} />
        </div>
      ) : tab === "staff" ? (
        <StaffPanel staff={staff} roles={roles} catalog={catalog} onChanged={refresh} />
      ) : (
        <InvitesPanel invites={invites} roles={roles} catalog={catalog} onChanged={refresh} />
      )}
    </div>
  );
}

/** The one-paragraph statement of what this screen actually is. */
function Explainer() {
  return (
    <Card className="flex flex-wrap items-start gap-x-6 gap-y-2 px-5 py-3.5">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-[11px] font-bold text-brand-700 dark:text-brand-300">
          i
        </span>
        <p className="min-w-0 text-[13px] leading-relaxed text-ink-2">
          <strong className="text-ink">Roles are bundles of permissions</strong> — you build them
          here, out of the fixed catalog on the right, and their names mean nothing to the system.
          Every authorization check in the codebase reads a permission key (
          <code className="rounded-xs bg-surface-2 px-1 font-mono text-[12px] text-ink-2">
            can(session, &quot;load.assign_carrier&quot;)
          </code>
          ), never a role name. Changing someone&apos;s roles takes effect on their{" "}
          <strong className="text-ink">next request</strong> — sessions are database-backed, so
          nobody has to sign out and back in.
        </p>
      </div>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3">
      <Card className="space-y-3 px-5 py-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-6 w-full" />
      </Card>
      <Card className="space-y-3 px-5 py-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-6 w-full" />
      </Card>
    </div>
  );
}
