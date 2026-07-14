import clsx from "clsx";

/**
 * Instant navigation feedback. The App Router renders the destination on the server
 * before the page changes, so without a `loading.tsx` the current page just freezes and
 * every button feels dead. These skeletons render the moment a link is clicked, so a
 * navigation always produces an immediate visual response even on the first (uncached)
 * server render — which on this app is only tens of milliseconds, but reads as instant
 * rather than laggy once something moves on screen.
 */

export function Shimmer({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-md bg-surface-2", className)} />;
}

export function PageHeaderSkeleton() {
  return (
    <div className="mb-6 flex items-end justify-between gap-3">
      <div className="space-y-2">
        <Shimmer className="h-6 w-48" />
        <Shimmer className="h-4 w-72" />
      </div>
      <Shimmer className="h-9 w-28" />
    </div>
  );
}

export function StatRowSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-card border border-line bg-surface px-4 py-3.5">
          <Shimmer className="h-3 w-20" />
          <Shimmer className="mt-2 h-7 w-10" />
          <Shimmer className="mt-2 h-3 w-24" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="rounded-card border border-line bg-surface">
      <div className="border-b border-line px-5 py-3.5">
        <Shimmer className="h-4 w-40" />
      </div>
      <div className="divide-y divide-line">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 py-3.5">
            <Shimmer className="h-4 w-16" />
            <Shimmer className="h-4 flex-1" />
            <Shimmer className="hidden h-4 w-28 sm:block" />
            <Shimmer className="hidden h-4 w-20 md:block" />
            <Shimmer className="h-5 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-card border border-line bg-surface px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <Shimmer className="h-5 w-32" />
            <Shimmer className="h-5 w-24 rounded-full" />
          </div>
          <Shimmer className="mt-3 h-4 w-3/4" />
          <Shimmer className="mt-2 h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** The default section skeleton: a header, a stat row, and a table. */
export function DashboardSkeleton() {
  return (
    <>
      <PageHeaderSkeleton />
      <StatRowSkeleton />
      <TableSkeleton />
    </>
  );
}
