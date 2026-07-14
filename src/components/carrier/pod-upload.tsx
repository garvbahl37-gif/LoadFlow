"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { LoadStatus } from "@/generated/prisma/enums";
import {
  formatBytes,
  POD_ACCEPT,
  POD_ACCEPT_ATTR,
  POD_MAX_BYTES,
  POD_STATUSES,
} from "@/components/carrier/bytes";
import { Button, FormError, LockedHint, Textarea } from "@/components/ui";
import { STATUS_LABEL } from "@/lib/loads/state-machine";

/**
 * Proof of delivery upload.
 *
 * The type/size check here is a courtesy so the driver finds out about a 12 MB scan
 * before uploading 12 MB of it — the real gate is POST /api/loads/[id]/pod, which
 * re-checks `pod.upload`, re-checks that this load is actually assigned to this carrier
 * (scope → 404), re-checks the load's status, and measures the bytes it actually
 * received rather than trusting `file.size`. Deleting this component would not weaken
 * a single one of those controls.
 */
export function PodUpload({
  loadId,
  status,
  canUpload,
  hasPod,
}: {
  loadId: string;
  status: LoadStatus;
  canUpload: boolean;
  hasPod: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const podable = (POD_STATUSES as readonly string[]).includes(status);

  const lockedReason = !canUpload
    ? null // rendered as a LockedHint below, with the permission named
    : !podable
      ? `A proof of delivery can only be attached once the load is on the road. This load is ${STATUS_LABEL[status]}.`
      : null;

  if (!canUpload) {
    return (
      <div className="px-5 py-4">
        <LockedHint>
          Uploading a POD requires the
          <code className="mx-1 rounded-xs bg-surface-2 px-1 font-mono text-[11px]">
            pod.upload
          </code>
          permission. On this load it belongs to the driver, not to dispatch.
        </LockedHint>
      </div>
    );
  }

  function pick(candidate: File | null) {
    setError(null);
    if (!candidate) return;
    const mime = candidate.type.split(";")[0]!.trim().toLowerCase();
    if (!(POD_ACCEPT as readonly string[]).includes(mime)) {
      setError(
        `${mime || "That file type"} is not an accepted POD format. Upload a PNG, JPEG, WebP or PDF.`,
      );
      setFile(null);
      return;
    }
    if (candidate.size > POD_MAX_BYTES) {
      setError(`That file is ${formatBytes(candidate.size)}. The maximum POD size is 5 MB.`);
      setFile(null);
      return;
    }
    setFile(candidate);
  }

  async function submit() {
    if (!file) return;
    setPending(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (notes.trim()) form.append("notes", notes.trim());

      const res = await fetch(`/api/loads/${loadId}/pod`, {
        method: "POST",
        body: form, // never set Content-Type by hand — the boundary comes from FormData
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error ?? `Upload failed (${res.status}).`);
        setPending(false);
        return;
      }
      setFile(null);
      setNotes("");
      if (inputRef.current) inputRef.current.value = "";
      setPending(false);
      router.refresh();
    } catch {
      setError("Network error — the document was not uploaded.");
      setPending(false);
    }
  }

  return (
    <div className="space-y-3 px-5 py-4">
      <FormError message={error} />

      {lockedReason ? (
        <p>
          <LockedHint>{lockedReason}</LockedHint>
        </p>
      ) : null}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!lockedReason && !pending) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (lockedReason || pending) return;
          pick(e.dataTransfer.files?.[0] ?? null);
        }}
        className={clsx(
          "rounded-card border border-dashed px-4 py-6 text-center transition-colors",
          dragging
            ? "border-brand-500 bg-brand-500/10"
            : "border-line-strong bg-surface-2",
          (lockedReason || pending) && "opacity-60",
        )}
      >
        <svg
          viewBox="0 0 24 24"
          className="mx-auto h-6 w-6 stroke-current text-ink-3"
          fill="none"
          aria-hidden
        >
          <path
            d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>

        <p className="mt-2 text-[13px] font-medium text-ink">
          {file ? file.name : "Drag a signed BOL here, or choose a file"}
        </p>
        <p className="tnum mt-0.5 text-[12px] text-ink-3">
          {file
            ? `${formatBytes(file.size)} · ${file.type}`
            : "PNG, JPEG, WebP or PDF · up to 5 MB"}
        </p>

        <input
          ref={inputRef}
          type="file"
          accept={POD_ACCEPT_ATTR}
          className="sr-only"
          disabled={Boolean(lockedReason) || pending}
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />

        <div className="mt-3 flex items-center justify-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={Boolean(lockedReason) || pending}
            onClick={() => inputRef.current?.click()}
          >
            {file ? "Choose a different file" : "Choose a file"}
          </Button>
          {file ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setFile(null);
                setError(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </div>

      {file ? (
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-ink-2">
            Notes for the broker (optional)
          </span>
          <Textarea
            rows={2}
            value={notes}
            maxLength={500}
            placeholder="e.g. Receiver signed at 14:20; two cases noted as damaged on the BOL."
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      ) : null}

      <Button
        variant="primary"
        className="w-full"
        disabled={!file || pending || Boolean(lockedReason)}
        onClick={submit}
      >
        {pending ? "Uploading…" : hasPod ? "Upload another document" : "Upload proof of delivery"}
      </Button>

      <p className="text-[12px] text-ink-3">
        The broker cannot mark this load POD Verified until a document is attached — the
        state machine holds it at Delivered until then.
      </p>
    </div>
  );
}
