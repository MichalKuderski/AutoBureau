"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * Form primitives.
 *
 * Every control is wired to its label, description, and error through generated ids —
 * the single most common accessibility failure in production forms is an input whose
 * error message is visible but unannounced. `aria-describedby` here is assembled from
 * whichever of those actually exist.
 *
 * Errors describe the fix, not the failure (PRD §15): "Enter a date in the future",
 * never "Invalid input".
 */

interface FieldShellProps {
  label: string;
  description?: string | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  className?: string | undefined;
  children: (props: {
    id: string;
    describedBy: string | undefined;
    invalid: boolean;
  }) => React.ReactNode;
}

export function Field({
  label,
  description,
  error,
  required,
  className,
  children,
}: FieldShellProps) {
  const id = useId();
  const descId = description ? `${id}-desc` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [descId, errId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {required ? (
          <span className="ml-1 text-critical" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {description ? (
        <p id={descId} className="text-xs text-ink-tertiary">
          {description}
        </p>
      ) : null}
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? (
        <p id={errId} role="alert" className="text-xs text-critical">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const controlBase =
  "w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-tertiary " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus " +
  "disabled:cursor-not-allowed disabled:opacity-60";

export type TextInputProps = Omit<React.ComponentPropsWithoutRef<"input">, "id"> & {
  label: string;
  description?: string | undefined;
  error?: string | undefined;
};

export function TextInput({
  label,
  description,
  error,
  required,
  className,
  ...rest
}: TextInputProps) {
  return (
    <Field label={label} description={description} error={error} required={required}>
      {({ id, describedBy, invalid }) => (
        <input
          {...rest}
          id={id}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(
            controlBase,
            invalid ? "border-critical" : "border-line",
            className,
          )}
        />
      )}
    </Field>
  );
}

export type TextAreaProps = Omit<React.ComponentPropsWithoutRef<"textarea">, "id"> & {
  label: string;
  description?: string | undefined;
  error?: string | undefined;
};

export function TextArea({
  label,
  description,
  error,
  required,
  className,
  ...rest
}: TextAreaProps) {
  return (
    <Field label={label} description={description} error={error} required={required}>
      {({ id, describedBy, invalid }) => (
        <textarea
          {...rest}
          id={id}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(
            controlBase,
            "min-h-24 resize-y",
            invalid ? "border-critical" : "border-line",
            className,
          )}
        />
      )}
    </Field>
  );
}

export type SelectProps = Omit<React.ComponentPropsWithoutRef<"select">, "id"> & {
  label: string;
  description?: string | undefined;
  error?: string | undefined;
  options: Array<{ value: string; label: string }>;
};

export function Select({
  label,
  description,
  error,
  required,
  options,
  className,
  ...rest
}: SelectProps) {
  return (
    <Field label={label} description={description} error={error} required={required}>
      {({ id, describedBy, invalid }) => (
        <select
          {...rest}
          id={id}
          required={required}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn(controlBase, invalid ? "border-critical" : "border-line", className)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export interface ToggleProps {
  label: string;
  description?: string | undefined;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean | undefined;
}

/** Switch pattern: a real checkbox under the hood so forms and AT behave normally. */
export function Toggle({ label, description, checked, onChange, disabled }: ToggleProps) {
  const id = useId();
  const descId = description ? `${id}-desc` : undefined;
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm text-ink">
          {label}
        </label>
        {description ? (
          <p id={descId} className="mt-0.5 text-xs text-ink-tertiary">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        aria-describedby={descId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
          checked ? "bg-accent" : "bg-line-strong",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-5 rounded-full bg-surface shadow-sm transition-transform",
            checked ? "translate-x-5.5" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
