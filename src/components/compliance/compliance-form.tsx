"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  Button,
  Card,
  CardHeader,
  Field,
  FormError,
  Input,
  LockedHint,
  Select,
  Textarea,
} from "@/components/ui";
import type { ComplianceDTO } from "@/lib/compliance/schema";
import {
  centsToDollars,
  COMMODITY_TYPES,
  dollarsToCents,
  EQUIPMENT_TYPES,
} from "@/lib/format";

/* The single most consequential form in the product: what it says is what the
   compliance gate believes, and what the gate believes decides whether a truck rolls.
   It is used verbatim by the broker (vetting any carrier) and by the carrier
   (self-service on its own record) — one form, one truth, one API call. */

const AUTHORITY_OPTIONS = ["ACTIVE", "PENDING", "INACTIVE", "REVOKED"] as const;

type LoadRef = {
  id: string;
  reference: string;
  originCity: string;
  originState: string;
  destCity: string;
  destState: string;
};

type SaveResult = {
  reevaluated: number;
  unblocked: LoadRef[];
  newlyBlocked: LoadRef[];
  unblockedCount: number;
  newlyBlockedCount: number;
  changed: string[];
};

type FieldErrors = Record<string, string[] | undefined>;

function blankForm() {
  return {
    insuranceProvider: "",
    insurancePolicyNumber: "",
    insuranceExpiry: "",
    cargoInsurance: "",
    autoLiability: "",
    mcNumber: "",
    dotNumber: "",
    authorityStatus: "ACTIVE",
    approvedEquipment: [] as string[],
    approvedCommodities: [] as string[],
    notes: "",
  };
}

function formFrom(initial: ComplianceDTO | null) {
  if (!initial) return blankForm();
  return {
    insuranceProvider: initial.insuranceProvider,
    insurancePolicyNumber: initial.insurancePolicyNumber,
    insuranceExpiry: initial.insuranceExpiry.slice(0, 10),
    cargoInsurance: centsToDollars(initial.cargoInsuranceCents),
    autoLiability: centsToDollars(initial.autoLiabilityCents),
    mcNumber: initial.mcNumber,
    dotNumber: initial.dotNumber,
    authorityStatus: initial.authorityStatus,
    approvedEquipment: [...initial.approvedEquipment],
    approvedCommodities: [...initial.approvedCommodities],
    notes: initial.notes ?? "",
  };
}

export function ComplianceForm({
  orgId,
  initial,
  canEdit,
  lockedReason = "You do not have the “Manage compliance records” permission. Ask an administrator to grant it.",
  loadHrefBase = "/broker/loads",
}: {
  orgId: string;
  initial: ComplianceDTO | null;
  canEdit: boolean;
  lockedReason?: string;
  loadHrefBase?: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState(() => formFrom(initial));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [result, setResult] = useState<SaveResult | null>(null);

  const set = <K extends keyof ReturnType<typeof blankForm>>(
    key: K,
    value: ReturnType<typeof blankForm>[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const toggle = (key: "approvedEquipment" | "approvedCommodities", value: string) =>
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(value)
        ? f[key].filter((v) => v !== value)
        : [...f[key], value],
    }));

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canEdit || pending) return;

    setPending(true);
    setError(null);
    setFieldErrors({});
    setResult(null);

    try {
      const res = await fetch(`/api/carriers/${orgId}/compliance`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          insuranceProvider: form.insuranceProvider,
          insurancePolicyNumber: form.insurancePolicyNumber,
          insuranceExpiry: form.insuranceExpiry,
          cargoInsuranceCents: dollarsToCents(form.cargoInsurance),
          autoLiabilityCents: dollarsToCents(form.autoLiability),
          mcNumber: form.mcNumber,
          dotNumber: form.dotNumber,
          authorityStatus: form.authorityStatus,
          approvedEquipment: form.approvedEquipment,
          approvedCommodities: form.approvedCommodities,
          notes: form.notes.trim() ? form.notes : undefined,
        }),
      });

      const json: unknown = await res.json().catch(() => null);

      if (!res.ok) {
        const body = (json ?? {}) as {
          error?: string;
          fieldErrors?: FieldErrors;
          detail?: { fieldErrors?: FieldErrors };
        };
        // parseBody() puts them under detail; a raw ZodError puts them at the top level.
        setFieldErrors(body.detail?.fieldErrors ?? body.fieldErrors ?? {});
        setError(body.error ?? `Save failed (HTTP ${res.status}).`);
        return;
      }

      setResult(json as SaveResult);
      // Re-render every server component on the page: the gate has already re-run.
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  const fe = (key: string) => fieldErrors[key]?.[0];

  return (
    <Card>
      <CardHeader
        title="Compliance record"
        subtitle={
          canEdit
            ? "Saving re-runs the compliance gate against every live load this carrier is on."
            : "Read-only."
        }
        action={
          canEdit ? null : <LockedHint>compliance.manage required</LockedHint>
        }
      />

      {result ? (
        <div className="border-b border-line px-5 py-4">
          <SaveOutcome result={result} loadHrefBase={loadHrefBase} />
        </div>
      ) : null}

      {!canEdit ? (
        <div className="border-b border-line bg-surface-2 px-5 py-3">
          <p className="text-[13px] text-ink-2">{lockedReason}</p>
          <p className="mt-1 text-[12px] text-ink-3">
            The fields below are disabled as a courtesy — the server rejects the write
            regardless of what this page renders.
          </p>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="px-5 py-5">
        <fieldset disabled={!canEdit || pending} className="space-y-6">
          {/* ── Insurance ── */}
          <section>
            <SectionTitle
              title="Insurance"
              hint="An expired policy is a blocking flag. Inside 30 days is a warning."
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Provider" error={fe("insuranceProvider")}>
                <Input
                  value={form.insuranceProvider}
                  onChange={(e) => set("insuranceProvider", e.target.value)}
                  placeholder="Great West Casualty"
                  autoComplete="off"
                />
              </Field>
              <Field label="Policy number" error={fe("insurancePolicyNumber")}>
                <Input
                  className="tnum"
                  value={form.insurancePolicyNumber}
                  onChange={(e) => set("insurancePolicyNumber", e.target.value)}
                  placeholder="GW-4471902"
                  autoComplete="off"
                />
              </Field>
              <Field
                label="Insurance expiry"
                error={fe("insuranceExpiry")}
                hint={expiryHint(form.insuranceExpiry)}
              >
                <Input
                  type="date"
                  className="tnum"
                  value={form.insuranceExpiry}
                  onChange={(e) => set("insuranceExpiry", e.target.value)}
                />
              </Field>
              <Field
                label="Cargo coverage (USD)"
                error={fe("cargoInsuranceCents")}
                hint="Must cover each load's declared value."
              >
                <Input
                  className="tnum"
                  inputMode="decimal"
                  value={form.cargoInsurance}
                  onChange={(e) => set("cargoInsurance", e.target.value)}
                  placeholder="100000.00"
                />
              </Field>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Auto liability (USD)" error={fe("autoLiabilityCents")}>
                <Input
                  className="tnum"
                  inputMode="decimal"
                  value={form.autoLiability}
                  onChange={(e) => set("autoLiability", e.target.value)}
                  placeholder="1000000.00"
                />
              </Field>
            </div>
          </section>

          <Divider />

          {/* ── Authority ── */}
          <section>
            <SectionTitle
              title="Operating authority"
              hint="Anything other than ACTIVE blocks every load tendered to this carrier."
            />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="MC number" error={fe("mcNumber")}>
                <Input
                  className="tnum"
                  value={form.mcNumber}
                  onChange={(e) => set("mcNumber", e.target.value)}
                  placeholder="MC-884213"
                  autoComplete="off"
                />
              </Field>
              <Field label="DOT number" error={fe("dotNumber")}>
                <Input
                  className="tnum"
                  value={form.dotNumber}
                  onChange={(e) => set("dotNumber", e.target.value)}
                  placeholder="2210447"
                  autoComplete="off"
                />
              </Field>
              <Field label="Authority status" error={fe("authorityStatus")}>
                <Select
                  value={form.authorityStatus}
                  onChange={(e) => set("authorityStatus", e.target.value)}
                >
                  {AUTHORITY_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {form.authorityStatus !== "ACTIVE" ? (
              <p className="mt-2 text-[12px] text-danger">
                With authority {form.authorityStatus}, saving will block every live load
                this carrier is on.
              </p>
            ) : null}
          </section>

          <Divider />

          {/* ── Approvals ── */}
          <section>
            <SectionTitle
              title="Approved equipment"
              hint="A load whose equipment is not on this list is flagged and held."
            />
            <ChipPicker
              options={EQUIPMENT_TYPES}
              extra={form.approvedEquipment}
              selected={form.approvedEquipment}
              onToggle={(v) => toggle("approvedEquipment", v)}
              disabled={!canEdit || pending}
            />
            {fe("approvedEquipment") ? (
              <p className="mt-2 text-[12px] text-danger">{fe("approvedEquipment")}</p>
            ) : null}
          </section>

          <section>
            <SectionTitle
              title="Approved commodities"
              hint="Hazmat and produce are the ones brokers get sued over."
            />
            <ChipPicker
              options={COMMODITY_TYPES}
              extra={form.approvedCommodities}
              selected={form.approvedCommodities}
              onToggle={(v) => toggle("approvedCommodities", v)}
              disabled={!canEdit || pending}
            />
            {fe("approvedCommodities") ? (
              <p className="mt-2 text-[12px] text-danger">{fe("approvedCommodities")}</p>
            ) : null}
          </section>

          <Divider />

          <Field label="Notes" hint="Anything the next person vetting this carrier should know." error={fe("notes")}>
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Certificate of insurance on file. Renewal confirmed with the agent 4/12."
            />
          </Field>
        </fieldset>

        <div className="mt-6 space-y-3">
          <FormError message={error} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12px] text-ink-3">
              {initial
                ? "This record is live. Saving re-evaluates the compliance gate immediately."
                : "No record on file — every load tendered to this carrier is blocked until one exists."}
            </p>
            <div className="flex items-center gap-2">
              {canEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    setForm(formFrom(initial));
                    setError(null);
                    setFieldErrors({});
                    setResult(null);
                  }}
                >
                  Reset
                </Button>
              ) : null}
              <Button type="submit" variant="primary" disabled={!canEdit || pending}>
                {pending ? (
                  <>
                    <Spinner />
                    Re-running the gate…
                  </>
                ) : initial ? (
                  "Save & re-evaluate"
                ) : (
                  "Create compliance record"
                )}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </Card>
  );
}

/* ── The payoff. "Insurance renewed — 2 loads unblocked." ────────────────── */

function SaveOutcome({
  result,
  loadHrefBase,
}: {
  result: SaveResult;
  loadHrefBase: string;
}) {
  const { unblockedCount, newlyBlockedCount, reevaluated } = result;

  return (
    <div className="space-y-3">
      {unblockedCount > 0 ? (
        <div className="flex items-start gap-3 rounded-card border border-ok/40 bg-ok-soft px-4 py-3">
          <CheckMark />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ok">
              Compliance record updated — {unblockedCount}{" "}
              {unblockedCount === 1 ? "load" : "loads"} unblocked and cleared to dispatch.
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {result.unblocked.map((l) => (
                <li key={l.id}>
                  <Link
                    href={`${loadHrefBase}/${l.id}`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-ok/40 bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink hover:bg-surface-2"
                  >
                    <span className="tnum">{l.reference}</span>
                    <span className="text-ink-3">
                      {l.originCity}, {l.originState} → {l.destCity}, {l.destState}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {newlyBlockedCount > 0 ? (
        <div className="flex items-start gap-3 rounded-card border border-danger/40 bg-danger-soft px-4 py-3">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-danger text-[11px] font-bold text-white">
            !
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-danger">
              {newlyBlockedCount} {newlyBlockedCount === 1 ? "load is" : "loads are"} now
              blocked by the compliance gate as a result of this change.
            </p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {result.newlyBlocked.map((l) => (
                <li key={l.id}>
                  <Link
                    href={`${loadHrefBase}/${l.id}`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-danger/40 bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink hover:bg-surface-2"
                  >
                    <span className="tnum">{l.reference}</span>
                    <span className="text-ink-3">
                      {l.originCity}, {l.originState} → {l.destCity}, {l.destState}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {unblockedCount === 0 && newlyBlockedCount === 0 ? (
        <div className="flex items-start gap-3 rounded-card border border-line bg-surface-2 px-4 py-3">
          <CheckMark neutral />
          <p className="text-[13px] text-ink-2">
            {result.changed.length > 0
              ? "Compliance record saved."
              : "Saved — nothing changed."}{" "}
            <span className="tnum">{reevaluated}</span>{" "}
            {reevaluated === 1 ? "live load was" : "live loads were"} re-evaluated against
            the gate; no load changed state.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/* ── Bits ────────────────────────────────────────────────────────────────── */

function ChipPicker({
  options,
  extra,
  selected,
  onToggle,
  disabled,
}: {
  options: readonly string[];
  extra: string[];
  selected: string[];
  onToggle: (value: string) => void;
  disabled?: boolean;
}) {
  // Anything already on the record but outside the catalog still has to be visible —
  // otherwise saving the form would silently drop it.
  const all = [...options, ...extra.filter((e) => !options.includes(e))];

  return (
    <div className="flex flex-wrap gap-1.5">
      {all.map((option) => {
        const on = selected.includes(option);
        return (
          <button
            key={option}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onToggle(option)}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
              "disabled:cursor-not-allowed disabled:opacity-55",
              on
                ? "border-brand-500 bg-brand-500/15 text-brand-700 dark:text-brand-300"
                : "border-line-strong bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink",
            )}
          >
            <span
              className={clsx(
                "flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border",
                on ? "border-brand-500 bg-brand-500" : "border-line-strong",
              )}
              aria-hidden
            >
              {on ? (
                <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 fill-none stroke-[oklch(20%_0_0)]">
                  <path d="M2 5.2 4 7.2 8 2.8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
            </span>
            {option}
          </button>
        );
      })}
    </div>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
      {hint ? <p className="mt-0.5 text-[12px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

function Divider() {
  return <div className="border-t border-line" />;
}

function Spinner() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 animate-spin" aria-hidden>
      <circle cx="8" cy="8" r="6" className="stroke-current opacity-25" strokeWidth="2" fill="none" />
      <path d="M14 8a6 6 0 0 0-6-6" className="stroke-current" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function CheckMark({ neutral }: { neutral?: boolean }) {
  return (
    <span
      className={clsx(
        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white",
        neutral ? "bg-ink-3" : "bg-ok",
      )}
      aria-hidden
    >
      <svg viewBox="0 0 12 12" className="h-3 w-3 fill-none stroke-current">
        <path d="M3 6.3 5 8.3 9 3.8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/** Live feedback while the user is still typing the date — before they've saved. */
function expiryHint(value: string): string | undefined {
  if (!value) return undefined;
  const t = Date.parse(value);
  if (Number.isNaN(t)) return undefined;
  const days = Math.floor((t - Date.now()) / 86_400_000);
  if (days < 0) return `Lapsed ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago — this will block loads.`;
  if (days <= 30) return `${days} day${days === 1 ? "" : "s"} away — inside the 30-day warning window.`;
  return `${days} days of coverage remaining.`;
}
