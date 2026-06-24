import { useEffect, useMemo, useState } from "react";

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

  const refetch = () => {
    setRefetchTrigger((prev) => prev + 1);
  };

  useEffect(
    function handleQuery() {
      if (!enabled) return;

      // Guard against out-of-order responses: the consumer may stay mounted
      // while `apiUrl` changes (e.g. selection/filter changes behind a dialog),
      // so a slower earlier request could otherwise resolve last and overwrite
      // the newer one. The cleanup marks this run stale and aborts its fetch, so
      // only the latest request is allowed to set state.
      let ignore = false;
      const controller = new AbortController();

      setIsLoading(true);
      fetch(apiUrl, { signal: controller.signal })
        .then((response) => response.json())
        .then((data: TData) => {
          if (ignore) return;
          setData(data);
          onSuccess?.(data);
        })
        .catch((error: Error) => {
          // A superseded/aborted request is expected — never surface it.
          if (ignore || error?.name === "AbortError") return;
          const errorMessage = error?.message ?? "Something went wrong.";
          setError(errorMessage);
          onError?.(errorMessage);
        })
        .finally(() => {
          if (ignore) return;
          setIsLoading(false);
        });

      return () => {
        ignore = true;
        controller.abort();
      };
    },
    [apiUrl, enabled, refetchTrigger, onSuccess, onError]
  );

  return {
    isLoading,
    error,
    data,
    refetch,
  };
}
