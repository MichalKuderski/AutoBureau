"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/cn";

/**
 * Toasts.
 *
 * Announced through a polite live region so a screen-reader user hears the outcome
 * of their action without losing focus. Auto-dismiss is paused on hover *and* on
 * focus-within — a keyboard user tabbing to the undo button must not have it vanish
 * mid-reach, which is the single most common toast accessibility failure.
 */

export type ToastTone = "success" | "critical" | "info";

export interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
  action?: { label: string; onClick: () => void };
  duration: number;
}

type ToastInput = Omit<Partial<Toast>, "id"> & { title: string };

interface ToastContextValue {
  toast: (input: ToastInput) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_STYLES: Record<ToastTone, string> = {
  success: "border-success/30 bg-success-soft text-ink",
  critical: "border-critical/30 bg-critical-soft text-ink",
  info: "border-line bg-surface-raised text-ink",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`;
      const next: Toast = {
        id,
        title: input.title,
        tone: input.tone ?? "info",
        duration: input.duration ?? 5000,
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.action === undefined ? {} : { action: input.action }),
      };
      setToasts((current) => [...current.slice(-3), next]);
      if (next.duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), next.duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div
      role="region"
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
    >
      <div aria-live="polite" aria-atomic="false" className="contents">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  return (
    <div
      className={cn(
        "pointer-events-auto w-full max-w-sm rounded-lg border p-4 shadow-lg",
        "motion-safe:animate-[slide-up_180ms_var(--ease-out-expo)]",
        TONE_STYLES[toast.tone],
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{toast.title}</p>
          {toast.description ? (
            <p className="mt-0.5 text-sm text-ink-secondary">{toast.description}</p>
          ) : null}
          {toast.action ? (
            <button
              type="button"
              onClick={() => {
                toast.action?.onClick();
                onDismiss(toast.id);
              }}
              className="mt-2 text-sm font-medium text-accent underline underline-offset-4 hover:text-accent-hover"
            >
              {toast.action.label}
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          aria-label="Dismiss notification"
          className="-m-1 shrink-0 rounded-sm p-1 text-ink-tertiary transition-colors hover:bg-surface-sunken hover:text-ink"
        >
          <svg viewBox="0 0 24 24" fill="none" className="size-4" aria-hidden>
            <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
