"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icon";
import { Button } from "./button";
import { formatBytes } from "@/lib/format";

/**
 * Upload dropzone.
 *
 * Constraints are enforced here *and* server-side; this copy exists to fail fast and
 * kindly, not to be trusted (doc 05 §3 — the client's claim about a file is never
 * authoritative). Rejections say what to do next rather than what went wrong.
 *
 * Keyboard parity is non-negotiable: the drop target is a real button, so the flow
 * works identically without a pointer. The `capture` input is offered separately
 * because a caregiver photographing a letter on a phone is the single most common
 * ingestion path we expect (PRD F4).
 */

const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPTED = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "message/rfc822",
];

export interface StagedFile {
  id: string;
  file: File;
  error?: string | undefined;
}

function validate(file: File): string | undefined {
  if (file.size > MAX_BYTES) {
    return `Too large (${formatBytes(file.size)}). Split it or send the key pages.`;
  }
  if (file.size === 0) return "This file is empty — try exporting it again.";
  if (file.type && !ACCEPTED.includes(file.type)) {
    return "We accept PDFs, photos, and forwarded email.";
  }
  return undefined;
}

export interface UploadDropzoneProps {
  onFiles?: ((files: File[]) => void) | undefined;
  className?: string | undefined;
  /**
   * No storage backend exists yet (blueprint P0-07): a selected file would be
   * validated, staged, and then discarded. Rather than let that happen behind a
   * working-looking control, `disabled` replaces the whole interactive surface —
   * including both hidden file inputs — with a static, truthful placeholder. Asking
   * the OS for file access only to throw the result away would be its own small lie.
   */
  disabled?: boolean | undefined;
}

export function UploadDropzone({ onFiles, className, disabled = false }: UploadDropzoneProps) {
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const accept = useCallback((list: FileList | null) => {
    if (!list) return;
    const next: StagedFile[] = [];
    for (const file of Array.from(list)) {
      next.push({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        file,
        error: validate(file),
      });
    }
    setStaged((prev) => [...prev, ...next]);
  }, []);

  const valid = staged.filter((s) => !s.error);

  if (disabled) {
    return (
      <div
        className={cn(
          "flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-line bg-surface-sunken px-6 py-10 text-center",
          className,
        )}
      >
        <Icon.Upload className="size-6 text-ink-tertiary" />
        <span className="text-sm font-medium text-ink-secondary">Uploads aren&apos;t available yet</span>
        <span className="text-xs text-ink-tertiary">We don&apos;t have anywhere to send a document yet.</span>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          accept(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
          dragging
            ? "border-accent bg-accent-soft"
            : "border-line bg-surface-sunken hover:border-line-strong",
        )}
      >
        <Icon.Upload className="size-6 text-ink-tertiary" />
        <span className="text-sm font-medium text-ink">Drop files here, or choose them</span>
        <span className="text-xs text-ink-tertiary">
          PDF, JPG, PNG, HEIC, or a forwarded email · up to 25 MB each
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED.join(",")}
        className="sr-only"
        onChange={(e) => accept(e.target.files)}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => accept(e.target.files)}
      />

      <Button variant="secondary" size="sm" onClick={() => cameraRef.current?.click()}>
        <Icon.Camera className="size-4" />
        Take a photo instead
      </Button>

      {staged.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {staged.map((s) => (
            <li
              key={s.id}
              className={cn(
                "flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm",
                s.error ? "border-critical/30 bg-critical-soft" : "border-line bg-surface",
              )}
            >
              <div className="min-w-0">
                <span className="block truncate text-ink">{s.file.name}</span>
                <span className={cn("text-xs", s.error ? "text-critical" : "text-ink-tertiary")}>
                  {s.error ?? formatBytes(s.file.size)}
                </span>
              </div>
              <button
                type="button"
                aria-label={`Remove ${s.file.name}`}
                onClick={() => setStaged((prev) => prev.filter((p) => p.id !== s.id))}
                className="rounded p-1 text-ink-tertiary hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
              >
                <Icon.Close className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {valid.length > 0 ? (
        <Button
          variant="primary"
          onClick={() => {
            onFiles?.(valid.map((v) => v.file));
            setStaged([]);
          }}
        >
          Send {valid.length} {valid.length === 1 ? "document" : "documents"}
        </Button>
      ) : null}
    </div>
  );
}
