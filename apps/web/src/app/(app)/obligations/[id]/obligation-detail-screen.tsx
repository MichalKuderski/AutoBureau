"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Chip,
  OBLIGATION_KIND_LABEL,
  OBLIGATION_LABEL,
  OBLIGATION_TONE,
} from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState, describeError } from "@/components/ui/error-state";
import { Icon } from "@/components/ui/icon";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ReviewPanel } from "@/components/patterns/review-panel";
import { OutcomeDialog } from "./outcome-dialog";
import { useDocument, useObligation, useUpdateObligationStatus } from "@/lib/domain/queries";
import { formatDate, formatDueLabel, formatMoney, formatRecurrence } from "@/lib/format";
import { useHousehold } from "@/providers/household-provider";
import type { ObligationView } from "@/lib/domain/types";
import type { ObligationOutcome } from "@autobureau/contracts";

/**
 * One obligation, in full.
 *
 * This is the screen the reminder email lands on (CJ-3), so it has to answer four
 * questions in the order a worried person asks them: *what is this*, *when does it
 * actually bite*, *why do you think so*, and *what do I do now*. The layout follows
 * that order top to bottom on a phone, and left-then-right on a desktop.
 *
 * Provenance is not a footnote here — it is the section that earns the rest of the
 * page (FOUNDING_PRINCIPLES §4.2). The source document opens in place rather than
 * navigating away, because the user is mid-decision and losing this page to check a
 * date is how people end up trusting their own memory instead.
 */
export function ObligationDetailScreen({ id }: { id: string }) {
  const { household, can } = useHousehold();
  const query = useObligation(household.id, id);

  if (query.isPending) return <DetailSkeleton />;

  if (query.isError) {
    return (
      <Shell>
        <ErrorState {...describeError(query.error)} onRetry={() => void query.refetch()} />
      </Shell>
    );
  }

  if (!query.data) {
    return (
      <Shell>
        <EmptyState
          icon={<Icon.Search className="size-5" />}
          title="We couldn't find that obligation"
          description="It may have been removed, or the link may be out of date. Nothing else in your household has changed."
          action={{ label: "Back to obligations", href: "/obligations" }}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <Detail obligation={query.data} canWrite={can("write")} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl">
      <Link
        href="/obligations"
        className="mb-4 inline-flex items-center gap-1 text-sm text-ink-secondary transition-colors hover:text-ink"
      >
        <Icon.ChevronRight className="size-3.5 rotate-180" />
        All obligations
      </Link>
      {children}
    </div>
  );
}

function Detail({ obligation, canWrite }: { obligation: ObligationView; canWrite: boolean }) {
  const { household } = useHousehold();
  const { toast } = useToast();
  const updateStatus = useUpdateObligationStatus(household.id);

  const [completing, setCompleting] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);

  const isClosed = obligation.status === "done" || obligation.status === "dismissed";
  const isEntitlement = obligation.direction === "owed_to_household";
  const sourceDocumentId = obligation.provenance?.document_id ?? obligation.source_document_id;
  const money =
    obligation.amount_cents != null && obligation.currency
      ? formatMoney(
          { amountCents: obligation.amount_cents, currency: obligation.currency },
          household.locale,
        )
      : null;

  const previousStatus = obligation.status;
  const transition = (status: ObligationView["status"], outcome?: ObligationOutcome) => {
    updateStatus.mutate(
      outcome === undefined ? { id: obligation.id, status } : { id: obligation.id, status, outcome },
      {
        onSuccess: () =>
          toast({
            tone: status === "done" ? "success" : "info",
            title: TRANSITION_TOAST[status] ?? "Updated",
            description: obligation.title,
            action: {
              label: "Undo",
              onClick: () => updateStatus.mutate({ id: obligation.id, status: previousStatus }),
            },
          }),
        onError: () =>
          toast({
            tone: "critical",
            title: "Couldn't update that",
            description: "Nothing changed. Try again in a moment.",
          }),
      },
    );
  };

  return (
    <>
      <header className="mb-6">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <Chip tone={OBLIGATION_TONE[obligation.status] ?? "neutral"} dot>
            {OBLIGATION_LABEL[obligation.status] ?? obligation.status}
          </Chip>
          {isEntitlement ? (
            <Chip tone="success" title="Money or value owed to your household">
              You&apos;re owed
            </Chip>
          ) : null}
          <Chip tone="neutral">
            {OBLIGATION_KIND_LABEL[obligation.kind] ?? obligation.kind}
          </Chip>
        </div>

        <h1 className="text-2xl leading-tight sm:text-3xl">{obligation.title}</h1>

        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-secondary">
          <span>{obligation.member_name ?? "Whole household"}</span>
          {obligation.item_name ? (
            <>
              <span aria-hidden className="text-ink-tertiary">
                ·
              </span>
              <Link href="/household" className="hover:text-accent">
                {obligation.item_name}
              </Link>
            </>
          ) : null}
        </p>
      </header>

      <StatusBanner obligation={obligation} money={money} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">The dates</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col divide-y divide-line">
                <Row label="Due">
                  <time dateTime={obligation.due_at} data-tabular>
                    {formatDate(obligation.due_at, {
                      locale: household.locale,
                      timeZone: household.timezone,
                      style: "long",
                    })}
                  </time>
                  <span className="mt-0.5 block text-xs text-ink-tertiary">
                    {formatDueLabel(obligation.due_at, household.timezone)}
                  </span>
                </Row>

                {obligation.window_start ? (
                  <Row label="Window opened">
                    <time dateTime={obligation.window_start} data-tabular>
                      {formatDate(obligation.window_start, {
                        locale: household.locale,
                        timeZone: household.timezone,
                      })}
                    </time>
                  </Row>
                ) : null}

                {obligation.grace_until ? (
                  <Row label="Grace period">
                    <span data-tabular>
                      Still accepted until{" "}
                      {formatDate(obligation.grace_until, {
                        locale: household.locale,
                        timeZone: household.timezone,
                      })}
                    </span>
                  </Row>
                ) : null}

                {formatRecurrence(obligation.recurrence) ? (
                  <Row label="Repeats">{formatRecurrence(obligation.recurrence)}</Row>
                ) : null}

                {money ? (
                  <Row label={isEntitlement ? "You're owed" : "Amount"}>
                    <span
                      className={cn("font-medium", isEntitlement && "text-success")}
                      data-tabular
                    >
                      {money}
                    </span>
                  </Row>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <ProvenanceCard obligation={obligation} onOpenSource={() => setSourceOpen(true)} />
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {isClosed ? "This one's closed" : "What happens next"}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {!canWrite ? (
                <p className="text-sm text-ink-secondary">
                  You can see everything here, but changing it needs write access. Ask a household
                  owner.
                </p>
              ) : isClosed ? (
                <>
                  <p className="mb-1 text-sm text-ink-secondary">
                    {obligation.status === "dismissed"
                      ? "Dismissed obligations stay recoverable for 30 days."
                      : "Marked as handled. Reopen it if something changed."}
                  </p>
                  <Button
                    variant="secondary"
                    fullWidth
                    loading={updateStatus.isPending}
                    onClick={() => transition("action_needed")}
                  >
                    Reopen
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="primary"
                    fullWidth
                    iconLeft={<Icon.Check className="size-4" />}
                    onClick={() => setCompleting(true)}
                  >
                    Mark as done
                  </Button>
                  {obligation.status !== "in_progress" ? (
                    <Button
                      variant="secondary"
                      fullWidth
                      loading={updateStatus.isPending}
                      onClick={() => transition("in_progress")}
                    >
                      I&apos;m working on it
                    </Button>
                  ) : null}
                  <Button variant="ghost" fullWidth onClick={() => setDismissing(true)}>
                    Dismiss
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <FreshnessNote obligation={obligation} />
        </div>
      </div>

      <OutcomeDialog
        open={completing}
        obligation={obligation}
        onClose={() => setCompleting(false)}
        onSubmit={(outcome) => {
          setCompleting(false);
          transition("done", outcome);
        }}
      />

      <ConfirmDialog
        open={dismissing}
        onClose={() => setDismissing(false)}
        onConfirm={() => {
          setDismissing(false);
          transition("dismissed");
        }}
        title="Dismiss this obligation?"
        description="We'll stop reminding you about it. You can bring it back for the next 30 days."
        confirmLabel="Dismiss"
        tone="primary"
        loading={updateStatus.isPending}
      />

      {sourceDocumentId ? (
        <SourceDocumentDrawer
          open={sourceOpen}
          documentId={sourceDocumentId}
          onClose={() => setSourceOpen(false)}
        />
      ) : null}
    </>
  );
}

const TRANSITION_TOAST: Record<string, string> = {
  done: "Marked as done",
  dismissed: "Dismissed",
  in_progress: "Marked as in progress",
  action_needed: "Reopened",
};

/**
 * The one-line answer to "how worried should I be", stated in words before colour.
 * Closed obligations get the reassuring variant rather than no banner at all — the
 * absence of a banner reads as "we forgot about this".
 */
function StatusBanner({
  obligation,
  money,
}: {
  obligation: ObligationView;
  money: string | null;
}) {
  const { household } = useHousehold();
  const isEntitlement = obligation.direction === "owed_to_household";

  if (obligation.status === "done") {
    const cost = obligation.outcome?.cost_cents;
    return (
      <Alert tone="success" title="Handled">
        {cost != null && cost > 0
          ? `Closed out at ${formatMoney({ amountCents: cost, currency: obligation.currency ?? "USD" }, household.locale)}.`
          : "Nothing further is needed on this one."}
      </Alert>
    );
  }

  if (obligation.status === "dismissed") {
    return (
      <Alert tone="info" title="You dismissed this">
        We&apos;ve stopped reminding you. Reopen it any time in the next 30 days.
      </Alert>
    );
  }

  if (obligation.status === "missed" || obligation.days_until < 0) {
    return (
      <Alert tone="critical" title={formatDueLabel(obligation.due_at, household.timezone)}>
        {obligation.grace_until
          ? `There is still a grace period — it runs to ${formatDate(obligation.grace_until, { locale: household.locale, timeZone: household.timezone })}.`
          : "It may still be possible to act. Check the source document below for the exact terms."}
      </Alert>
    );
  }

  if (isEntitlement) {
    return (
      <Alert tone="info" title={money ? `${money} is owed to your household` : "Owed to you"}>
        This is value to collect, not a task to fear. The window closes{" "}
        {formatDate(obligation.due_at, {
          locale: household.locale,
          timeZone: household.timezone,
        })}
        .
      </Alert>
    );
  }

  if (obligation.priority === 1 && obligation.days_until <= 30) {
    return (
      <Alert tone="warning" title={formatDueLabel(obligation.due_at, household.timezone)}>
        This one is hard to undo if it lapses, so we&apos;ve given it priority.
      </Alert>
    );
  }

  return (
    <Alert tone="info" title={formatDueLabel(obligation.due_at, household.timezone)}>
      You have room. We&apos;ll remind you again as the date gets closer.
    </Alert>
  );
}

/**
 * "Why does this exist?" — answered on the page, not in a support article.
 *
 * An AI-derived obligation shows the document, the excerpt, and how confident the
 * extraction was. A system- or user-created one says so plainly instead of implying
 * evidence it doesn't have (PRD §15.3: never confidently wrong).
 */
function ProvenanceCard({
  obligation,
  onOpenSource,
}: {
  obligation: ObligationView;
  onOpenSource: () => void;
}) {
  const { household } = useHousehold();
  const { provenance } = obligation;

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Icon.Shield className="size-4.5 text-ink-tertiary" />
            Why this is here
          </CardTitle>
          <p className="mt-1 text-sm text-ink-secondary">{originLine(obligation.source)}</p>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {provenance ? (
          <div className="rounded-md border border-line bg-surface-sunken/60 p-3.5">
            <p className="flex items-center gap-2 text-sm font-medium text-ink">
              <Icon.Documents className="size-4 shrink-0 text-ink-tertiary" />
              <span className="min-w-0 truncate">{provenance.document_title}</span>
            </p>
            {provenance.excerpt ? (
              <blockquote className="mt-2 border-l-2 border-line-strong pl-3 text-sm text-ink-secondary italic">
                {provenance.excerpt}
              </blockquote>
            ) : null}
            <p className="mt-2 text-xs text-ink-tertiary">
              Read{" "}
              {formatDate(provenance.captured_at, {
                locale: household.locale,
                timeZone: household.timezone,
              })}
            </p>
            <Button variant="link" className="mt-2.5 text-sm" onClick={onOpenSource}>
              See the document
            </Button>
          </div>
        ) : (
          <p className="text-sm text-ink-secondary">
            There&apos;s no source document behind this one — nothing to check against. If the date
            is wrong, correct it and we&apos;ll follow your version.
          </p>
        )}

        {obligation.ai_confidence != null ? (
          <p className="flex items-start gap-2 text-xs text-ink-tertiary">
            <Icon.Sparkle className="mt-0.5 size-3.5 shrink-0" />
            We read this at {Math.round(obligation.ai_confidence * 100)}% confidence. Anything you
            correct teaches us.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function originLine(source: ObligationView["source"]): string {
  switch (source) {
    case "ai":
      return "AutoBureau found this in a document your household sent us.";
    case "system":
      return "AutoBureau created this from a cycle it already tracks for you.";
    case "user":
      return "Someone in your household added this by hand.";
  }
}

function FreshnessNote({ obligation }: { obligation: ObligationView }) {
  const { household } = useHousehold();
  if (!obligation.verified_at) return null;
  return (
    <p className="flex items-start gap-2 px-1 text-xs text-ink-tertiary text-pretty">
      <Icon.Clock className="mt-0.5 size-3.5 shrink-0" />
      Last confirmed{" "}
      {formatDate(obligation.verified_at, {
        locale: household.locale,
        timeZone: household.timezone,
      })}
      . We re-check facts as new documents arrive.
    </p>
  );
}

/**
 * The source document, opened in place. Reuses the same review panel the documents
 * queue uses, so a correction made from here is the identical flow — and there is
 * exactly one implementation of "show me what you read".
 */
function SourceDocumentDrawer({
  open,
  documentId,
  onClose,
}: {
  open: boolean;
  documentId: string | null;
  onClose: () => void;
}) {
  const { household } = useHousehold();
  const query = useDocument(household.id, documentId ?? "");

  return (
    <Modal
      variant="drawer"
      open={open && documentId !== null}
      onClose={onClose}
      title={query.data?.title ?? "Source document"}
      {...(query.data
        ? {
            description: `${query.data.member_name ?? "Whole household"} · added ${formatDate(query.data.created_at, { locale: household.locale, timeZone: household.timezone })}`,
          }
        : {})}
    >
      {query.isPending ? (
        <SkeletonGroup className="flex flex-col gap-3" label="Loading document">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-24 w-full rounded-md" />
        </SkeletonGroup>
      ) : query.data ? (
        <ReviewPanel document={query.data} onDone={onClose} />
      ) : (
        <p className="text-sm text-ink-secondary">
          That document is no longer available. The facts it produced are still in your ledger.
        </p>
      )}
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-sm text-ink-tertiary">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-ink">{children}</dd>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <Shell>
      <SkeletonGroup className="flex flex-col gap-6" label="Loading obligation">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-28 rounded-full" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-16 w-full rounded-lg" />
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Skeleton className="h-56 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
        </div>
      </SkeletonGroup>
    </Shell>
  );
}
