"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "@/lib/api-client";

/**
 * Server-state configuration.
 *
 * The defaults matter more than they look. Retrying a 4xx wastes a round trip and
 * delays the error the user needs to see, so retries are limited to genuinely
 * transient failures. `staleTime` is 30s because administrative data changes on the
 * order of days — refetching a passport expiry every focus event is pure noise.
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry(failureCount, error) {
          if (error instanceof ApiError) {
            // Client errors are the user's to resolve; only retry server/transport faults.
            if (error.status < 500 && error.status !== 429) return false;
          }
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      },
      mutations: {
        // Mutations carry idempotency keys, so a single retry is safe by construction.
        retry: (failureCount, error) =>
          error instanceof ApiError && error.status >= 500 && failureCount < 1,
      },
    },
  });
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // Created in state so a fast refresh or re-render never discards the cache.
  const [client] = useState(makeQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
