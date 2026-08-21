import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { NONCE_HEADER } from "@/server/http/csp";
import { ThemeProvider, themeInitScript } from "@/providers/theme-provider";
import { QueryProvider } from "@/providers/query-provider";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AutoBureau — your household's paperwork, handled",
    template: "%s · AutoBureau",
  },
  description:
    "AutoBureau keeps track of every renewal, deadline, and document for your household — and tells you exactly what to do, with time to do it.",
  applicationName: "AutoBureau",
  formatDetection: { telephone: false, address: false, email: false },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1413" },
  ],
};

/**
 * Reading a request header here opts the entire tree out of static prerendering, and that
 * is the point rather than a side effect. A page rendered at build time would carry its
 * inline scripts stamped with whatever nonce existed at build time — i.e. none — while
 * the response served alongside it carries a fresh one, and the browser would block
 * every script on the page. Under a per-request nonce, per-request rendering is not
 * optional; the eight pages that used to prerender now render on demand.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get(NONCE_HEADER);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Applies the stored theme before first paint — no flash of the wrong theme.
          The nonce is what keeps this executable now that `script-src` no longer carries
          `'unsafe-inline'`; it is the same value the response's policy names.

          `suppressHydrationWarning` is load-bearing, not decoration. Browsers blank the
          `nonce` *content attribute* once the element is parsed — an anti-exfiltration
          rule in the CSP spec, so a `script[nonce=…]` CSS selector cannot read it back —
          while keeping the IDL property. Hydration compares the attribute, so it sees
          the server's value against an empty string and reports a mismatch on every
          page. The script has already run by then and there is nothing to patch up.
        */}
        <script
          nonce={nonce ?? undefined}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      <body className="min-h-dvh antialiased">
        <ThemeProvider>
          <QueryProvider>
            <ToastProvider>{children}</ToastProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
