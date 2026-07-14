import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AcceptInviteForm } from "@/components/auth/accept-invite-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { Badge, Button, Card } from "@/components/ui";
import { previewInvite } from "@/lib/auth/bootstrap";

export const metadata: Metadata = {
  title: "Accept your invitation — LoadFlow",
};

const ORG_KIND: Record<string, string> = {
  BROKER: "Broker",
  CARRIER: "Carrier",
  SHIPPER: "Shipper",
};

/** A terminal state: the token is real but unusable, or was never real at all. */
function DeadEnd({
  tone,
  title,
  body,
  icon,
}: {
  tone: "danger" | "warn" | "info";
  title: string;
  body: ReactNode;
  icon: ReactNode;
}) {
  const ring = {
    danger: "border-danger/40 bg-danger-soft text-danger",
    warn: "border-warn/40 bg-warn-soft text-warn",
    info: "border-info/40 bg-info-soft text-info",
  }[tone];

  return (
    <Card className="p-6">
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg border ${ring}`}>
        {icon}
      </div>
      <h1 className="mt-4 text-lg font-semibold tracking-tight text-ink">{title}</h1>
      <div className="mt-1.5 space-y-2 text-[13px] leading-relaxed text-ink-2">{body}</div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link href="/login">
          <Button variant="secondary" size="sm">
            Go to sign in
          </Button>
        </Link>
      </div>
    </Card>
  );
}

const IconX = (
  <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden>
    <path d="M4.5 3.44 8 6.94l3.5-3.5 1.06 1.06-3.5 3.5 3.5 3.5-1.06 1.06-3.5-3.5-3.5 3.5L3.44 11.5l3.5-3.5-3.5-3.5L4.5 3.44Z" />
  </svg>
);
const IconClock = (
  <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden>
    <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm.75 3.5v3.19l2.03 2.03-1.06 1.06-2.47-2.47V4.5h1.5Z" />
  </svg>
);
const IconCheck = (
  <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden>
    <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-6.5 6.5a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 1 1 1.06-1.06l2.47 2.47 5.97-5.97a.75.75 0 0 1 1.06 0Z" />
  </svg>
);

export default async function InvitePage({
  params,
}: {
  // Next 16: params is a Promise.
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Server component — call the service directly. No point round-tripping our own API.
  const invite = await previewInvite(token);

  const shell = (children: ReactNode) => (
    <AuthShell
      aside={
        <Link href="/login">
          <Button size="sm" variant="secondary">
            Sign in
          </Button>
        </Link>
      }
    >
      <div className="mx-auto w-full max-w-lg">{children}</div>
    </AuthShell>
  );

  if (!invite) {
    return shell(
      <DeadEnd
        tone="danger"
        icon={IconX}
        title="That invitation link isn't valid"
        body={
          <>
            <p>
              We don&apos;t recognise this token. It may have been mistyped, truncated by
              an email client, or revoked by an administrator — we deliberately do not
              distinguish between those, so this page can&apos;t be used to probe for
              live invitations.
            </p>
            <p>Ask whoever invited you to issue a fresh link.</p>
          </>
        }
      />,
    );
  }

  if (invite.revoked) {
    return shell(
      <DeadEnd
        tone="danger"
        icon={IconX}
        title="This invitation was revoked"
        body={
          <p>
            An administrator at <strong className="text-ink">{invite.orgName}</strong>{" "}
            withdrew this invitation before it was used. If that was a mistake, ask them
            to send a new one.
          </p>
        }
      />,
    );
  }

  if (invite.used) {
    return shell(
      <DeadEnd
        tone="info"
        icon={IconCheck}
        title="This invitation has already been used"
        body={
          <>
            <p>
              An account for{" "}
              <span className="font-mono text-[12.5px] text-ink">{invite.email}</span>{" "}
              already exists at{" "}
              <strong className="text-ink">{invite.orgName}</strong>. Invitations are
              single-use — the token is spent the moment the account is created.
            </p>
            <p>If that account is yours, just sign in.</p>
          </>
        }
      />,
    );
  }

  if (invite.expired) {
    return shell(
      <DeadEnd
        tone="warn"
        icon={IconClock}
        title="This invitation has expired"
        body={
          <>
            <p>
              Invitations are good for seven days. This one to{" "}
              <strong className="text-ink">{invite.orgName}</strong> is past its window,
              so it can no longer create an account.
            </p>
            <p>
              An administrator with{" "}
              <code className="rounded-xs bg-surface-2 px-1 font-mono text-[12px] text-ink-2">
                staff.manage
              </code>{" "}
              can issue you a fresh link in seconds.
            </p>
          </>
        }
      />,
    );
  }

  // ── Live invite ──────────────────────────────────────────────
  return shell(
    <Card className="overflow-hidden">
      <div className="border-b border-line bg-surface-2/60 px-6 py-5">
        <div className="flex items-center gap-2">
          <Badge tone={invite.orgType === "BROKER" ? "info" : "brand"}>
            {ORG_KIND[invite.orgType] ?? invite.orgType}
          </Badge>
          <span className="text-[12px] text-ink-3">invited you</span>
        </div>
        <h1 className="mt-2.5 text-xl font-semibold tracking-tight text-ink">
          Join {invite.orgName}
        </h1>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
          Hello {invite.name}. Set a password and your account is created inside{" "}
          {invite.orgName} with exactly the roles below — no more, no less.
        </p>
      </div>

      <div className="border-b border-line px-6 py-4">
        <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
          Roles you will receive
        </p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {invite.roles.length === 0 ? (
            <span className="text-[13px] text-ink-3">
              None — you will have read-only access until an administrator grants you a
              role.
            </span>
          ) : (
            invite.roles.map((role) => (
              <Badge key={role} tone="brand">
                {role}
              </Badge>
            ))
          )}
        </div>
        <p className="mt-2.5 text-[12px] leading-relaxed text-ink-3">
          A role is a bundle of permissions your administrator authored. Your effective
          permissions are the union of these, re-resolved from the database on every
          single request — so if an admin edits a role, it takes effect on your next
          click, not whenever a token expires.
        </p>
      </div>

      <div className="px-6 py-5">
        <AcceptInviteForm token={token} email={invite.email} />
      </div>
    </Card>,
  );
}
