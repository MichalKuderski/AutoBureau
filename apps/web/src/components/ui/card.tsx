import { cn } from "@/lib/cn";

/**
 * Surface container. Interactive cards render as a single button/link rather than a
 * div with a click handler, so keyboard and screen-reader users get the affordance
 * for free and nested actions never become unreachable.
 */

export function Card({
  className,
  as: As = "div",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { as?: React.ElementType }) {
  return (
    <As
      className={cn(
        "rounded-lg border border-line bg-surface shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-start justify-between gap-3 px-5 pt-5 pb-3", className)}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  as: As = "h3",
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { as?: React.ElementType }) {
  return <As className={cn("text-lg leading-tight", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-ink-secondary", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-t border-line bg-surface-sunken/50 px-5 py-3 rounded-b-lg",
        className,
      )}
      {...props}
    />
  );
}
