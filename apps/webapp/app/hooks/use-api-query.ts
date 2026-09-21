/**
 * Client-side reads of Shelf's own `api+` routes.
 *
 * One hook for the shape that recurs across the app: fetch a JSON endpoint when
 * some condition holds, expose loading/error/data, and refetch on demand. It is
 * a read path only — mutations go through a router fetcher, which brings
 * revalidation with it.
 *
 * Two properties callers depend on and should not be traded away:
 *
 * - **The current request wins.** Changing the url (or refetching) cancels what
 *   is in flight, so a slower earlier answer can never overwrite a newer one.
 * - **The newest callback is called.** `onSuccess`/`onError` are read from refs
 *   rather than being keyed on, because callers pass inline closures.
 *
 * The declared `TData` is an unchecked cast of `response.json()` — see
 * `.claude/rules/api-payload-contracts-need-a-test-on-both-sides.md` before
 * trusting it.
 *
 * @see {@link file://./use-api-query.test.ts}
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/**
 * `useLayoutEffect` on the client, `useEffect` on the server.
 *
 * The callback refs below must be current before any promise continuation can
 * read them, which rules out a passive effect; but layout effects do not run
 * during SSR and React warns when a server-rendered component asks for one, and
 * this hook renders on the server across every route that uses it.
 */
const useIsomorphicLayoutEffect =
  typeof document !== "undefined" ? useLayoutEffect : useEffect;

type UseApiQueryParams<TData> = {
  /** Any API endpoint */
  api: string;

  /** Optional search parameters to append to the API endpoint */
  searchParams?: URLSearchParams;

  /** Query will not execute until this is true */
  enabled?: boolean;

  /** Callback function called when query succeeds */
  onSuccess?: (data: TData) => void;

  /** Callback function called when query fails */
  onError?: (error: string) => void;
};

/**
 * Reads a Shelf API endpoint and tracks the request's state.
 *
 * @param args.api - The endpoint path, e.g. `/api/assets`.
 * @param args.searchParams - Appended to the path; may be rebuilt each render.
 * @param args.enabled - Nothing is requested until this is true. A query that
 *   turns disabled mid-request cancels it and reports itself as not loading.
 * @param args.onSuccess - Called with the parsed payload of the request that
 *   was still current when it answered.
 * @param args.onError - Called with a message when the request fails. A
 *   cancelled request is not a failure and calls neither callback.
 * @returns `{ isLoading, error, data, refetch }`.
 */
export default function useApiQuery<TData>({
  api,
  searchParams,
  enabled = true,
  onSuccess,
  onError,
}: UseApiQueryParams<TData>) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [data, setData] = useState<TData | undefined>();
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  const apiUrl = useMemo(
    () => (searchParams ? `${api}?${searchParams.toString()}` : api),
    [api, searchParams]
  );

  /**
   * Callbacks are held in refs, deliberately, and are NOT effect dependencies.
   *
   * Call sites pass inline arrows, so their identity changes on every render.
   * As dependencies they would re-run the query — and now that the query
   * cancels on re-run, a request would abort itself on the render its own
   * `setIsLoading` triggers and never resolve. Reading them from a ref keeps
   * the query keyed on what actually identifies it (url, enabled, refetch)
   * while still calling the newest callback the caller rendered.
   *
   * The refs are filled in a layout effect, not a passive one: a response that
   * lands between a commit and the next passive flush would otherwise be
   * handed the callback from the render before it.
   */
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  useIsomorphicLayoutEffect(() => {
    onSuccessRef.current = onSuccess;
    onErrorRef.current = onError;
  });

  const refetch = () => {
    setRefetchTrigger((prev) => prev + 1);
  };

  useEffect(
    function handleQuery() {
      if (!enabled) {
        // A disabled query has nothing in flight to report on. Saying so here
        // matters because cancelling skips the `finally` below: a caller that
        // disables the query mid-request — every dialog that gates on `open`
        // does — would otherwise be left showing a spinner for a request that
        // will never answer.
        setIsLoading(false);
        return;
      }

      const controller = new AbortController();

      setIsLoading(true);
      fetch(apiUrl, { signal: controller.signal })
        .then((response) => response.json())
        .then((data: TData) => {
          // A superseded request must not land: its answer describes a url the
          // caller has already moved on from, and whichever response happens
          // to be slower would otherwise win.
          if (controller.signal.aborted) return;
          setData(data);
          onSuccessRef.current?.(data);
        })
        .catch((error: Error) => {
          if (controller.signal.aborted) return;
          const errorMessage = error?.message ?? "Something went wrong.";
          setError(errorMessage);
          onErrorRef.current?.(errorMessage);
        })
        .finally(() => {
          // The replacement request set its own loading state; clearing it here
          // would report "done" while that one is still in flight.
          if (controller.signal.aborted) return;
          setIsLoading(false);
        });

      return () => controller.abort();
    },
    [apiUrl, enabled, refetchTrigger]
  );

  return {
    isLoading,
    error,
    data,
    refetch,
  };
}
