"use client";

import clsx from "clsx";
import { Badge, Card, CardHeader } from "@/components/ui";

/**
 * The seeded personas, one click from the login form. A judge should never have to
 * type an address to see the RBAC engine refuse someone.
 *
 * Clicking a row FILLS the form — it does not submit. You still press Sign in, so it
 * is obvious that the credential, not the button, is what is being exercised.
 */

export const DEMO_PASSWORD = "loadflow";

type Account = {
  email: string;
  role: string;
  note: string;
  /** Highlight the ones that make the demo interesting. */
  tone?: "danger" | "warn" | "ok";
};

type Group = {
  org: string;
  kind: "Broker" | "Carrier" | "Shipper";
  /** The compliance fact that makes this org worth signing in as. */
  tag?: { label: string; tone: "ok" | "danger" | "warn" };
  accounts: Account[];
};

export const DEMO_GROUPS: Group[] = [
  {
    org: "Meridian Freight Solutions",
    kind: "Broker",
    accounts: [
      {
        email: "admin@meridian.com",
        role: "Organization Administrator",
        note: "Every permission. The only account that can do all ten things.",
      },
      {
        email: "ops@meridian.com",
        role: "Ops Lead",
        note: "Can override a compliance flag — with a written reason, on the record forever.",
        tone: "ok",
      },
      {
        email: "dispatch@meridian.com",
        role: "Dispatcher",
        note: "Cannot override. Try it on LF-1043: the API returns 403 and logs the attempt.",
        tone: "warn",
      },
      {
        email: "billing@meridian.com",
        role: "Billing Clerk",
        note: "Zero permissions. Sees the board, every mutation 403s. Read-only by construction.",
        tone: "danger",
      },
    ],
  },
  {
    org: "Ironline Trucking",
    kind: "Carrier",
    tag: { label: "Compliant", tone: "ok" },
    accounts: [
      { email: "admin@ironline.com", role: "Organization Administrator", note: "Full carrier-side control, incl. its own compliance record." },
      { email: "dispatch@ironline.com", role: "Dispatch", note: "Accept or decline a tender. Nothing else." },
      { email: "driver@ironline.com", role: "Driver", note: "Advance status and upload a POD. Cannot accept a load." },
    ],
  },
  {
    org: "Redline Logistics",
    kind: "Carrier",
    tag: { label: "Insurance lapsed", tone: "danger" },
    accounts: [
      { email: "admin@redline.com", role: "Organization Administrator", note: "Fix the insurance expiry and watch the blocked loads unblock themselves." },
      { email: "dispatch@redline.com", role: "Dispatch", note: "Can accept the tender — but the load still cannot be dispatched." },
      { email: "driver@redline.com", role: "Driver", note: "Status + POD only." },
    ],
  },
  {
    org: "Cobalt Carriers",
    kind: "Carrier",
    tag: { label: "Authority revoked", tone: "danger" },
    accounts: [
      { email: "admin@cobalt.com", role: "Organization Administrator", note: "Revoked MC authority — a hard block no amount of insurance fixes." },
      { email: "dispatch@cobalt.com", role: "Dispatch", note: "Accept/decline only." },
      { email: "driver@cobalt.com", role: "Driver", note: "Status + POD only." },
    ],
  },
  {
    org: "Shippers",
    kind: "Shipper",
    accounts: [
      { email: "shipper@cascade.com", role: "Cascade Produce Co.", note: "No roles, no permissions — pure object-level scoping. Sees only its own freight." },
      { email: "shipper@northgate.com", role: "Northgate Building Supply", note: "Read-only view of its own loads. Cannot see Cascade's." },
    ],
  },
];

const KIND_TONE = {
  Broker: "info",
  Carrier: "brand",
  Shipper: "neutral",
} as const;

const DOT: Record<NonNullable<Account["tone"]>, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
};

export function DemoAccounts({
  onPick,
  selected,
}: {
  onPick: (email: string) => void;
  selected?: string;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Demo accounts"
        subtitle={
          <>
            Click any row to fill the form. Password is{" "}
            <code className="rounded-xs bg-surface-2 px-1 py-0.5 font-mono text-[12px] text-ink-2">
              {DEMO_PASSWORD}
            </code>{" "}
            for all of them.
          </>
        }
      />

      <div className="divide-y divide-line">
        {DEMO_GROUPS.map((group) => (
          <section key={group.org}>
            <div className="flex items-center gap-2 bg-surface-2/60 px-5 py-2">
              <Badge tone={KIND_TONE[group.kind]}>{group.kind}</Badge>
              <span className="truncate text-[13px] font-medium text-ink-2">{group.org}</span>
              {group.tag ? (
                <span className="ml-auto shrink-0">
                  <Badge tone={group.tag.tone}>{group.tag.label}</Badge>
                </span>
              ) : null}
            </div>

            <ul>
              {group.accounts.map((acct) => {
                const isSelected = selected === acct.email;
                return (
                  <li key={acct.email}>
                    <button
                      type="button"
                      onClick={() => onPick(acct.email)}
                      aria-pressed={isSelected}
                      className={clsx(
                        "group flex w-full items-start gap-3 px-5 py-2.5 text-left transition-colors",
                        "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-500",
                        isSelected ? "bg-brand-500/10" : "hover:bg-surface-2",
                      )}
                    >
                      <span
                        aria-hidden
                        className={clsx(
                          "mt-2 h-1.5 w-1.5 shrink-0 rounded-full",
                          acct.tone ? DOT[acct.tone] : "bg-line-strong",
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className="truncate font-mono text-[12.5px] text-ink">
                            {acct.email}
                          </span>
                          <span className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">
                            {acct.role}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-3">
                          {acct.note}
                        </span>
                      </span>
                      <span
                        className={clsx(
                          "mt-1 shrink-0 text-[11px] font-medium transition-opacity",
                          isSelected
                            ? "text-brand-600 opacity-100 dark:text-brand-400"
                            : "text-ink-3 opacity-0 group-hover:opacity-100",
                        )}
                      >
                        {isSelected ? "Filled" : "Use"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Card>
  );
}
