import type { FetcherWithComponents } from "@remix-run/react";

export const resetFetcher = (fetcher: FetcherWithComponents<any>) => {
  fetcher.submit({}, { action: "/api/reset-fetcher", method: "post" });
};
