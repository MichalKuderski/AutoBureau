import type { Metadata } from "next";
import Link from "next/link";
export const metadata: Metadata = { title: "Help & FAQ" };

const topics = [
  { id: "getting-started", title: "Getting started", answers: [
    { question: "What is Pellum?", answer: "Pellum is being built to organize household records and the next things to do. This private preview lets invited testers explore the screens with synthetic sample data; it is not ready to hold sensitive family paperwork.", href: "/", action: "About Pellum" },
    { question: "What can I try today?", answer: "You can explore the household ledger, document list and obligation views with a test account. General AI document reading, live payments and live bank connections are not operational in this preview.", href: "/dashboard", action: "Open Today (sign-in required)" },
    { question: "Do I have to upload a document to get started?", answer: "No. Skip the document step during onboarding and explore with sample data. Do not upload real identity, medical, financial or other sensitive documents while the preview checks remain incomplete.", href: "/onboarding", action: "Open onboarding (sign-in required)" },
  ] },
  { id: "documents", title: "Documents and readings", answers: [
    { question: "Can I use AI to read my documents?", answer: "Live AI extraction is disabled. Synthetic reading demonstrations and offline prototypes do not establish accuracy on your documents; review any displayed date against its source before relying on it.", href: "/documents", action: "Open documents (sign-in required)" },
    { question: "Can I correct a reading or open its original?", answer: "The review experience is still being built. A field or source label on a demo screen does not guarantee that a correction is saved or an original is available; follow the status shown beside the action.", href: "/documents", action: "Review document status (sign-in required)" },
    { question: "Which files can I upload?", answer: "Use only approved synthetic fixtures when testing. The upload screen shows the types and size limit supported in that environment, and may refuse uploads entirely while intake is disabled.", href: "/documents/upload", action: "Check upload availability (sign-in required)" },
  ] },
  { id: "household", title: "Household and reminders", answers: [
    { question: "Does a household member automatically get access?", answer: "A person listed in your household is not automatically a user account or an invitation. Do not add another person's real information during testing; shared-access behavior needs separate verification.", href: "/household", action: "View household (sign-in required)" },
    { question: "Can I rely on a reminder or an empty dashboard?", answer: "Keep your existing reminders during the preview. An empty view describes only the records loaded in that view, and a loading or service error does not mean you have no upcoming deadlines.", href: "/obligations", action: "Review obligations (sign-in required)" },
    { question: "What should I do if a page cannot load?", answer: "Use its Retry control once and wait for it to finish. If the problem continues, tell the person coordinating your preview which screen failed and when; do not send passwords or document contents.", href: "/dashboard", action: "Return to Today (sign-in required)" },
  ] },
  { id: "privacy-billing", title: "Privacy, accounts and billing", answers: [
    { question: "Where can I learn about data use and security?", answer: "The preview notices describe current limits and the checks still outstanding. They do not claim verified encryption coverage, model-training terms, retention periods or regulatory certification.", href: "/privacy", action: "Read the privacy preview notice" },
    { question: "Can I export or delete my data?", answer: "Local synthetic tests exist, but hosted export and deletion are not ready for real-data use. Check Privacy & data for the availability shown in your environment; do not treat a request as completed until a verified result says so.", href: "/settings/privacy", action: "Open Privacy & data (sign-in required)" },
    { question: "Will I be charged or connected to my bank?", answer: "Live billing and bank connections are not available in this preview. Planned prices and sandbox demonstrations are not a purchase or a live financial connection; do not enter real payment or bank details for testing.", href: "/settings/connections", action: "View connection status (sign-in required)" },
    { question: "What if I cannot sign in or need help?", answer: "Use the sign-in screen to see the recovery options available in your environment. A public support contact has not been published yet; contact the person coordinating your preview, without sending passwords, recovery links or sensitive files.", href: "/sign-in", action: "Go to sign in" },
  ] },
];

export default function HelpPage() {
  return <>
    <h1 className="text-3xl sm:text-4xl">A little help, when you need it.</h1>
    <p className="mt-4 max-w-2xl text-lg text-ink-secondary">What Pellum does today, what is still being tested, and where to go next.</p>
    <aside aria-label="Preview limits" className="mt-7 rounded-lg border border-line-strong bg-surface p-5">
      <h2 className="text-lg">Before you add anything</h2>
      <p className="mt-2 max-w-3xl text-ink-secondary">Use synthetic sample data only. Document safety, recovery and data-lifecycle checks are still incomplete. Live AI reading, payments and bank connections are disabled.</p>
    </aside>
    <div className="mt-10 grid items-start gap-8 lg:grid-cols-[14rem_1fr]">
      <nav aria-label="FAQ topics" className="rounded-lg border border-line bg-surface p-5 lg:sticky lg:top-6">
        <h2 className="text-lg">Find an answer</h2>
        <ul className="mt-3 space-y-3">{topics.map(t => <li key={t.id}><a className="text-sm underline underline-offset-4" href={`#${t.id}`}>{t.title}</a></li>)}</ul>
        <a href="#weekly-review" className="mt-4 block text-sm underline underline-offset-4">A simple weekly review</a>
      </nav>
      <div className="space-y-9">{topics.map(t => <section key={t.id} aria-labelledby={t.id}>
        <h2 id={t.id} className="scroll-mt-6 text-2xl">{t.title}</h2>
        <div className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">{t.answers.map(a => <details key={a.question} className="group px-5 py-1">
          <summary className="cursor-pointer py-4 font-medium marker:text-accent">{a.question}</summary>
          <div className="pb-5 pl-4 text-ink-secondary"><p className="leading-relaxed">{a.answer}</p><Link href={a.href as never} className="mt-3 inline-block text-sm font-medium text-accent underline underline-offset-4">{a.action}</Link></div>
        </details>)}</div>
      </section>)}</div>
    </div>
    <section aria-labelledby="weekly-review" className="mt-12 rounded-lg border border-line bg-accent-soft p-6 sm:p-8">
      <h2 id="weekly-review" className="text-2xl">A simple weekly review</h2>
      <p className="mt-2 text-ink-secondary">Try this with sample records. No streaks, scores or pressure to check every day.</p>
      <ol className="mt-5 grid list-inside list-decimal gap-5 sm:grid-cols-3">
        <li><Link href="/obligations" className="font-medium underline underline-offset-4">Look at what is coming up</Link><p className="mt-2 text-sm text-ink-secondary">Check the date range and whether every section loaded.</p></li>
        <li><Link href="/documents" className="font-medium underline underline-offset-4">Check the evidence</Link><p className="mt-2 text-sm text-ink-secondary">Compare a date with its original before acting.</p></li>
        <li><Link href="/settings/notifications" className="font-medium underline underline-offset-4">Review reminder preferences</Link><p className="mt-2 text-sm text-ink-secondary">Keep your existing reminders until delivery is verified.</p></li>
      </ol>
    </section>
  </>;
}
