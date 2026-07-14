"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Dialog } from "@/components/loads/dialog";
import { Button, FormError, LockedHint } from "@/components/ui";

/**
 * Accept or decline a tender.
 *
 * `load.accept_decline` is a *separate* permission from `load.update_status`: at
 * Ironline, dispatch@ may answer a tender but may not roll a truck, and driver@ is the
 * exact reverse. So this control is rendered for both of them — locked, with the reason,
 * for the one who may not use it. The button is a courtesy; POST /api/loads/[id]/respond
 * re-checks the permission and the load's scope on every call.
 */
export function TenderActions({
  loadId,
  canRespond,
  reference,
  size = "md",
  className,
}: {
  loadId: string;
  canRespond: boolean;
  reference: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function respond(accept: boolean) {
    setPending(accept ? "accept" : "decline");
    setError(null);
    try {
      const res = await fetch(`/api/loads/${loadId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The API's own message is the truth — a 403 names the permission that was
        // missing, a 409 explains why there is no open tender. Show it verbatim.
        setError(json?.error ?? `Request failed (${res.status}).`);
        setPending(null);
        return;
      }
      setConfirmDecline(false);
      setPending(null);
      router.refresh();
    } catch {
      setError("Network error — nothing was sent to the broker.");
      setPending(null);
    }
  }

  if (!canRespond) {
    return (
      <div className={className}>
        <LockedHint>
          Answering a tender requires the
          <code className="mx-1 rounded-xs bg-surface-2 px-1 font-mono text-[11px]">
            load.accept_decline
          </code>
          permission. Your dispatcher can accept or decline this load.
        </LockedHint>
      </div>
    );
  }

  return (
    <div className={className}>
      {error ? (
        <div className="mb-2">
          <FormError message={error} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size={size}
          disabled={pending !== null}
          onClick={() => respond(true)}
        >
          {pending === "accept" ? "Accepting…" : "Accept tender"}
        </Button>
        <Button
          variant="secondary"
          size={size}
          disabled={pending !== null}
          onClick={() => setConfirmDecline(true)}
        >
          Decline
        </Button>
      </div>

      {confirmDecline ? (
        <Dialog
          title={`Decline ${reference}?`}
          subtitle="The load returns to the broker's board and is unassigned from you. It will disappear from your loads, and any compliance flags raised against you on it are cleared."
          onClose={() => setConfirmDecline(false)}
        >
          <div className="px-5 py-4">
            <FormError message={error} />
            <p className="text-[13px] text-ink-2">
              Declining is recorded on the load&apos;s audit trail with your name and the
              time. The broker will see it immediately and can re-tender the freight to
              another carrier.
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
            <Button
              variant="ghost"
              disabled={pending !== null}
              onClick={() => setConfirmDecline(false)}
            >
              Keep the load
            </Button>
            <Button
              variant="danger"
              disabled={pending !== null}
              onClick={() => respond(false)}
            >
              {pending === "decline" ? "Declining…" : "Decline tender"}
            </Button>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
