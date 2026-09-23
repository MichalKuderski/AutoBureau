import { Skeleton, SkeletonList } from "@/components/ui/skeleton";

/**
 * Suspense fallback for authenticated route transitions.
 *
 * Deliberately a skeleton rather than a spinner: it reserves the shape the content
 * will occupy, so navigating doesn't produce a layout jump when data lands. The shell
 * around it stays mounted (this sits below `(app)/layout.tsx`), so only the panel
 * flickers, never the navigation.
 */
export default function AppLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="mb-6 flex flex-col gap-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <SkeletonList count={4} />
    </div>
  );
}
