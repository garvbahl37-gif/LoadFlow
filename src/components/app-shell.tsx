import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import type { SessionUser } from "@/lib/auth/session";
import { can } from "@/lib/authz/guard";
import type { PermissionKey } from "@/lib/authz/permissions";
import { NavLink } from "@/components/nav-link";
import { ThemeToggle } from "@/components/theme-toggle";
import { SignOutButton } from "@/components/sign-out-button";

type NavItem = { href: string; label: string; permission?: PermissionKey };

function navFor(session: SessionUser): NavItem[] {
  switch (session.orgType) {
    case "BROKER":
      return [
        { href: "/broker", label: "Load board" },
        { href: "/broker/carriers", label: "Carriers & compliance" },
        { href: "/broker/staff", label: "Staff & roles", permission: "staff.manage" },
        { href: "/broker/audit", label: "Audit log", permission: "audit.view" },
      ];
    case "CARRIER":
      return [
        { href: "/carrier", label: "My loads" },
        { href: "/carrier/compliance", label: "Compliance" },
        { href: "/carrier/staff", label: "Staff & roles", permission: "staff.manage" },
        { href: "/carrier/audit", label: "Audit log", permission: "audit.view" },
      ];
    case "SHIPPER":
      return [{ href: "/shipper", label: "My shipments" }];
  }
}

const ORG_TONE = {
  BROKER: "brand",
  CARRIER: "info",
  SHIPPER: "ok",
} as const;

/**
 * The nav hides links the user has no permission for — but that is a courtesy, not
 * a control. Every one of these routes re-checks the permission server-side, and the
 * API behind them does too. Hiding a button never protects anything.
 */
export function AppShell({
  session,
  children,
}: {
  session: SessionUser;
  children: ReactNode;
}) {
  const items = navFor(session).filter((i) => !i.permission || can(session, i.permission));

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-5">
          <Link href="/" className="flex items-center gap-2">
            <LoadFlowMark />
            <span className="text-[15px] font-semibold tracking-tight text-ink">LoadFlow</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {items.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-[13px] leading-tight font-medium text-ink">{session.name}</p>
              <p className="text-[11px] leading-tight text-ink-3">
                {session.roles.length > 0
                  ? session.roles.map((r) => r.name).join(", ")
                  : "No role assigned"}
              </p>
            </div>
            <Badge tone={ORG_TONE[session.orgType]}>{session.orgName}</Badge>
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>

        {/* Mobile nav */}
        <nav className="flex items-center gap-1 overflow-x-auto border-t border-line px-4 py-1.5 md:hidden">
          {items.map((item) => (
            <NavLink key={item.href} href={item.href}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[1400px] flex-1 px-5 py-7">{children}</main>

      <footer className="border-t border-line px-5 py-3">
        <p className="mx-auto max-w-[1400px] text-[11px] text-ink-3">
          LoadFlow · every action on this page is re-authorized server-side — the UI only
          decides what to <em>show</em>, never what you may <em>do</em>.
        </p>
      </footer>
    </div>
  );
}

function LoadFlowMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
      <rect width="24" height="24" rx="6" className="fill-brand-500" />
      <path
        d="M5 15.5h3.2M5 12h6M5 8.5h9"
        className="stroke-[oklch(20%_0_0)]"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="17" cy="15" r="2.4" className="fill-[oklch(20%_0_0)]" />
    </svg>
  );
}
