"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FlagSeverity, FlagStatus } from "@/generated/prisma/enums";
import { Dialog } from "@/components/loads/dialog";
import { flagLabel } from "@/components/loads/flag-copy";
import {
  Button,
  EmptyState,
  FlagBadge,
  FormError,
  LockedHint,
  Textarea,
} from "@/components/ui";
import { dateTime, relative } from "@/lib/format";

/**
 * The compliance gate, on the record.
 *
 * An OPEN + BLOCKING flag is why a load is stopped. It can be cleared two ways: fix
 * the carrier's record (the evaluator resolves the flag automatically), or override
 * it — which demands a written reason, is attributed, and is shown here forever.
 * A user without `load.override_compliance_flag` still sees the flag and still sees
 * the override control: locked, with the reason it is locked. Hiding it would hide
 * the existence of the lock.
 */

export type PanelFlag = {
  id: string;
  code: string;
  severity: string;
  status: string;
  message: string;
  raisedAt: Date | string;
  overrideReason: string | null;
  overriddenAt: Date | string | null;
  /** Optional — supplied by callers that join the overriding user. */
  overriddenBy?: { name: string } | null;
};

const MIN_REASON = 10;

export function FlagsPanel({
  flags,
  loadId,
  canOverride,
}: {
  flags: PanelFlag[];
  loadId: string;
  canOverride: boolean;
}) {
  const [target, setTarget] = useState<PanelFlag | null>(null);

  if (flags.length === 0) {
    return (
      <EmptyState
        icon="✓"
        title="No compliance flags"
        hint="Compliance is evaluated the moment a carrier is tendered, and again whenever that carrier's record changes."
      />
    );
  }

  const open = flags.filter((f) => f.status === "OPEN");
  const rest = flags.filter((f) => f.status !== "OPEN");

  return (
    <>
      <ul className="divide-y divide-line">
        {[...open, ...rest].map((flag) => {
          const isOpen = flag.status === "OPEN";
          const blocking = isOpen && flag.severity === "BLOCKING";
          return (
            <li
              key={flag.id}
              className={clsx("px-5 py-3.5", blocking && "bg-danger-soft/40")}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={clsx(
                    "text-[13px] font-semibold",
                    blocking ? "text-danger" : "text-ink",
                  )}
                >
                  {flagLabel(flag.code)}
                </span>
                <FlagBadge
                  severity={flag.severity as FlagSeverity}
                  status={flag.status as FlagStatus}
                />
                <span className="tnum ml-auto text-[11px] whitespace-nowrap text-ink-3">
                  raised {relative(flag.raisedAt)}
                </span>
              </div>

              <p className="mt-1 text-[13px] text-ink-2">{flag.message}</p>

              {flag.status === "OVERRIDDEN" ? (
                <div className="mt-2 rounded-lg border border-warn/40 bg-warn-soft px-3 py-2">
                  <p className="text-[11px] font-semibold tracking-wide text-warn uppercase">
                    Overridden on the record
                  </p>
                  <p className="mt-0.5 text-[13px] text-ink">
                    &ldquo;{flag.overrideReason}&rdquo;
                  </p>
                  <p className="tnum mt-0.5 text-[11px] text-ink-3">
                    {flag.overriddenBy?.name ? `${flag.overriddenBy.name} · ` : ""}
                    {flag.overriddenAt ? dateTime(flag.overriddenAt) : "—"}
                  </p>
                </div>
              ) : null}

              {isOpen ? (
                <div className="mt-2">
                  {canOverride ? (
                    <Button size="sm" variant="secondary" onClick={() => setTarget(flag)}>
                      Override with a reason
                    </Button>
                  ) : (
                    <LockedHint>
                      Overriding a compliance flag requires the
                      <code className="mx-1 rounded-xs bg-surface-2 px-1 font-mono text-[11px]">
                        load.override_compliance_flag
                      </code>
                      permission. Ask an administrator, or have the carrier fix the underlying
                      record.
                    </LockedHint>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {target ? (
        <OverrideDialog
          loadId={loadId}
          flag={target}
          onClose={() => setTarget(null)}
        />
      ) : null}
    </>
  );
}

function OverrideDialog({
  loadId,
  flag,
  onClose,
}: {
  loadId: string;
  flag: PanelFlag;
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const tooShort = reason.trim().length < MIN_REASON;

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/loads/${loadId}/flags/${flag.id}/override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error ?? `Override failed (${res.status}).`);
        setPending(false);
        return;
      }
      router.refresh();
      onClose();
    } catch {
      setError("Network error — the override was not recorded.");
      setPending(false);
    }
  }

  return (
    <Dialog
      title={`Override: ${flagLabel(flag.code)}`}
      subtitle="You are accepting this risk on behalf of your organization. The reason, your name and the time are written to the audit trail permanently."
      onClose={onClose}
    >
      <div className="space-y-3 px-5 py-4">
        <div className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[13px] text-ink">
          {flag.message}
        </div>

        <FormError message={error} />

        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-ink-2">
            Why is this acceptable?
          </span>
          <Textarea
            rows={4}
            autoFocus
            value={reason}
            maxLength={500}
            placeholder="e.g. Carrier emailed a bound COI at 09:14; broker of record confirmed coverage is active. Renewal certificate to follow."
            onChange={(e) => setReason(e.target.value)}
          />
          <span
            className={clsx(
              "tnum mt-1 block text-[12px]",
              tooShort ? "text-ink-3" : "text-ok",
            )}
          >
            {reason.trim().length}/{MIN_REASON} characters minimum
          </span>
        </label>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button variant="danger" onClick={submit} disabled={tooShort || pending}>
          {pending ? "Recording override…" : "Override flag"}
        </Button>
      </div>
    </Dialog>
  );
}
