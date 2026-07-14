"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { LoadStatus } from "@/generated/prisma/enums";
import { Dialog } from "@/components/loads/dialog";
import { flagLabel } from "@/components/loads/flag-copy";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  FormError,
  Input,
  LockedHint,
  Select,
  Textarea,
} from "@/components/ui";
import { centsToDollars, dollarsToCents, money, relative } from "@/lib/format";

/**
 * Everything a broker can DO to this load, in one column.
 *
 * The rule this rail exists to demonstrate: an action the user may not take is
 * rendered *disabled, with the reason* — never hidden. A missing permission and a
 * held compliance gate look different and read differently, and both come from the
 * server (`availableTransitions`), not from anything this component guesses. The
 * button is a courtesy; the API re-checks every one of these.
 */

export type RailTransition = {
  to: LoadStatus;
  action: string;
  permission: string;
  allowed: boolean;
  blockedReason: string | null;
};

type CarrierOption = {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
  mcNumber?: string | null;
  complianceState: string;
  label?: string;
  insuranceExpiry?: string | null;
  daysUntilExpiry?: number | null;
  authorityStatus?: string | null;
  approvedEquipment?: string[];
  approvedCommodities?: string[];
  cargoInsuranceCents?: number | null;
  liveLoads?: number;
  blockedLoads?: number;
};

const STATE_TONE: Record<string, "ok" | "warn" | "danger" | "neutral"> = {
  OK: "ok",
  EXPIRING: "warn",
  EXPIRED: "danger",
  AUTHORITY_ISSUE: "danger",
  NO_RECORD: "danger",
};

const STATE_COPY: Record<string, string> = {
  OK: "Compliant",
  EXPIRING: "Insurance expiring soon",
  EXPIRED: "Insurance expired",
  AUTHORITY_ISSUE: "Authority not active",
  NO_RECORD: "No compliance record",
};

async function readError(res: Response): Promise<string> {
  const json = await res.json().catch(() => null);
  // The API's message is the truth — a 409 from the compliance gate is written to be
  // read by a human, so it is shown verbatim rather than replaced with "Failed".
  return json?.error ?? `Request failed (${res.status}).`;
}

export function ActionsRail({
  loadId,
  status,
  transitions,
  canAssign,
  canConfirmRate,
  hasCarrier,
  negotiable,
  nextVersion,
  offeredRateCents,
  accessorialCatalog,
}: {
  loadId: string;
  status: LoadStatus;
  transitions: RailTransition[];
  canAssign: boolean;
  canConfirmRate: boolean;
  hasCarrier: boolean;
  negotiable: boolean;
  nextVersion: number;
  offeredRateCents: number;
  accessorialCatalog: ReadonlyArray<{ code: string; label: string }>;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"assign" | "rate" | null>(null);
  const [confirmTo, setConfirmTo] = useState<RailTransition | null>(null);
  const [pendingTo, setPendingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runTransition(t: RailTransition, note?: string) {
    setPendingTo(t.to);
    setError(null);
    try {
      const res = await fetch(`/api/loads/${loadId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: t.to, ...(note ? { note } : {}) }),
      });
      if (!res.ok) {
        setError(await readError(res));
        setPendingTo(null);
        return;
      }
      setConfirmTo(null);
      setPendingTo(null);
      router.refresh();
    } catch {
      setError("Network error — nothing was changed.");
      setPendingTo(null);
    }
  }

  const assignBlockedReason = !canAssign
    ? 'Requires the "load.assign_carrier" permission.'
    : status !== "POSTED"
      ? "A carrier can only be tendered while the load is posted."
      : null;

  const rateBlockedReason = !canConfirmRate
    ? 'Requires the "rate.confirm" permission.'
    : !hasCarrier
      ? "Assign a carrier first — a rate confirmation is an agreement between two parties."
      : !negotiable
        ? "The rate was frozen at dispatch and can no longer be renegotiated."
        : null;

  return (
    <Card>
      <CardHeader
        title="Actions"
        subtitle="Everything here is re-authorized server-side."
      />

      <div className="space-y-4 px-5 py-4">
        <FormError message={error} />

        {/* ── Tender ─────────────────────────────────────── */}
        <section>
          <SectionLabel>Tender</SectionLabel>
          <Button
            variant="primary"
            className="w-full"
            disabled={assignBlockedReason !== null}
            onClick={() => setDialog("assign")}
          >
            Assign carrier
          </Button>
          {assignBlockedReason ? (
            <p className="mt-1.5">
              <LockedHint>{assignBlockedReason}</LockedHint>
            </p>
          ) : (
            <p className="mt-1.5 text-[12px] text-ink-3">
              Compliance is evaluated at the moment of tender — before the load can move.
            </p>
          )}
        </section>

        {/* ── Rate ───────────────────────────────────────── */}
        <section>
          <SectionLabel>Rate confirmation</SectionLabel>
          <Button
            variant="secondary"
            className="w-full"
            disabled={rateBlockedReason !== null}
            onClick={() => setDialog("rate")}
          >
            Confirm rate · creates v{nextVersion}
          </Button>
          {rateBlockedReason ? (
            <p className="mt-1.5">
              <LockedHint>{rateBlockedReason}</LockedHint>
            </p>
          ) : (
            <p className="mt-1.5 text-[12px] text-ink-3">
              Immutable. v{nextVersion} supersedes the current version; the old one is kept.
            </p>
          )}
        </section>

        {/* ── State machine ──────────────────────────────── */}
        <section>
          <SectionLabel>Lifecycle</SectionLabel>
          {transitions.length === 0 ? (
            <p className="text-[13px] text-ink-3">
              No moves are available to a broker from this state.
            </p>
          ) : (
            <ul className="space-y-2">
              {transitions.map((t) => {
                const destructive = t.to === "CANCELLED";
                const busy = pendingTo === t.to;
                return (
                  <li key={t.to}>
                    <Button
                      variant={destructive ? "danger" : "secondary"}
                      className="w-full"
                      disabled={!t.allowed || busy}
                      title={t.blockedReason ?? undefined}
                      onClick={() => (destructive ? setConfirmTo(t) : runTransition(t))}
                    >
                      {busy ? "Working…" : t.action}
                    </Button>
                    {!t.allowed && t.blockedReason ? (
                      <p className="mt-1">
                        <LockedHint>{t.blockedReason}</LockedHint>
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {dialog === "assign" ? (
        <AssignDialog
          loadId={loadId}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      ) : null}

      {dialog === "rate" ? (
        <RateDialog
          loadId={loadId}
          nextVersion={nextVersion}
          defaultBaseCents={offeredRateCents}
          catalog={accessorialCatalog}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            router.refresh();
          }}
        />
      ) : null}

      {confirmTo ? (
        <CancelDialog
          transition={confirmTo}
          pending={pendingTo === confirmTo.to}
          onClose={() => setConfirmTo(null)}
          onConfirm={(note) => runTransition(confirmTo, note)}
        />
      ) : null}
    </Card>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
      {children}
    </p>
  );
}

/* ── Assign a carrier ─────────────────────────────────────── */

function AssignDialog({
  loadId,
  onClose,
  onDone,
}: {
  loadId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [carriers, setCarriers] = useState<CarrierOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    blocked: boolean;
    raised: Array<{ code: string; severity: string; message: string }>;
  } | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/carriers")
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res));
        return res.json();
      })
      .then((json) => {
        if (live) setCarriers(json.carriers ?? []);
      })
      .catch((e: Error) => {
        if (live) setLoadError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);

  async function submit() {
    if (!selected) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/loads/${loadId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carrierOrgId: selected }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error ?? `Assignment failed (${res.status}).`);
        setPending(false);
        return;
      }
      setResult({
        blocked: Boolean(json?.blocked),
        raised: json?.evaluation?.raised ?? [],
      });
      setPending(false);
    } catch {
      setError("Network error — the load was not tendered.");
      setPending(false);
    }
  }

  if (result) {
    const blockingCount = result.raised.filter((f) => f.severity === "BLOCKING").length;
    return (
      <Dialog title="Tendered" onClose={onDone} width="max-w-lg">
        <div className="space-y-3 px-5 py-4">
          {result.blocked ? (
            <div className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2.5">
              <p className="text-[13px] font-semibold text-danger">
                Tendered — but {blockingCount} blocking{" "}
                {blockingCount === 1 ? "flag was" : "flags were"} raised. This load cannot
                move past Carrier Assigned.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-ok/40 bg-ok-soft px-3 py-2.5">
              <p className="text-[13px] font-semibold text-ok">
                Tendered. The carrier passed every compliance check.
              </p>
            </div>
          )}

          {result.raised.length > 0 ? (
            <ul className="space-y-1.5">
              {result.raised.map((f, i) => (
                <li
                  key={`${f.code}-${i}`}
                  className="rounded-lg border border-line bg-surface-2 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-ink">
                      {flagLabel(f.code)}
                    </span>
                    <Badge tone={f.severity === "BLOCKING" ? "danger" : "warn"}>
                      {f.severity === "BLOCKING" ? "Blocking" : "Warning"}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[12px] text-ink-2">{f.message}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="flex justify-end border-t border-line px-5 py-3">
          <Button variant="primary" onClick={onDone}>
            View the load
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Assign a carrier"
      subtitle="Compliance is shown before you tender, not after. Tendering to a carrier with a blocking problem is allowed — the gate will simply hold the load."
      onClose={onClose}
      width="max-w-2xl"
    >
      <div className="max-h-[46vh] overflow-y-auto px-5 py-4">
        <FormError message={error ?? loadError} />

        {carriers === null && !loadError ? (
          <ul className="space-y-2">
            {[0, 1, 2].map((i) => (
              <li
                key={i}
                className="h-[62px] animate-pulse rounded-lg border border-line bg-surface-2"
              />
            ))}
          </ul>
        ) : null}

        {carriers && carriers.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-ink-3">
            No carrier organizations exist yet.
          </p>
        ) : null}

        <ul className="mt-2 space-y-2">
          {(carriers ?? []).map((c) => {
            const tone = STATE_TONE[c.complianceState] ?? "neutral";
            const risky = tone === "danger";
            const active = selected === c.id;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setSelected(c.id)}
                  className={clsx(
                    "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                    active
                      ? "border-brand-500 bg-brand-500/10"
                      : "border-line bg-surface hover:bg-surface-2",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold text-ink">{c.name}</span>
                    <Badge tone={tone}>
                      {c.label ?? STATE_COPY[c.complianceState] ?? c.complianceState}
                    </Badge>
                    {risky ? (
                      <span className="text-[11px] font-medium text-danger">
                        will raise a blocking flag
                      </span>
                    ) : null}
                    {typeof c.liveLoads === "number" ? (
                      <span className="tnum ml-auto text-[11px] text-ink-3">
                        {c.liveLoads} live
                      </span>
                    ) : null}
                  </div>
                  <p className="tnum mt-0.5 text-[12px] text-ink-3">
                    {c.mcNumber ? `MC ${c.mcNumber} · ` : ""}
                    {c.city && c.state ? `${c.city}, ${c.state} · ` : ""}
                    {c.insuranceExpiry
                      ? `insurance ${relative(c.insuranceExpiry)}`
                      : "no insurance on file"}
                    {c.authorityStatus && c.authorityStatus !== "ACTIVE"
                      ? ` · authority ${c.authorityStatus}`
                      : ""}
                    {typeof c.cargoInsuranceCents === "number"
                      ? ` · cargo ${money(c.cargoInsuranceCents)}`
                      : ""}
                  </p>
                  {c.approvedEquipment && c.approvedEquipment.length > 0 ? (
                    <p className="mt-0.5 text-[11px] text-ink-3">
                      Approved: {c.approvedEquipment.join(", ")}
                    </p>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} disabled={!selected || pending}>
          {pending ? "Tendering…" : "Tender load"}
        </Button>
      </div>
    </Dialog>
  );
}

/* ── Confirm a rate ───────────────────────────────────────── */

type Line = { code: string; label: string; amount: string };

function RateDialog({
  loadId,
  nextVersion,
  defaultBaseCents,
  catalog,
  onClose,
  onDone,
}: {
  loadId: string;
  nextVersion: number;
  defaultBaseCents: number;
  catalog: ReadonlyArray<{ code: string; label: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [base, setBase] = useState(centsToDollars(defaultBaseCents));
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState(catalog[0]?.code ?? "");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const baseCents = dollarsToCents(base);
  const totalCents = lines.reduce((sum, l) => sum + dollarsToCents(l.amount), baseCents);

  function addLine() {
    const def = catalog.find((a) => a.code === pick);
    if (!def) return;
    if (lines.some((l) => l.code === def.code)) return;
    setLines((prev) => [...prev, { code: def.code, label: def.label, amount: "0.00" }]);
  }

  async function submit() {
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await fetch(`/api/loads/${loadId}/rates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseRateCents: baseCents,
          accessorials: lines.map((l) => ({
            code: l.code,
            label: l.label,
            amountCents: dollarsToCents(l.amount),
          })),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error ?? `Rate confirmation failed (${res.status}).`);
        setFieldErrors(json?.detail?.fieldErrors ?? json?.fieldErrors ?? {});
        setPending(false);
        return;
      }
      onDone();
    } catch {
      setError("Network error — no rate version was created.");
      setPending(false);
    }
  }

  const unused = catalog.filter((a) => !lines.some((l) => l.code === a.code));

  return (
    <Dialog
      title={`Confirm rate — version ${nextVersion}`}
      subtitle={
        nextVersion === 1
          ? "This becomes the load's confirmed agreement."
          : `This creates v${nextVersion} and supersedes v${nextVersion - 1}. The old version is kept, never edited.`
      }
      onClose={onClose}
    >
      <div className="space-y-3 px-5 py-4">
        <FormError message={error} />

        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-ink-2">
            Line haul rate (USD)
          </span>
          <Input
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            className="tnum"
            value={base}
            autoFocus
            onChange={(e) => setBase(e.target.value)}
          />
          {fieldErrors.baseRateCents ? (
            <span className="mt-1 block text-[12px] text-danger">
              {fieldErrors.baseRateCents[0]}
            </span>
          ) : null}
        </label>

        <div>
          <p className="mb-1 text-[13px] font-medium text-ink-2">Accessorials</p>
          {lines.length === 0 ? (
            <p className="mb-2 text-[12px] text-ink-3">None added.</p>
          ) : (
            <ul className="mb-2 space-y-1.5">
              {lines.map((l, i) => (
                <li key={l.code} className="flex items-center gap-2">
                  <span className="w-14 shrink-0 rounded-xs border border-line bg-surface-2 px-1 py-0.5 text-center font-mono text-[11px] text-ink-3">
                    {l.code}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                    {l.label}
                  </span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    className="tnum w-28"
                    value={l.amount}
                    onChange={(e) => {
                      const value = e.target.value;
                      setLines((prev) =>
                        prev.map((p, j) => (j === i ? { ...p, amount: value } : p)),
                      );
                    }}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${l.label}`}
                    onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {unused.length > 0 ? (
            <div className="flex items-center gap-2">
              <Select value={pick} onChange={(e) => setPick(e.target.value)}>
                {unused.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} — {a.label}
                  </option>
                ))}
              </Select>
              <Button
                variant="secondary"
                onClick={() => {
                  addLine();
                  const remaining = unused.filter((a) => a.code !== pick);
                  setPick(remaining[0]?.code ?? "");
                }}
                disabled={!pick}
              >
                Add
              </Button>
            </div>
          ) : null}
        </div>

        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-ink-2">
            Notes (optional)
          </span>
          <Textarea
            rows={2}
            value={notes}
            maxLength={500}
            placeholder="e.g. FSC agreed at $0.42/mi with dispatch."
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        <div className="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2.5">
          <span className="text-[13px] font-medium text-ink-2">Total</span>
          <span className="tnum text-lg font-semibold text-ink">{money(totalCents)}</span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} disabled={pending || baseCents < 1}>
          {pending ? "Confirming…" : `Confirm v${nextVersion}`}
        </Button>
      </div>
    </Dialog>
  );
}

/* ── Cancel a load ────────────────────────────────────────── */

function CancelDialog({
  transition,
  pending,
  onClose,
  onConfirm,
}: {
  transition: RailTransition;
  pending: boolean;
  onClose: () => void;
  onConfirm: (note?: string) => void;
}) {
  const [note, setNote] = useState("");

  return (
    <Dialog
      title={transition.action}
      subtitle="A cancelled load is terminal. Its rate versions, flags and audit trail are preserved."
      onClose={onClose}
    >
      <div className="px-5 py-4">
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-ink-2">
            Reason (optional — recorded on the timeline)
          </span>
          <Textarea
            rows={3}
            value={note}
            maxLength={300}
            autoFocus
            placeholder="e.g. Shipper pulled the freight; rebooking next week."
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Keep the load
        </Button>
        <Button
          variant="danger"
          onClick={() => onConfirm(note.trim() || undefined)}
          disabled={pending}
        >
          {pending ? "Cancelling…" : "Cancel load"}
        </Button>
      </div>
    </Dialog>
  );
}
