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
      if (enabled) {
        setIsLoading(true);
        fetch(apiUrl)
          .then((response) => response.json())
          .then((data: TData) => {
            setData(data);
            onSuccess?.(data);
          })
          .catch((error: Error) => {
            const errorMessage = error?.message ?? "Something went wrong.";
            setError(errorMessage);
            onError?.(errorMessage);
          })
          .finally(() => {
            setIsLoading(false);
          });
      }
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
