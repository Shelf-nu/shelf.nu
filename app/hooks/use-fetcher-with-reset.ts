import { useEffect, useState } from "react";
import { useFetcher, type FetcherWithComponents } from "@remix-run/react";

export type FetcherWithComponentsReset<T> = FetcherWithComponents<T> & {
  reset: () => void;
};

export default function useFetcherWithReset<
  T,
>(): FetcherWithComponentsReset<T> {
  const fetcher = useFetcher();
  const [data, setData] = useState(fetcher.data);

  useEffect(() => {
    if (fetcher.state === "idle") {
      setData(fetcher.data);
    }
  }, [fetcher.data, fetcher.state]);

  return {
    ...fetcher,
    data: data as T,
    reset: () => setData(undefined),
  };
}
