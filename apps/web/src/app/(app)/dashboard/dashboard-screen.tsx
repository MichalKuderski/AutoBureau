"use client";

import Link from "next/link";
import { PageHeader } from "@/components/patterns/page-header";
import { ObligationCard } from "@/components/patterns/obligation-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBoundary, ErrorState, describeError } from "@/components/ui/error-state";
import { Icon } from "@/components/ui/icon";
import { SkeletonList, Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/cn";
import { formatDate, formatMoney } from "@/lib/format";
import { useHousehold } from "@/providers/household-provider";
import { useObligations, useSummary, useUpdateObligationStatus } from "@/lib/domain/queries";
import { useToast } from "@/components/ui/toast";

/**
 * "Today" — the screen that has to earn the subscription.
 *
 * Ordering encodes the product's promise: what needs you now, then reassurance about
 * what doesn't, then value recovered. The reassurance panel is not filler — PRD §15.4
 * treats "nothing at risk this week" as a feature, because the paid-for outcome of
 * this product is usually *nothing happening*, and a screen that renders silence as
 * emptiness fails to show the user what they're paying for.
 */
export function DashboardScreen() {
  const { household, viewer } = useHousehold();
  const summary = useSummary(household.id);
  const actionNeeded = useObligations(household.id, { status: ["action_needed"] });
  const upcoming = useObligations(household.id, { status: ["upcoming"], dueWithinDays: 45 });
  const entitlements = useObligations(household.id, { direction: "owed_to_household" });
  const updateStatus = useUpdateObligationStatus(household.id);
  const { toast } = useToast();

  const firstName = viewer.displayName.split(" ")[0];

  const complete = (id: string, title: string) => {
    updateStatus.mutate(
      { id, status: "done" },
      {
        onSuccess: () =>
          toast({
            title: "Marked as done",
            description: title,
            tone: "success",
            action: {
              label: "Undo",
              onClick: () => updateStatus.mutate({ id, status: "action_needed" }),
            },
          }),
        onError: () =>
          toast({ title: "Couldn't update that", description: "Try again in a moment.", tone: "critical" }),
      },
    );
  };

  const openEntitlements = (entitlements.data ?? []).filter((o) => o.status !== "done");

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={`Good ${timeOfDay()}, ${firstName}`}
        description={
          summary.data
            ? summaryLine(summary.data.action_needed, summary.data.upcoming_30d)
            : undefined
        }
        actions={
          <Link
            href="/documents/upload"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-line-strong bg-surface px-4 text-sm font-medium transition-colors hover:bg-surface-sunken"
          >
            <Icon.Camera className="size-4" />
            Add document
          </Link>
        }
      />

      <ErrorBoundary region="dashboard-stats">
        <StatRow />
      </ErrorBoundary>

      <section aria-labelledby="needs-attention" className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="needs-attention" className="text-xl">
            Needs your attention
          </h2>
          {(actionNeeded.data?.length ?? 0) > 0 ? (
            <Link
              href="/obligations"
              className="text-sm font-medium text-accent hover:text-accent-hover"
            >
              View all
            </Link>
          ) : null}
        </div>

        {actionNeeded.isPending ? (
          <SkeletonList count={2} />
        ) : actionNeeded.isError ? (
          <ErrorState {...describeError(actionNeeded.error)} onRetry={() => actionNeeded.refetch()} />
        ) : actionNeeded.data.length === 0 ? (
          <EmptyState
            tone="reassuring"
            icon={<Icon.Check className="size-5" />}
            title="Nothing needs you right now"
            description="We're watching every deadline in your household. You'll hear from us before anything is at risk."
          />
        ) : (
          <div className="flex flex-col gap-3">
            {actionNeeded.data.map((o) => (
              <ObligationCard
                key={o.id}
                obligation={o}
                onComplete={() => complete(o.id, o.title)}
              />
            ))}
          </div>
        )}
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="coming-up">
          <h2 id="coming-up" className="mb-3 text-xl">
            Coming up
          </h2>
          {upcoming.isPending ? (
            <SkeletonList count={3} />
          ) : upcoming.data && upcoming.data.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              {upcoming.data.slice(0, 4).map((o) => (
                <ObligationCard key={o.id} obligation={o} compact />
              ))}
            </div>
          ) : (
            <EmptyState
              title="Nothing in the next six weeks"
              description="Your horizon is clear. We'll surface things as they approach."
            />
          )}
        </section>

        <div className="flex flex-col gap-6">
          <ErrorBoundary region="dashboard-entitlements">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Icon.Wallet className="size-4.5 text-success" />
                    You're owed
                  </CardTitle>
                  <p className="mt-1 text-sm text-ink-secondary">
                    Money and value your household hasn't collected yet.
                  </p>
                </div>
              </CardHeader>
              <CardContent>
                {entitlements.isPending ? (
                  <SkeletonGroup className="flex flex-col gap-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-4 w-1/2" />
                  </SkeletonGroup>
                ) : openEntitlements.length === 0 ? (
                  <p className="text-sm text-ink-secondary">
                    Nothing outstanding — we'll flag warranties, deposits, and refunds as we find them.
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y divide-line">
                    {openEntitlements.map((o) => (
                      <li key={o.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
                        <Link
                          href={`/obligations/${o.id}` as never}
                          className="min-w-0 flex-1 text-sm hover:text-accent"
                        >
                          <span className="block truncate">{o.title}</span>
                          <span className="text-2xs text-ink-tertiary">{o.item_name}</span>
                        </Link>
                        {o.amount_cents != null && o.currency ? (
                          <span className="shrink-0 text-sm font-medium text-success" data-tabular>
                            {formatMoney(
                              { amountCents: o.amount_cents, currency: o.currency },
                              household.locale,
                            )}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </ErrorBoundary>

          <CoveragePanel />
        </div>
      </div>
    </div>
  );
}

function StatRow() {
  const { household } = useHousehold();
  const { data, isPending, isError, error, refetch } = useSummary(household.id);

  if (isPending) {
    return (
      <SkeletonGroup className="grid grid-cols-2 gap-3 sm:grid-cols-4" label="Loading summary">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </SkeletonGroup>
    );
  }
  if (isError) return <ErrorState {...describeError(error)} onRetry={() => refetch()} />;

  const stats = [
    { label: "Need action", value: data.action_needed, href: "/obligations", tone: data.action_needed > 0 ? "warning" : "neutral" },
    { label: "Next 30 days", value: data.upcoming_30d, href: "/calendar", tone: "neutral" },
    { label: "To review", value: data.needs_review, href: "/documents?status=needs_review", tone: data.needs_review > 0 ? "info" : "neutral" },
    { label: "Tracked", value: data.items_tracked, href: "/household", tone: "neutral" },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((s) => (
        <Link
          key={s.label}
          href={s.href as never}
          className={cn(
            "rounded-lg border border-line bg-surface p-4 transition-colors hover:border-line-strong",
          )}
        >
          <p className="text-2xl font-semibold text-ink" data-tabular>
            {s.value}
          </p>
          <p className="mt-0.5 text-sm text-ink-secondary">{s.label}</p>
        </Link>
      ))}
    </div>
  );
}

/**
 * Coverage is the ledger thesis made visible: how much of the household's actual
 * standing we've captured. It is the honest counterweight to a reassuring dashboard —
 * "nothing at risk" means less when we only know about half your paperwork.
 */
function CoveragePanel() {
  const { household } = useHousehold();
  const { data } = useSummary(household.id);
  if (!data) return null;

  const pct = Math.round((data.coverage.captured / data.coverage.expected) * 100);

  return (
    <Card>
      <CardHeader>
        <div className="w-full">
          <CardTitle className="text-lg">How complete is your ledger?</CardTitle>
          <p className="mt-1 text-sm text-ink-secondary">
            You told us about {data.coverage.expected} things during setup. We're tracking{" "}
            {data.coverage.captured}.
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Ledger coverage"
          className="h-2 overflow-hidden rounded-full bg-surface-sunken"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-sm font-medium">{pct}% covered</span>
          <Link href="/household" className="text-sm font-medium text-accent hover:text-accent-hover">
            Fill the gaps
          </Link>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-2xs text-ink-tertiary">
          <Icon.Clock className="size-3.5" />
          Next weekly summary {formatDate(data.next_digest_at, { timeZone: household.timezone })}
        </p>
      </CardContent>
    </Card>
  );
}

function timeOfDay(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

function summaryLine(action: number, upcoming: number): string {
  if (action === 0 && upcoming === 0) return "Nothing needs you, and nothing is coming up soon.";
  if (action === 0) return `Nothing needs you today. ${upcoming} coming up in the next month.`;
  return `${action} ${action === 1 ? "thing needs" : "things need"} your attention. ${upcoming} coming up in the next month.`;
}
