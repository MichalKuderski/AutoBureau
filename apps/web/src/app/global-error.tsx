"use client";

import { useEffect } from "react";

/**
 * Last line of defence: a failure in the root layout itself.
 *
 * This component replaces the entire document, so it must render its own <html> and
 * <body> and cannot rely on providers, the theme, or the design system — all of which
 * may be exactly what failed. Styles are therefore inline and self-contained, and the
 * palette is neutral enough to be legible in either colour scheme.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error.digest ?? "", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          background: "#0d1210",
          color: "#e8ede9",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <main style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0 0 0.5rem" }}>
            AutoBureau couldn&rsquo;t start
          </h1>
          <p style={{ margin: "0 0 1.5rem", lineHeight: 1.6, color: "#9db0a7" }}>
            Something failed before the app could load. Your documents and deadlines are
            unaffected — reloading usually fixes it.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              cursor: "pointer",
              borderRadius: "0.375rem",
              border: "none",
              background: "#7fd1b9",
              color: "#0d1210",
              padding: "0.625rem 1.25rem",
              fontSize: "0.875rem",
              fontWeight: 500,
            }}
          >
            Reload
          </button>
          {error.digest ? (
            <p
              style={{
                marginTop: "1.5rem",
                fontFamily: "ui-monospace, monospace",
                fontSize: "0.75rem",
                color: "#6b7d75",
              }}
            >
              Reference: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
