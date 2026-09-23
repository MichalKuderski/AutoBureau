"use client";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export function CollectionMore({ query }: { query: {
  hasNextPage: boolean; isFetchingNextPage: boolean; isFetchNextPageError: boolean;
  fetchNextPage: () => Promise<unknown>;
} }) {
  if (!query.hasNextPage) return null;
  return <div className="mt-5 flex flex-col items-start gap-3">
    {query.isFetchNextPageError && <Alert tone="critical" title="Couldn’t load the next page">Your loaded records are still here. Try loading more again.</Alert>}
    <Button variant="secondary" loading={query.isFetchingNextPage} loadingLabel="Loading more records" onClick={() => void query.fetchNextPage()}>Load more</Button>
  </div>;
}
