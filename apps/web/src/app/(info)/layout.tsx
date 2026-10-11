import Link from "next/link";
import { BrandMark } from "@/components/brand/brand-mark";
import { PublicFooter } from "@/components/public/public-footer";

export default function InfoLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-canvas">
    <a href="#main" className="sr-only-focusable fixed left-4 top-4 z-50 rounded-md bg-accent px-4 py-2 text-accent-ink">Skip to main content</a>
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-serif text-lg font-semibold"><BrandMark className="size-8 text-accent" />Pellum</Link>
        <nav aria-label="Public navigation" className="ml-auto flex gap-5 text-sm font-medium">
          <Link href="/help" className="py-2 hover:underline">Help & FAQ</Link>
          <Link href="/sign-in" className="py-2 hover:underline">Sign in</Link>
        </nav>
      </div>
    </header>
    <main id="main" tabIndex={-1} className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-16">
      <p className="mb-4 text-sm font-medium text-accent">Private preview · Sample data only</p>
      {children}
      <p className="mt-10 text-sm text-ink-tertiary">Content reviewed <time dateTime="2026-10-11">October 11, 2026</time>. Availability can differ between local tests and hosted previews.</p>
    </main>
    <PublicFooter />
  </div>;
}
