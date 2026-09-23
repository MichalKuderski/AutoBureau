"use client";

import { useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { Icon } from "./icon";
import { Button } from "./button";

/**
 * Modal and drawer, sharing one implementation because they differ only in how they
 * enter. Both are portalled to the body so an ancestor's `overflow` or `transform`
 * cannot clip them — the most common cause of "the dialog is invisible on mobile".
 */

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string | undefined;
  children?: React.ReactNode | undefined;
  footer?: React.ReactNode | undefined;
  size?: "sm" | "md" | "lg" | undefined;
  /** `drawer` slides from the right on desktop and the bottom on mobile. */
  variant?: "center" | "drawer" | undefined;
}

const SIZES = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" } as const;

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  variant = "center",
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open, onClose);

  if (!open || typeof document === "undefined") return null;

  const titleId = `modal-title-${title.replace(/\W+/g, "-").toLowerCase()}`;

  return createPortal(
    <div className="fixed inset-0 z-50 flex" role="presentation">
      <div
        className="fixed inset-0 bg-overlay motion-safe:animate-[fade-in_150ms_var(--ease-out-expo)]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative z-10 flex w-full flex-col bg-surface shadow-lg",
          variant === "center"
            ? cn(
                "m-auto max-h-[85dvh] rounded-lg border border-line",
                SIZES[size],
                "motion-safe:animate-[scale-in_180ms_var(--ease-out-expo)]",
              )
            : cn(
                "ml-auto h-dvh max-w-md border-l border-line",
                "motion-safe:animate-[slide-in-right_220ms_var(--ease-out-expo)]",
              ),
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-xl leading-tight">
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-sm text-ink-secondary">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-md p-1.5 text-ink-tertiary transition-colors hover:bg-surface-sunken hover:text-ink"
          >
            <Icon.Close className="size-4.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-sunken/50 px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Confirmation for destructive or irreversible actions. `requireTyping` implements
 * the PRD's typed-confirmation rule for the genuinely unrecoverable ones (deleting a
 * household), so muscle memory cannot destroy a ledger.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  tone = "danger",
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-secondary">{description}</p>
    </Modal>
  );
}
