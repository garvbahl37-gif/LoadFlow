"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { buttonClass, Spinner } from "@/components/ui";

/**
 * A navigation control that looks like a Button and shows a spinner the INSTANT it is
 * clicked, until the destination has rendered. `useLinkStatus` only reports pending state
 * for a Link it is rendered inside, so the spinner lives in a child component.
 *
 * This is why the app feels responsive: every navigation button gives immediate feedback,
 * rather than sitting inert while the (fast, but not instant) server render happens.
 */
type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

function PendingSpinner() {
  const { pending } = useLinkStatus();
  return pending ? <Spinner /> : null;
}

export function LinkButton({
  href,
  variant = "secondary",
  size = "md",
  className,
  children,
  prefetch,
  ...rest
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
  prefetch?: ComponentProps<typeof Link>["prefetch"];
}) {
  return (
    <Link href={href} prefetch={prefetch} className={buttonClass(variant, size, className)} {...rest}>
      <PendingSpinner />
      {children}
    </Link>
  );
}
