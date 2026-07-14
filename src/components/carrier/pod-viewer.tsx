import { formatBytes } from "@/components/carrier/bytes";
import { Badge, EmptyState } from "@/components/ui";
import { dateTime, relative } from "@/lib/format";

/**
 * The POD, actually shown — not a filename and a hope.
 *
 * The bytes are streamed by GET /api/pods/[podId]/file, which resolves the document
 * *through its load's scope filter*: a rival carrier who guesses the id gets a 404 and
 * an audited SCOPE_DENIED row. So this <img>/<object> is safe to render for anyone who
 * can already see the load — the URL is not the access control.
 */

export type ViewerPod = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  notes: string | null;
  uploadedAt: Date | string;
  verifiedAt: Date | string | null;
  uploadedBy?: { name: string; email: string } | null;
  verifiedBy?: { name: string } | null;
};

export function PodViewer({ pods }: { pods: ViewerPod[] }) {
  if (pods.length === 0) {
    return (
      <EmptyState
        title="No proof of delivery yet"
        hint="Once the load is dispatched, a driver with pod.upload can attach the signed bill of lading here. The broker cannot verify the POD — or invoice the load — until they do."
      />
    );
  }

  return (
    <ul className="divide-y divide-line">
      {pods.map((pod, i) => {
        const isImage = pod.mimeType.startsWith("image/");
        const isPdf = pod.mimeType === "application/pdf";
        const href = `/api/pods/${pod.id}/file`;

        return (
          <li key={pod.id} className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium break-all text-ink">
                {pod.fileName}
              </span>
              {i === 0 && pods.length > 1 ? <Badge tone="brand">Latest</Badge> : null}
              {pod.verifiedAt ? (
                <Badge tone="ok">Verified by the broker</Badge>
              ) : (
                <Badge tone="warn">Awaiting broker verification</Badge>
              )}
            </div>

            <p className="tnum mt-0.5 text-[12px] text-ink-3">
              {formatBytes(pod.sizeBytes)} · {pod.mimeType} · uploaded by{" "}
              {pod.uploadedBy?.name ?? "—"} · {dateTime(pod.uploadedAt)} (
              {relative(pod.uploadedAt)})
            </p>

            {pod.verifiedAt ? (
              <p className="tnum mt-0.5 text-[12px] text-ok">
                Verified {pod.verifiedBy?.name ? `by ${pod.verifiedBy.name} ` : ""}·{" "}
                {dateTime(pod.verifiedAt)}
              </p>
            ) : null}

            {pod.notes ? (
              <p className="mt-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] text-ink-2">
                {pod.notes}
              </p>
            ) : null}

            <div className="mt-3 overflow-hidden rounded-lg border border-line bg-surface-2">
              {isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={href}
                  alt={`Proof of delivery — ${pod.fileName}`}
                  className="max-h-[420px] w-full bg-white object-contain"
                />
              ) : isPdf ? (
                // Browsers without a built-in PDF viewer fall back to the <object>'s
                // children. Make that fallback a proper document card rather than a
                // blank frame — it should read as "here is your document", not "broken".
                <object
                  data={href}
                  type="application/pdf"
                  className="h-[420px] w-full"
                  aria-label={`Proof of delivery — ${pod.fileName}`}
                >
                  <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
                    <svg viewBox="0 0 24 24" className="h-9 w-9 text-ink-3" aria-hidden>
                      <path
                        d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-5-5Zm0 2 4 4h-4V4Z"
                        className="fill-current"
                      />
                    </svg>
                    <p className="text-[13px] font-medium text-ink-2">{pod.fileName}</p>
                    <p className="text-[12px] text-ink-3">
                      Your browser has no built-in PDF viewer. Open the document below.
                    </p>
                  </div>
                </object>
              ) : (
                <div className="px-4 py-8 text-center text-[13px] text-ink-3">
                  {pod.mimeType} cannot be previewed here.
                </div>
              )}
            </div>

            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              Open in a new tab
              <svg viewBox="0 0 12 12" className="h-3 w-3 stroke-current" fill="none" aria-hidden>
                <path
                  d="M4.5 2h5.5v5.5M10 2L4 8M8 10H2V4"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
