import { useEffect, useState } from "react";

/**
 * A simple hook which calls any of our API
 *
 */
type UseApiQueryParams = {
  /** Any API endpoint */
  api: string;
  /** Query will not execute until this is true */
  enabled?: boolean;
};

export default function useApiQuery<TData>({
  api,
  enabled = true,
}: UseApiQueryParams) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [data, setData] = useState<TData | undefined>();

  useEffect(
    function handleQuery() {
      if (enabled) {
        setIsLoading(true);
        fetch(api)
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
    [api, enabled]
  );

  return {
    isLoading,
    error,
    data,
  };
}
