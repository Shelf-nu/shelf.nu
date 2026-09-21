import { useEffect, useMemo, useRef, useState } from "react";

/**
 * A simple hook which calls any of our API
 *
 */
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
   */
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  useEffect(() => {
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
