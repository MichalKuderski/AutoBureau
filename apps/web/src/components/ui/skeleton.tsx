import { cn } from "@/lib/cn";

/**
 * Loading placeholders.
 *
 * Skeletons mirror the shape of the content they replace so the layout does not jump
 * when data arrives — cumulative layout shift is a trust signal in a product about
 * reliability. The whole group is announced once as busy rather than each bar
 * chattering at a screen reader.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("shimmer rounded-sm bg-surface-sunken", className)}
      aria-hidden="true"
    />
  );
}

export function SkeletonGroup({
  children,
  label = "Loading",
  className,
}: {
  children: React.ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={cn("h-3.5", i === lines - 1 ? "w-3/5" : "w-full")}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-lg border border-line bg-surface p-5", className)}>
      <div className="flex items-start gap-3">
        <Skeleton className="size-9 rounded-md" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
    </div>
  );
}

export function SkeletonList({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <SkeletonGroup className={cn("flex flex-col gap-3", className)} label="Loading list">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </SkeletonGroup>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <SkeletonGroup label="Loading table" className="overflow-hidden rounded-lg border border-line">
      <div className="border-b border-line bg-surface-sunken px-4 py-3">
        <Skeleton className="h-3 w-32" />
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-line px-4 py-3 last:border-0">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={cn("h-3.5", c === 0 ? "w-1/3" : "flex-1")} />
          ))}
        </div>
      ))}
    </SkeletonGroup>
  );
}
