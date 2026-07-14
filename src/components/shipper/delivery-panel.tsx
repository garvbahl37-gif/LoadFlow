import type { LoadStatus } from "@/generated/prisma/enums";
import { Badge, EmptyState } from "@/components/ui";
import { dateTime, fullDate, relative } from "@/lib/format";
import { hasLanded, podReleasedToShipper } from "@/components/shipper/phase";

export type ShipperPod = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
  verifiedAt: Date | null;
};

/**
 * "Did my freight actually arrive, and can you prove it?" — the only question a
 * shipper has after the truck rolls.
 *
 * The document itself is released ONLY once the load has reached POD_VERIFIED. Before
 * that, the carrier's upload is an unverified claim; showing it as proof would be
 * asserting something the broker has not yet attested to. The bytes are streamed from
 * `/api/pods/[podId]/file`, which resolves the POD through the load's scope filter —
 * so this link is not the control either. It 404s for anyone else's shipment.
 */
export function DeliveryPanel({
  status,
  deliverBy,
  deliveredAt,
  pods,
}: {
  status: LoadStatus;
  deliverBy: Date;
  /** When the carrier marked it delivered, from the audit trail. */
  deliveredAt: Date | null;
  pods: ShipperPod[];
}) {
  if (status === "CANCELLED") {
    return (
      <EmptyState
        title="This shipment was cancelled"
        hint="It never dispatched, so there is no delivery to confirm."
        icon="×"
      />
    );
  }

  if (!hasLanded(status)) {
    return (
      <div className="px-5 py-5">
        <p className="text-[13px] text-ink-2">
          Not delivered yet. Scheduled to arrive{" "}
          <span className="tnum font-medium text-ink">{fullDate(deliverBy)}</span>{" "}
          <span className="text-ink-3">({relative(deliverBy)})</span>.
        </p>
        <p className="mt-1.5 text-[12px] text-ink-3">
          Once the carrier delivers, they submit a signed proof of delivery. It appears
          here as soon as your broker verifies it.
        </p>
      </div>
    );
  }

  const released = podReleasedToShipper(status);
  const verified = pods.filter((p) => p.verifiedAt !== null);
  const shown = released ? (verified.length > 0 ? verified : pods) : [];
  const awaitingVerification = !released;

  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ok/40 bg-ok-soft px-3 py-2.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ok text-[11px] font-bold text-white">
          ✓
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-ok">Delivered</p>
          <p className="tnum text-[12px] text-ink-2">
            {deliveredAt ? (
              <>
                {dateTime(deliveredAt)} · {relative(deliveredAt)}
              </>
            ) : (
              <>Delivery confirmed by the carrier</>
            )}
          </p>
        </div>
        <div className="ml-auto">
          {deliveredAt && deliveredAt.getTime() > deliverBy.getTime() ? (
            <Badge tone="warn">After deliver-by</Badge>
          ) : (
            <Badge tone="ok">On time</Badge>
          )}
        </div>
      </div>

      <div className="mt-4">
        <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
          Proof of delivery
        </p>

        {awaitingVerification ? (
          <div className="mt-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
            <p className="text-[13px] font-medium text-ink-2">
              {pods.length > 0
                ? "Received from the carrier — awaiting verification"
                : "Awaiting the carrier's paperwork"}
            </p>
            <p className="mt-0.5 text-[12px] text-ink-3">
              A POD is released to you only after your broker has verified it against the
              delivery. Until then it is an unverified claim, and we will not show it to
              you as proof.
            </p>
          </div>
        ) : shown.length === 0 ? (
          <div className="mt-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
            <p className="text-[13px] text-ink-2">No document is on file for this shipment.</p>
          </div>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {shown.map((pod) => (
              <PodRow key={pod.id} pod={pod} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PodRow({ pod }: { pod: ShipperPod }) {
  const isImage = pod.mimeType.startsWith("image/");

  return (
    <li className="rounded-lg border border-line bg-surface-2">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface">
          <svg viewBox="0 0 16 16" className="h-4 w-4 fill-ink-3" aria-hidden>
            <path d="M4 1.5h5L13 5.5v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Zm5 1.2V5.5h2.8L9 2.7Z" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink">{pod.fileName}</p>
          <p className="tnum text-[11px] text-ink-3">
            {(pod.sizeBytes / 1024).toFixed(0)} KB · uploaded {relative(pod.uploadedAt)}
            {pod.verifiedAt ? ` · verified ${relative(pod.verifiedAt)}` : ""}
          </p>
        </div>
        <Badge tone="ok">Verified</Badge>
        <a
          href={`/api/pods/${pod.id}/file`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] font-medium text-ink transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        >
          Open
          <svg viewBox="0 0 16 16" className="h-3 w-3 fill-none stroke-current stroke-[1.75]" aria-hidden>
            <path d="M6 3H3.5v9.5H13V10M9.5 2.5H13V6M13 2.5 7.5 8" strokeLinecap="round" />
          </svg>
        </a>
      </div>

      {isImage ? (
        <div className="border-t border-line px-3 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/pods/${pod.id}/file`}
            alt={`Proof of delivery — ${pod.fileName}`}
            className="max-h-80 w-full rounded-md border border-line bg-surface object-contain"
          />
        </div>
      ) : null}
    </li>
  );
}
