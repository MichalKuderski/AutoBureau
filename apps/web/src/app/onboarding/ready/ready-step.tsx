"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { StepFooter } from "../onboarding-shell";
import { useOnboarding } from "../onboarding-provider";

/**
 * The handover.
 *
 * The temptation here is to declare victory — "your ledger is ready!" — and it would
 * be a lie: what exists is a list of claims and a document being read. So this screen
 * reports the true state, including the gap, because coverage stated honestly is what
 * earns the right to be trusted with the rest (the ledger thesis, and PRD §15.3).
 *
 * Provisional obligations are shown *without dates*, labelled as such. That absence
 * is the point: it is the difference between a system of record and a to-do list
 * someone typed from memory.
 */
export function ReadyStep() {
  const { seed, censusSubject, documentsAdded, members } = useOnboarding();

  const subjectName = censusSubject?.displayName.trim();
  const namedMembers = members.filter((m) => m.displayName.trim());
  const nothingYet = seed.items.length === 0 && documentsAdded === 0;

  return (
    <>
      <span
        aria-hidden
        className="mb-4 flex size-11 items-center justify-center rounded-full bg-success-soft text-success"
      >
        <Icon.Check className="size-5" />
      </span>

      <h1 className="text-2xl leading-tight sm:text-3xl">
        {nothingYet ? "You're set up" : "That's the start of your ledger"}
      </h1>
      <p className="mt-2 max-w-xl text-ink-secondary text-pretty">
        {nothingYet
          ? "Nothing is being tracked yet, and that's fine — forward one bill or renewal notice and we'll begin from there."
          : "From here it runs on evidence. Every document you send makes the picture more complete, and we watch the dates so you don't have to."}
      </p>

      {nothingYet ? (
        <EmptyState
          className="mt-7"
          icon={<Icon.Documents className="size-5" />}
          title="Your ledger is empty"
          description="The fastest start is a photo of whatever renewal notice is sitting on the counter."
          action={{ label: "Add a document", href: "/documents/upload" }}
        />
      ) : (
        <div className="mt-7 flex flex-col gap-5">
          {seed.obligations.length > 0 ? (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle className="text-lg">Deadlines we&apos;re hunting for</CardTitle>
                  <p className="mt-1 text-sm text-ink-secondary text-pretty">
                    You told us these exist. We won&apos;t put a date on any of them until a
                    document says so.
                  </p>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col divide-y divide-line">
                  {seed.obligations.map((o) => (
                    <li key={o.promptId} className="flex items-start gap-3 py-2.5 first:pt-0">
                      <Icon.Clock className="mt-0.5 size-4 shrink-0 text-ink-tertiary" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-ink">{o.title}</p>
                        <p className="text-xs text-ink-tertiary">
                          Needs {o.needs}
                          {o.memberName ? ` · ${o.memberName}` : ""}
                        </p>
                      </div>
                      <Chip tone="warning" size="sm">
                        Date unknown
                      </Chip>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {seed.items.length > 0 ? (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle className="text-lg">
                    In {subjectName ? `${subjectName}'s` : "your"} registry
                  </CardTitle>
                  <p className="mt-1 text-sm text-ink-secondary">
                    {seed.items.length} {seed.items.length === 1 ? "item" : "items"}, all marked
                    unverified until we see the paperwork.
                  </p>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-wrap gap-1.5">
                  {seed.items.map((item) => (
                    <li key={item.promptId}>
                      <Chip tone="neutral" size="sm">
                        {item.name}
                      </Chip>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {documentsAdded > 0 ? (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle className="text-lg">
                    {documentsAdded === 1 ? "Your document" : `Your ${documentsAdded} documents`}
                  </CardTitle>
                  <p className="mt-1 text-sm text-ink-secondary text-pretty">
                    Being read now. Anything we&apos;re unsure about will land in your review queue
                    rather than being filed on a guess.
                  </p>
                </div>
              </CardHeader>
            </Card>
          ) : null}
        </div>
      )}

      {namedMembers.length > 0 ? (
        <p className="mt-6 text-sm text-ink-tertiary">
          Tracking for {namedMembers.map((m) => m.displayName.trim()).join(", ")}.
        </p>
      ) : null}

      <StepFooter note="Next: forward a bill or a renewal notice from any inbox. That's the channel that keeps working without you.">
        <Link
          href="/dashboard"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-accent px-4 text-base font-medium text-accent-ink shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Go to your household
          <Icon.ChevronRight className="size-4" />
        </Link>
      </StepFooter>
    </>
  );
}
