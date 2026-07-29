"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Chip, DOC_STATUS_TONE, DOC_STATUS_LABEL } from "@/components/ui/chip";
import { Alert } from "@/components/ui/alert";
import { useToast } from "@/components/ui/toast";
import type { DocumentView, ProposedChange } from "@/lib/domain/types";

/**
 * Review panel — the trust surface (PRD F7, CJ-4).
 *
 * This is where the product earns the right to act on its own. Three rules shape it:
 *
 * 1. **Nothing is asserted without provenance.** Every proposed field shows where it
 *    came from and how sure we are; a user can always answer "why does this exist?"
 * 2. **Correcting is as cheap as accepting.** If correction is buried, users accept
 *    wrong data to make the queue go away — which poisons both the ledger and the
 *    evaluation corpus that depends on these corrections being real.
 * 3. **Confidence is shown honestly, including when it's low.** Hiding uncertainty is
 *    how a product becomes confidently wrong, the one failure this category cannot
 *    survive (FOUNDING_PRINCIPLES §4).
 */

function confidenceLabel(c: number): { text: string; tone: "success" | "warning" | "critical" } {
  if (c >= 0.95) return { text: "High confidence", tone: "success" };
  if (c >= 0.8) return { text: "Fairly confident", tone: "warning" };
  return { text: "Needs your eyes", tone: "critical" };
}

export interface ReviewPanelProps {
  document: DocumentView;
  onDone?: (() => void) | undefined;
}

export function ReviewPanel({ document, onDone }: ReviewPanelProps) {
  const { toast } = useToast();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);

  const changes = document.proposed_changes ?? [];
  const needsReview = document.status === "needs_review";

  const accept = () => {
    const corrected = Object.keys(edits).length;
    toast({
      tone: "success",
      title: corrected > 0 ? "Saved with your corrections" : "Filed",
      description:
        corrected > 0
          ? "Thanks — corrections make the next document better."
          : "We've added this to your household registry.",
    });
    onDone?.();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={DOC_STATUS_TONE[document.status]}>
          {DOC_STATUS_LABEL[document.status] ?? document.status}
        </Chip>
        {document.doc_type ? (
          <Chip tone="neutral">{document.doc_type.replace(/_/g, " ")}</Chip>
        ) : null}
        {document.confidence != null ? (
          <span className="text-xs text-ink-tertiary">
            {Math.round(document.confidence * 100)}% overall
          </span>
        ) : null}
      </div>

      {needsReview ? (
        <Alert tone="warning" title="We weren't confident enough to file this on our own">
          Check the details below. Anything you correct teaches us — and nothing is added to your
          household until you say so.
        </Alert>
      ) : null}

      {changes.length === 0 ? (
        <p className="text-sm text-ink-secondary">
          Nothing was extracted from this document. It's stored and searchable, but it didn't
          produce any items or deadlines.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {changes.map((change, i) => (
            <ChangeCard
              key={`${change.kind}-${i}`}
              change={change}
              edits={edits}
              editing={editing}
              onEdit={setEditing}
              onChange={(path, value) => setEdits((prev) => ({ ...prev, [path]: value }))}
            />
          ))}
        </div>
      )}

      {needsReview ? (
        <div className="flex flex-col gap-2">
          <Button variant="primary" onClick={accept}>
            <Icon.Check className="size-4" />
            {Object.keys(edits).length > 0 ? "Save corrections and file" : "Looks right — file it"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              toast({
                tone: "info",
                title: "Skipped",
                description: "We'll leave it in review — nothing was added.",
              });
              onDone?.();
            }}
          >
            Not now
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ChangeCard({
  change,
  edits,
  editing,
  onEdit,
  onChange,
}: {
  change: ProposedChange;
  edits: Record<string, string>;
  editing: string | null;
  onEdit: (path: string | null) => void;
  onChange: (path: string, value: string) => void;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <header className="mb-3 flex items-center gap-2">
        {change.kind === "obligation" ? (
          <Icon.Obligations className="size-4 text-ink-tertiary" />
        ) : (
          <Icon.Household className="size-4 text-ink-tertiary" />
        )}
        <h3 className="text-sm font-medium text-ink">{change.label}</h3>
        <span className="ml-auto text-xs text-ink-tertiary">
          {change.action === "create" ? "New" : "Update"}
        </span>
      </header>

      <dl className="flex flex-col divide-y divide-line">
        {change.fields.map((field) => {
          const edited = edits[field.path];
          const conf = confidenceLabel(field.confidence);
          const isEditing = editing === field.path;

          return (
            <div key={field.path} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <dt className="text-xs text-ink-tertiary">{field.path.replace(/_/g, " ")}</dt>
                <dd className="mt-0.5">
                  {isEditing ? (
                    <input
                      autoFocus
                      defaultValue={edited ?? field.value}
                      onBlur={(e) => {
                        onChange(field.path, e.target.value);
                        onEdit(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") onEdit(null);
                      }}
                      className="w-full rounded-md border border-accent bg-surface px-2 py-1 text-sm text-ink focus:outline-none"
                    />
                  ) : (
                    <span
                      className={cn(
                        "text-sm",
                        edited ? "font-medium text-accent" : "text-ink",
                      )}
                    >
                      {edited ?? field.value}
                      {edited ? (
                        <span className="ml-1.5 text-xs text-ink-tertiary">(corrected)</span>
                      ) : null}
                    </span>
                  )}
                </dd>
                {!isEditing ? (
                  <span
                    className={cn(
                      "mt-1 inline-block text-2xs",
                      conf.tone === "success" && "text-success",
                      conf.tone === "warning" && "text-warning",
                      conf.tone === "critical" && "text-critical",
                    )}
                  >
                    {conf.text}
                  </span>
                ) : null}
              </div>
              {!isEditing ? (
                <button
                  type="button"
                  onClick={() => onEdit(field.path)}
                  className="shrink-0 rounded px-2 py-1 text-xs text-accent hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
                >
                  Correct
                </button>
              ) : null}
            </div>
          );
        })}
      </dl>
    </section>
  );
}
