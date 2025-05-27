import { useEffect, useMemo, useState } from "react";

/**
 * A simple hook which calls any of our API
 *
 */
type UseApiQueryParams = {
  /** Any API endpoint */
  api: string;

  /** Optional search parameters to append to the API endpoint */
  searchParams?: URLSearchParams;

  /** Query will not execute until this is true */
  enabled?: boolean;
};

export default function useApiQuery<TData>({
  api,
  searchParams,
  enabled = true,
}: UseApiQueryParams) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [data, setData] = useState<TData | undefined>();

  const apiUrl = useMemo(
    () => (searchParams ? `${api}?${searchParams.toString()}` : api),
    [api, searchParams]
  );

  useEffect(
    function handleQuery() {
      if (enabled) {
        setIsLoading(true);
        fetch(apiUrl)
          .then((response) => response.json())
          .then((data: TData) => {
            setData(data);
          })
          .catch((error: Error) => {
            setError(error?.message ?? "Something went wrong.");
          })
          .finally(() => {
            setIsLoading(false);
          });
      }
    },
    [apiUrl, enabled]
  );

  return {
    isLoading,
    error,
    data,
  };
}
