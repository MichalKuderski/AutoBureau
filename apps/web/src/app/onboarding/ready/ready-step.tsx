"use client";

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
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
 * be a lie: what exists is a list of claims and nothing behind them. So this screen
 * reports the true state, including the gap, because coverage stated honestly is what
 * earns the right to be trusted with the rest (the ledger thesis, and PRD §15.3).
 *
 * Provisional obligations are shown *without dates*, labelled as such. That absence
 * is the point: it is the difference between a system of record and a to-do list
 * someone typed from memory.
 *
 * That care was aimed at one axis only. The screen never dated anything it could not
 * evidence, and simultaneously told the reader their answers were "in your registry"
 * and being "hunted" for — durable state, in the present tense, for a census that is
 * held in React state and posted nowhere. Both halves now match: provisional about
 * dates, and equally plain that nothing here is stored.
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
        {nothingYet ? "You're set up" : "Here's what you told us"}
      </h1>
      <p className="mt-2 max-w-xl text-ink-secondary text-pretty">
        {nothingYet
          ? "Your household is created and nothing is being tracked yet — which is the honest starting point."
          : "Your household is created. What you ticked is summarised below, and the ledger itself fills in from documents rather than from answers."}
      </p>

      {/*
       * The census writes nothing. `OnboardingProvider` is React state and there is no
       * endpoint behind it — no route in `app/v1` accepts a census, and `seedFromCensus`
       * feeds this screen and nothing else — so every item below is gone on reload.
       *
       * Saying so is not pessimism, it is the same rule P0-07 and P0-10 applied to uploads
       * and encryption: a surface may not report state the system does not hold. This
       * screen was already scrupulous about *provisionality* (no dates, "unverified") while
       * claiming *durability* it does not have — "in your registry", "we're hunting",
       * "tracking for". Persistence is P1-02's remaining half and stays deferred; the claim
       * is what gets corrected here.
       */}
      {nothingYet ? null : (
        <Alert tone="info" title="This summary isn't saved" className="mt-6">
          Your household and sign-in are permanent. These answers are not — nothing records
          them yet, so they will be gone when you leave this page. Nothing you do here can be
          lost later, because none of it has been written.
        </Alert>
      )}

      {nothingYet ? (
        <EmptyState
          className="mt-7"
          icon={<Icon.Documents className="size-5" />}
          title="Your ledger is empty"
          // No "Add a document" action: it pointed at /documents/upload, whose dropzone is
          // disabled for want of a storage backend (P0-07). Sending someone from an empty
          // ledger to a control that cannot accept anything is the same false promise one
          // click further away.
          description="Sending documents isn't available yet — that's the step that will start it, and it's still being built."
        />
      ) : (
        <div className="mt-7 flex flex-col gap-5">
          {seed.obligations.length > 0 ? (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle className="text-lg">Deadlines you flagged</CardTitle>
                  <p className="mt-1 text-sm text-ink-secondary text-pretty">
                    You told us these exist. Nothing is watching for them yet, and no date gets
                    attached to one until a document says so.
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
                    What you ticked{subjectName ? ` for ${subjectName}` : ""}
                  </CardTitle>
                  <p className="mt-1 text-sm text-ink-secondary">
                    {seed.items.length} {seed.items.length === 1 ? "item" : "items"}. None of them
                    are in the registry yet — the paperwork is what puts them there.
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

          {/*
           * The "your document is being read now" card stood here. It could only ever
           * render from `documentsAdded`, which the document step incremented on a file it
           * then discarded — so the one case that produced this card was the case where
           * nothing had been received at all. Its control is disabled now (P0-07), which
           * leaves the counter permanently zero and the card unreachable.
           */}
        </div>
      )}

      {namedMembers.length > 0 ? (
        <p className="mt-6 text-sm text-ink-tertiary">
          You mentioned {namedMembers.map((m) => m.displayName.trim()).join(", ")}.
        </p>
      ) : null}

      <StepFooter note="Sending and forwarding documents are both still being built. Your household is ready for them when they land.">
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
