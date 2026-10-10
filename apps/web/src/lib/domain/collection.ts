"use client";
import type { ReadScheduler } from "./read-scheduler";
import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { Page } from "@autobureau/contracts";
import { apiFetch } from "@/lib/api-client";

/** A bounded first page with explicit continuation; never silently truncate a ledger. */
export function useCollection<T>(key: readonly unknown[], householdId: string, path: string, enabled = true, schedule?: ReadScheduler) {
  const query = useInfiniteQuery({
    queryKey: key, initialPageParam: null as string | null, enabled,
    queryFn: ({ pageParam, signal }) => {
      const read = () => apiFetch<Page<T>>(`${path}${path.includes("?") ? "&" : "?"}limit=100${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`, { householdId, signal });
      return schedule ? schedule(signal, read) : read();
    },
    getNextPageParam: (last) => last.next_cursor,
  });
  const data = useMemo(() => query.data?.pages.flatMap((page) => page.data) ?? [], [query.data]);
  return { ...query, data, isError: query.isError && query.data === undefined };
}
