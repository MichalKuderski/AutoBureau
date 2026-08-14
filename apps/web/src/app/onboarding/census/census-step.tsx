"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { CENSUS } from "@/lib/domain/census";
import { StepFooter } from "../onboarding-shell";
import { useOnboarding } from "../onboarding-provider";

/**
 * The census (PRD F3, CJ-1) — recognition, not recall.
 *
 * Checkboxes rather than a form, grouped the way a person holds the problem in their
 * head, with the least forgiving category first. Nothing is required and nothing
 * blocks; every answer is a claim we mark unverified until a document proves it.
 *
 * What it deliberately does not do is ask for dates. A remembered renewal date is
 * exactly the kind of confidently-wrong fact this product cannot afford
 * (FOUNDING_PRINCIPLES §7) — the date comes from the document or it doesn't come.
 */
export function CensusStep() {
  const router = useRouter();
  const { selections, toggleSelection, censusSubject, seed } = useOnboarding();

  const subjectName = censusSubject?.displayName.trim();
  const possessive = subjectName ? `${subjectName}'s` : "your household's";

  return (
    <>
      <h1 className="text-2xl leading-tight sm:text-3xl">
        What&apos;s in {subjectName ? `${subjectName}'s` : "your"} life admin?
      </h1>
      <p className="mt-2 max-w-xl text-ink-secondary text-pretty">
        Tick what exists. Don&apos;t look anything up — a rough yes is enough, and we&apos;ll get
        the details from {possessive} paperwork as it arrives.
      </p>

      <div className="mt-7 flex flex-col gap-7">
        {CENSUS.map((group) => (
          <section key={group.id} aria-labelledby={`census-${group.id}`}>
            <h2 id={`census-${group.id}`} className="text-lg">
              {group.title}
            </h2>
            <p className="mt-0.5 text-sm text-ink-tertiary">{group.description}</p>

            <ul className="mt-3 flex flex-col gap-2">
              {group.prompts.map((prompt) => {
                const checked = selections.includes(prompt.id);
                return (
                  <li key={prompt.id}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border bg-surface px-3.5 py-3 transition-colors",
                        "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus",
                        checked
                          ? "border-accent bg-accent-soft/40"
                          : "border-line hover:border-line-strong",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelection(prompt.id)}
                        className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink">{prompt.label}</span>
                        {prompt.hint ? (
                          <span className="mt-0.5 block text-xs text-ink-tertiary text-pretty">
                            {prompt.hint}
                          </span>
                        ) : null}
                      </span>
                      {prompt.obligation ? (
                        <span
                          className="ml-auto shrink-0 self-center text-2xs text-ink-tertiary"
                          title="Saying yes starts a deadline we'll pin down from a document"
                        >
                          has deadlines
                        </span>
                      ) : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <StepFooter
        note="Nothing here creates a reminder yet. We record it as unverified until a document confirms it — that's the difference between a checklist and a ledger."
      >
        <Button variant="primary" onClick={() => router.push("/onboarding/document")}>
          Continue
        </Button>
        <span className="text-sm text-ink-secondary" aria-live="polite">
          {seed.items.length === 0 ? (
            "Nothing ticked yet"
          ) : (
            <>
              <Icon.Check className="mr-1 inline size-3.5 text-success" />
              {seed.items.length} to track
              {seed.obligations.length > 0
                ? `, ${seed.obligations.length} with deadlines to find`
                : ""}
            </>
          )}
        </span>
      </StepFooter>
    </>
  );
}
