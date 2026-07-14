"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, CardHeader, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { COMMODITY_TYPES, dollarsToCents, EQUIPMENT_TYPES, isoDate, money } from "@/lib/format";

/**
 * Post a load. Money is entered in DOLLARS and converted to cents at the boundary —
 * the database never sees a float. `brokerOrgId`, `createdById` and `reference` are
 * NOT in this form: the API derives the first two from the session and generates the
 * third. A field the client could forge is a field the client should not send.
 */

type Shipper = { id: string; name: string; city: string | null; state: string | null };

/** The subset of a load this form edits. Money is in cents (DB units) here. */
export type EditableLoad = {
  id: string;
  reference: string;
  shipperOrgId: string;
  originCity: string;
  originState: string;
  destCity: string;
  destState: string;
  pickupAt: Date | string;
  deliverBy: Date | string;
  commodity: string;
  equipmentType: string;
  weightLbs: number;
  declaredValueCents: number;
  offeredRateCents: number;
  notes: string | null;
};

const inDays = (n: number) => isoDate(new Date(Date.now() + n * 86_400_000));

/**
 * Post a new load, or edit an existing one. `brokerOrgId`, `createdById` and `reference`
 * are never in this form: the API derives the first two from the session and generates
 * the third. A field the client could forge is a field the client should not send.
 *
 * In edit mode it PATCHes /api/loads/[id]; the shipper cannot be changed (a load belongs
 * to its shipper), and if equipment/commodity/declared value change the API re-runs the
 * compliance evaluator, which the detail page reflects on return.
 */
export function LoadForm({ shippers, load }: { shippers: Shipper[]; load?: EditableLoad }) {
  const router = useRouter();
  const editing = !!load;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const [form, setForm] = useState({
    shipperOrgId: load?.shipperOrgId ?? shippers[0]?.id ?? "",
    originCity: load?.originCity ?? "",
    originState: load?.originState ?? "",
    destCity: load?.destCity ?? "",
    destState: load?.destState ?? "",
    pickupAt: load ? isoDate(load.pickupAt) : inDays(2),
    deliverBy: load ? isoDate(load.deliverBy) : inDays(4),
    commodity: load?.commodity ?? (COMMODITY_TYPES[0] as string),
    equipmentType: load?.equipmentType ?? (EQUIPMENT_TYPES[0] as string),
    weightLbs: load ? String(load.weightLbs) : "",
    declaredValue: load ? (load.declaredValueCents / 100).toFixed(2) : "",
    offeredRate: load ? (load.offeredRateCents / 100).toFixed(2) : "",
    notes: load?.notes ?? "",
  });

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const err = (key: string) => fieldErrors[key]?.[0];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    const payload = {
      // shipperOrgId is only sent when creating — a load cannot change hands.
      ...(editing ? {} : { shipperOrgId: form.shipperOrgId }),
      originCity: form.originCity.trim(),
      originState: form.originState.trim().toUpperCase(),
      destCity: form.destCity.trim(),
      destState: form.destState.trim().toUpperCase(),
      pickupAt: new Date(`${form.pickupAt}T12:00:00`).toISOString(),
      deliverBy: new Date(`${form.deliverBy}T12:00:00`).toISOString(),
      commodity: form.commodity,
      equipmentType: form.equipmentType,
      weightLbs: Number.parseInt(form.weightLbs || "0", 10),
      declaredValueCents: dollarsToCents(form.declaredValue || "0"),
      offeredRateCents: dollarsToCents(form.offeredRate || "0"),
      notes: form.notes.trim() || (editing ? null : undefined),
    };

    try {
      const res = await fetch(editing ? `/api/loads/${load.id}` : "/api/loads", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(json?.error ?? `Could not ${editing ? "save" : "post"} the load (${res.status}).`);
        setFieldErrors(json?.detail?.fieldErrors ?? json?.fieldErrors ?? {});
        setPending(false);
        return;
      }

      router.push(`/broker/loads/${editing ? load.id : json.load.id}`);
      router.refresh();
    } catch {
      setError(`Network error — the load was not ${editing ? "saved" : "posted"}.`);
      setPending(false);
    }
  }

  const declaredCents = dollarsToCents(form.declaredValue || "0");
  const offeredCents = dollarsToCents(form.offeredRate || "0");

  if (shippers.length === 0) {
    return (
      <Card className="px-5 py-6">
        <p className="text-sm text-ink-2">
          There are no shipper organizations yet. A load belongs to a shipper, so one has
          to exist before you can post freight.
        </p>
      </Card>
    );
  }

  return (
    <form onSubmit={submit}>
      <Card>
        <CardHeader
          title={editing ? `Edit load ${load.reference}` : "Load details"}
          subtitle={
            editing
              ? "Changing equipment, commodity or declared value re-runs the compliance check against the assigned carrier."
              : "Equipment, commodity and declared value are what the compliance gate reasons about when you tender."
          }
        />

        <div className="space-y-5 px-5 py-4">
          <FormError message={error} />

          <Field label="Shipper" error={err("shipperOrgId")}>
            {editing ? (
              // A load belongs to its shipper; it cannot be reassigned to another.
              <Select value={form.shipperOrgId} disabled>
                {shippers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.city && s.state ? ` — ${s.city}, ${s.state}` : ""}
                  </option>
                ))}
              </Select>
            ) : (
              <Select
                value={form.shipperOrgId}
                onChange={(e) => set("shipperOrgId", e.target.value)}
                required
              >
                {shippers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.city && s.state ? ` — ${s.city}, ${s.state}` : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <fieldset>
            <legend className="mb-2 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
              Lane
            </legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_88px_1fr_88px]">
              <Field label="Origin city" error={err("originCity")}>
                <Input
                  value={form.originCity}
                  onChange={(e) => set("originCity", e.target.value)}
                  placeholder="Fresno"
                  required
                />
              </Field>
              <Field label="State" error={err("originState")}>
                <Input
                  value={form.originState}
                  onChange={(e) => set("originState", e.target.value.toUpperCase())}
                  placeholder="CA"
                  maxLength={2}
                  className="uppercase"
                  required
                />
              </Field>
              <Field label="Destination city" error={err("destCity")}>
                <Input
                  value={form.destCity}
                  onChange={(e) => set("destCity", e.target.value)}
                  placeholder="Denver"
                  required
                />
              </Field>
              <Field label="State" error={err("destState")}>
                <Input
                  value={form.destState}
                  onChange={(e) => set("destState", e.target.value.toUpperCase())}
                  placeholder="CO"
                  maxLength={2}
                  className="uppercase"
                  required
                />
              </Field>
            </div>
          </fieldset>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Pickup" error={err("pickupAt")}>
              <Input
                type="date"
                className="tnum"
                value={form.pickupAt}
                onChange={(e) => set("pickupAt", e.target.value)}
                required
              />
            </Field>
            <Field
              label="Deliver by"
              error={err("deliverBy")}
              hint="Must be on or after pickup."
            >
              <Input
                type="date"
                className="tnum"
                value={form.deliverBy}
                onChange={(e) => set("deliverBy", e.target.value)}
                required
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Commodity" error={err("commodity")}>
              <Select
                value={form.commodity}
                onChange={(e) => set("commodity", e.target.value)}
              >
                {COMMODITY_TYPES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Equipment" error={err("equipmentType")}>
              <Select
                value={form.equipmentType}
                onChange={(e) => set("equipmentType", e.target.value)}
              >
                {EQUIPMENT_TYPES.map((eq) => (
                  <option key={eq} value={eq}>
                    {eq}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Weight (lb)" error={err("weightLbs")} hint="80,000 lb legal max.">
              <Input
                type="number"
                min="1"
                max="80000"
                inputMode="numeric"
                className="tnum"
                value={form.weightLbs}
                onChange={(e) => set("weightLbs", e.target.value)}
                placeholder="42000"
                required
              />
            </Field>
            <Field
              label="Declared value (USD)"
              error={err("declaredValueCents")}
              hint={declaredCents > 0 ? `${money(declaredCents)} of cargo cover needed` : "Cargo insurance must cover this."}
            >
              <Input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="tnum"
                value={form.declaredValue}
                onChange={(e) => set("declaredValue", e.target.value)}
                placeholder="65000.00"
                required
              />
            </Field>
            <Field
              label="Offered rate (USD)"
              error={err("offeredRateCents")}
              hint={offeredCents > 0 ? money(offeredCents) : "What you are posting it at."}
            >
              <Input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="tnum"
                value={form.offeredRate}
                onChange={(e) => set("offeredRate", e.target.value)}
                placeholder="2850.00"
                required
              />
            </Field>
          </div>

          <Field label="Notes (optional)" error={err("notes")}>
            <Textarea
              rows={3}
              maxLength={1000}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Appointment required at the receiver. Driver must have a TWIC card."
            />
          </Field>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
          <p className="text-[12px] text-ink-3">
            {editing
              ? "Only editable while Posted or Carrier Assigned."
              : "The reference (LF-####) is generated by the server."}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push(editing ? `/broker/loads/${load.id}` : "/broker")}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending
                ? editing
                  ? "Saving…"
                  : "Posting…"
                : editing
                  ? "Save changes"
                  : "Post load"}
            </Button>
          </div>
        </div>
      </Card>
    </form>
  );
}
