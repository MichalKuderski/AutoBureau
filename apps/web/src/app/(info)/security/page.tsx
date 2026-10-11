import type { Metadata } from "next";
import Link from "next/link";
export const metadata: Metadata = { title: "Security status" };
export default function Page() { return <>
<h1 className="text-3xl sm:text-4xl">Security status</h1><p className="mt-4 max-w-2xl text-lg text-ink-secondary">Security design is not proof that a service is ready for sensitive records.</p>
<div className="mt-8 max-w-3xl space-y-5">
<section className="rounded-lg border border-line bg-surface p-6"><h2 className="text-xl">What this preview is for</h2><p className="mt-3 leading-relaxed text-ink-secondary">Explore Pellum with synthetic sample data. Document safety scanning, key custody and recovery verification remain incomplete. Do not use this preview as the only copy of a record or as a reliable deadline reminder.</p></section>
<section className="rounded-lg border border-line bg-surface p-6"><h2 className="text-xl">Access and account safety</h2><p className="mt-3 leading-relaxed text-ink-secondary">Household screens require sign-in, and application data access is scoped to a household. Those controls do not establish a certification or a completed security audit. Never share passwords or recovery links.</p></section>
<section className="rounded-lg border border-line bg-surface p-6"><h2 className="text-xl">What is not being claimed</h2><p className="mt-3 leading-relaxed text-ink-secondary">This page does not claim end-to-end encryption, HIPAA compliance, SOC 2 certification, guaranteed recovery or verified retention periods. The team must verify operational controls before sensitive-data use.</p></section>
<section className="rounded-lg border border-line bg-surface p-6"><h2 className="text-xl">Report a concern</h2><p className="mt-3 leading-relaxed text-ink-secondary">A public security-reporting contact has not been published yet. Tell the person coordinating your preview about a suspected problem, including the screen and time, without sending credentials or document contents.</p></section>
</div><Link href="/help" className="mt-8 inline-block font-medium text-accent underline underline-offset-4">Browse help and frequently asked questions</Link></>; }
