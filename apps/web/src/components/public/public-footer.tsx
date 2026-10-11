import Link from "next/link";

export function PublicFooter() {
  return <footer className="border-t border-line py-8">
    <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 text-sm text-ink-secondary sm:px-6">
      <p>Private development preview. Use synthetic sample data only. Do not upload real sensitive documents.</p>
      <nav aria-label="Help and trust" className="flex flex-wrap gap-x-6 gap-y-3">
        <Link href="/help" className="underline underline-offset-4">Help & FAQ</Link>
        <Link href="/privacy" className="underline underline-offset-4">Privacy preview notice</Link>
        <Link href="/security" className="underline underline-offset-4">Security status</Link>
        <Link href="/terms" className="underline underline-offset-4">Terms status</Link>
      </nav>
      <p className="text-ink-tertiary">Pellum · A little less to carry.</p>
    </div>
  </footer>;
}
