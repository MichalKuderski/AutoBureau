"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "link";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-ink hover:bg-accent-hover active:bg-accent-active shadow-sm border border-transparent",
  secondary:
    "bg-surface text-ink border border-line-strong hover:bg-surface-sunken active:bg-surface-sunken",
  ghost: "bg-transparent text-ink-secondary hover:bg-surface-sunken hover:text-ink border border-transparent",
  danger: "bg-critical text-white hover:brightness-110 active:brightness-95 border border-transparent",
  link: "bg-transparent text-accent underline underline-offset-4 hover:text-accent-hover border-0 p-0 h-auto",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5 rounded-sm",
  md: "h-10 px-4 text-base gap-2 rounded-md",
  lg: "h-12 px-6 text-lg gap-2.5 rounded-md",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant | undefined;
  size?: Size | undefined;
  loading?: boolean | undefined;
  /** Announced to assistive tech while `loading`; keeps the visible label stable. */
  loadingLabel?: string | undefined;
  iconLeft?: React.ReactNode | undefined;
  iconRight?: React.ReactNode | undefined;
  fullWidth?: boolean | undefined;
}

/**
 * The button.
 *
 * Two behaviors worth calling out: while `loading` the button stays the same width
 * (the spinner replaces the left icon slot rather than being appended), because a
 * button that resizes mid-click moves the target under the user's finger; and the
 * disabled state is driven by `disabled || loading` so a double submit is impossible
 * without the caller remembering to wire it.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    loadingLabel = "Working…",
    iconLeft,
    iconRight,
    fullWidth,
    className,
    children,
    disabled,
    type = "button",
    ...props
  },
  ref,
) {
  const isDisabled = disabled === true || loading;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        // `whitespace-nowrap` is load-bearing: inside a flex container that is allowed
        // to shrink (page headers, toolbars) a label like "Add item" otherwise wraps
        // under its own icon.
        "inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors duration-150",
        "disabled:opacity-55 disabled:cursor-not-allowed",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        VARIANTS[variant],
        variant !== "link" && SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {loading ? (
        <Spinner className="size-4 shrink-0" />
      ) : iconLeft ? (
        <span aria-hidden className="shrink-0">
          {iconLeft}
        </span>
      ) : null}
      <span className="truncate">{children}</span>
      {loading ? <span className="sr-only">{loadingLabel}</span> : null}
      {!loading && iconRight ? (
        <span aria-hidden className="shrink-0">
          {iconRight}
        </span>
      ) : null}
    </button>
  );
});
