import { cn } from "@/lib/cn";

/**
 * Every screen opens the same way: what this is, then what it's for, then actions.
 * Consistency here is what makes a dense administrative product feel navigable —
 * the user's eye learns one pattern and reuses it everywhere.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string | undefined;
  actions?: React.ReactNode | undefined;
  className?: string | undefined;
}) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl leading-tight sm:text-3xl">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm text-ink-secondary text-pretty">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
