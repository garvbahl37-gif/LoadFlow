import clsx from "clsx";
import type { LoadStatus } from "@/generated/prisma/enums";
import { LOAD_PIPELINE, STATUS_LABEL } from "@/lib/loads/state-machine";

/**
 * Where this load sits on the happy path. CANCELLED is not a step on that path —
 * it is a load that left it — so it is rendered as its own terminal state rather
 * than being squeezed into the stepper.
 */
export function StatusPipeline({ status }: { status: LoadStatus }) {
  if (status === "CANCELLED") {
    return (
      <div className="flex items-center gap-3 rounded-card border border-danger/40 bg-danger-soft px-4 py-3">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-danger text-[11px] font-bold text-white">
          ×
        </span>
        <div className="text-[13px]">
          <p className="font-semibold text-danger">Cancelled</p>
          <p className="text-ink-2">
            This load left the pipeline before dispatch. Its history below is preserved in full.
          </p>
        </div>
      </div>
    );
  }

  const current = LOAD_PIPELINE.indexOf(status);

  return (
    <ol className="flex w-full items-stretch overflow-x-auto rounded-card border border-line bg-surface">
      {LOAD_PIPELINE.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={step}
            className={clsx(
              "relative flex min-w-[104px] flex-1 flex-col gap-1 px-3 py-2.5",
              i > 0 && "border-l border-line",
              active && "bg-brand-500/10",
            )}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={clsx(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold",
                  done && "bg-ok text-white",
                  active && "bg-brand-500 text-[oklch(20%_0_0)]",
                  !done && !active && "border border-line-strong bg-surface-2 text-ink-3",
                )}
              >
                {done ? "✓" : i + 1}
              </span>
              <span
                className={clsx(
                  "text-[11px] font-semibold tracking-wide uppercase",
                  active ? "text-ink" : done ? "text-ink-2" : "text-ink-3",
                )}
              >
                Step {i + 1}
              </span>
            </div>
            <span
              className={clsx(
                "text-[13px] leading-tight font-medium whitespace-nowrap",
                active ? "text-ink" : done ? "text-ink-2" : "text-ink-3",
              )}
            >
              {STATUS_LABEL[step]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
