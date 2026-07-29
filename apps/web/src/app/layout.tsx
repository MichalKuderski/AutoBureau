import type { Metadata, Viewport } from "next";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint — no flash of the wrong theme. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
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
