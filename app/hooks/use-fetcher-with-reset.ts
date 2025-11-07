import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "@remix-run/react";

export default function useFetcherWithReset<TData = unknown>() {
  const fetcher = useFetcher<TData>();
  type Fetcher = typeof fetcher;
  const [data, setData] = useState<Fetcher["data"]>(fetcher.data);

  useEffect(() => {
    if (fetcher.state === "idle") {
      setData(fetcher.data);
    }
  }, [fetcher.data, fetcher.state]);

  useEffect(() => () => setData(undefined), []);

  return useMemo<Fetcher & { reset: () => void }>(
    () => ({
      ...fetcher,
      data,
      reset: () => setData(undefined),
    }),
    [data, fetcher]
  );
}
