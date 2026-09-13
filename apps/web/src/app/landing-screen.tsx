import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";
import { Icon } from "@/components/ui/icon";

/**
 * The public landing page.
 *
 * **Register.** Relief, not fear. The P0 landing test runs three messages — fear,
 * found-money, relief (`ops/p0/landing-copy.md`) — and G1 picks the winner. Until it
 * does, the PRD's frozen wedge and copy register bind (§4, §15.7), and that is the
 * caregiver relief voice used here. A copy-register change is one of exactly three
 * things the §4.1 override clause permits, so this page is written to be rewritten.
 *
 * **What it refuses to do.** No urgency theatre, no counted-down deadlines, no
 * invented statistic about how much the average household loses. Fear is not a growth
 * mechanic in a product sold to people who are already frightened (PRD §15.1) — and
 * an unsourced number on a marketing page is exactly the kind of confidently-wrong
 * claim the rest of the product is engineered to avoid.
 *
 * The section on what Pellum will never do is not a disclaimer at the bottom. It
 * is the middle of the page, because for this category the boundary *is* the pitch.
 *
 * Rendered as a server component with no client JavaScript of its own: this is the
 * LCP surface (PRD §17), and a marketing page that ships a hydration bundle to say
 * four static things has already failed its one performance requirement.
 */
export function LandingScreen() {
  return (
    <div className="min-h-dvh bg-canvas">
      <a
        href="#main"
        className="sr-only-focusable fixed left-4 top-4 z-50 rounded-md bg-accent px-4 py-2 text-accent-ink shadow-lg"
      >
        Skip to main content
      </a>

      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-4 sm:px-6">
          <BrandMark className="size-8 shrink-0 text-accent" />
          <span className="font-serif text-lg font-semibold tracking-tight">Pellum</span>

          <nav aria-label="Account" className="ml-auto flex items-center gap-1.5">
            <Link
              href="/sign-in"
              className="rounded-md px-3 py-2 text-sm font-medium text-ink-secondary transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="inline-flex h-9 items-center rounded-md bg-accent px-3.5 text-sm font-medium text-accent-ink shadow-sm transition-colors hover:bg-accent-hover"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main id="main">
        <section className="mx-auto w-full max-w-5xl px-4 pb-14 pt-14 sm:px-6 sm:pb-20 sm:pt-24">
          <div className="max-w-2xl">
            <h1 className="text-4xl leading-[1.1] sm:text-5xl">
              A little less<br />to carry.
            </h1>
            <p className="mt-5 text-lg text-ink-secondary text-pretty">
              For the person who keeps the family&apos;s paperwork in mind.
              We&apos;re building a calmer place for important records, their sources,
              and the next thing to do.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/sign-up"
                className="inline-flex h-12 items-center rounded-md bg-accent px-6 text-lg font-medium text-accent-ink shadow-sm transition-colors hover:bg-accent-hover"
              >
                Start your household ledger
              </Link>
              <Link
                href="/sign-in"
                className="inline-flex h-12 items-center rounded-md border border-line-strong bg-surface px-5 text-base font-medium transition-colors hover:bg-surface-sunken"
              >
                I already have an account
              </Link>
            </div>

            <p className="mt-4 text-sm text-ink-tertiary text-pretty">
              Private preview. No card needed. No service is cancelled or paperwork filed on your behalf.
            </p>
          </div>
        </section>

        <section
          aria-labelledby="how-it-works"
          className="border-y border-line bg-surface py-14 sm:py-20"
        >
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
            <h2 id="how-it-works" className="text-2xl sm:text-3xl">
              The experience we’re building
            </h2>
            <ol className="mt-8 grid gap-8 sm:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title}>
                  <span
                    aria-hidden
                    className="flex size-9 items-center justify-center rounded-full bg-accent-soft font-medium text-accent tabular-nums"
                  >
                    {index + 1}
                  </span>
                  <h3 className="mt-3.5 text-lg">{step.title}</h3>
                  <p className="mt-1.5 text-ink-secondary text-pretty">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="what-you-see" className="py-14 sm:py-20">
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
            <h2 id="what-you-see" className="text-2xl sm:text-3xl">
              A clearer picture of what matters
            </h2>
            <div className="mt-8 grid gap-5 sm:grid-cols-3">
              {BENEFITS.map(({ title, body, Glyph }) => (
                <div key={title} className="rounded-lg border border-line bg-surface p-5">
                  <Glyph className="size-5 text-accent" />
                  <h3 className="mt-3 text-lg">{title}</h3>
                  <p className="mt-1.5 text-sm text-ink-secondary text-pretty">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          aria-labelledby="never"
          className="border-y border-line bg-surface py-14 sm:py-20"
        >
          <div className="mx-auto grid w-full max-w-5xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <h2 id="never" className="text-2xl sm:text-3xl">
                What Pellum will never do
              </h2>
              <p className="mt-3 text-ink-secondary text-pretty">
                This product holds some of the most sensitive paper a family owns. Every line below
                is a decision we made on purpose, not a feature we haven&apos;t got to yet.
              </p>
            </div>
            <ul className="flex flex-col gap-3">
              {NEVER.map((line) => (
                <li key={line} className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
                  >
                    <Icon.Shield className="size-3" />
                  </span>
                  <span className="text-ink-secondary text-pretty">{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="pricing" className="py-14 sm:py-20">
          <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
            <h2 id="pricing" className="text-2xl sm:text-3xl">
              Planned pricing
            </h2>
            <div className="mt-8 grid gap-5 sm:grid-cols-2">
              <div className="rounded-lg border border-line bg-surface p-6">
                <h3 className="text-xl">Free</h3>
                <p className="mt-1 text-sm text-ink-secondary">
                  Enough to find out whether this helps.
                </p>
                <ul className="mt-5 flex flex-col gap-2 text-sm text-ink-secondary">
                  {FREE_FEATURES.map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <Icon.Check className="mt-0.5 size-4 shrink-0 text-success" />
                      {line}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border-2 border-accent bg-surface p-6">
                <h3 className="text-xl">Premium</h3>
                <p className="mt-1 text-sm text-ink-secondary">
                  <span className="text-base font-medium text-ink">$12</span> a month, or{" "}
                  <span className="text-base font-medium text-ink">$99</span> a year.
                </p>
                <ul className="mt-5 flex flex-col gap-2 text-sm text-ink-secondary">
                  {PREMIUM_FEATURES.map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <Icon.Check className="mt-0.5 size-4 shrink-0 text-success" />
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="mt-4 text-sm text-ink-tertiary text-pretty">
              Paid plans are not available in this preview. These prices and features are provisional;
              final limits and cancellation terms will be shown before any purchase.
            </p>
          </div>
        </section>

        <section className="border-t border-line bg-surface py-14 sm:py-20">
          <div className="mx-auto w-full max-w-2xl px-4 text-center sm:px-6">
            <h2 className="text-2xl sm:text-3xl">Nothing lapses quietly</h2>
            <p className="mt-3 text-ink-secondary text-pretty">
              That is the whole promise. Everything else this product does is in service of it.
            </p>
            <Link
              href="/sign-up"
              className="mt-7 inline-flex h-12 items-center rounded-md bg-accent px-6 text-lg font-medium text-accent-ink shadow-sm transition-colors hover:bg-accent-hover"
            >
              Start your household ledger
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line py-8">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 text-sm text-ink-tertiary sm:px-6">
          <p className="text-pretty">
            Pellum is a private development preview. Document processing, reminders, billing
            and data export are still being implemented and verified. Use sample data during testing.
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>© {new Date().getFullYear()} Pellum</span>
            <Link href="/sign-in" className="underline-offset-4 hover:text-ink hover:underline">
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

const STEPS = [
  {
    title: "Send whatever arrives",
    body: "Forward an email, photograph a letter on the kitchen counter, or drop in a folder of PDFs. There is no filing to learn.",
  },
  {
    title: "We read it and file it",
    body: "Dates, amounts, and which member it belongs to — pulled out and filed against the document they came from.",
  },
  {
    title: "We warn you with room to act",
    body: "Not the night before. Early enough that handling it takes ten minutes instead of a weekend.",
  },
];

const BENEFITS = [
  {
    title: "Every deadline in one place",
    body: "Renewals, enrollment windows, cancellation deadlines, filings — for you, your parents, and your kids, on one page.",
    Glyph: Icon.Obligations,
  },
  {
    title: "What you're owed, too",
    body: "Refundable deposits, warranties still in force, claims never filed. Keep the evidence close when it is time to follow up.",
    Glyph: Icon.Wallet,
  },
  {
    title: "Every fact shows its source",
    body: "Tap any date and see the document it came from. When we're not sure, we ask instead of guessing.",
    Glyph: Icon.Documents,
  },
];

const NEVER = [
  "Log in to a bank, government, or insurance portal as you — we never ask for those passwords, and never store them.",
  "Move money, pay a bill, or cancel a service on its own. We prepare the paperwork; you decide what happens.",
  "Give financial, legal, or medical advice. We tell you what your documents say and when things are due.",
  "Sell your household's data, or use it to train a model for anyone else.",
  "Manufacture urgency. If nothing is at risk this week, we tell you that instead.",
];

const FREE_FEATURES = [
  "10 documents a month",
  "One person you care for, plus your own household",
  "Deadline tracking and reminders",
  "Data export (planned)",
];

const PREMIUM_FEATURES = [
  "Document allowance to be confirmed before launch",
  "Everyone in the household",
  "Forwarding address and inbox scanning",
  "Weekly summary and pre-filled action kits",
];
