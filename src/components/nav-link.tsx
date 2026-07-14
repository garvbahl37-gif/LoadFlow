"use client";

import clsx from "clsx";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Shows a spinner the instant this link is clicked, until the destination renders. */
function NavPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className="ml-1 inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent align-middle"
    />
  );
}

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  // "/broker" should not light up while you're on "/broker/staff".
  const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

  return (
    <Link
      href={href}
      className={clsx(
        "flex items-center rounded-lg px-2.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors",
        active ? "bg-surface-2 text-ink" : "text-ink-3 hover:bg-surface-2 hover:text-ink-2",
      )}
    >
      {children}
      <NavPending />
    </Link>
  );
}
