import { useEffect, useState } from "react";
import { useFetcher, type FetcherWithComponents } from "@remix-run/react";

export type FetcherWithComponentsReset<T> = FetcherWithComponents<T> & {
  reset: () => void;
};

export default function useFetcherWithReset<T>() {
  const fetcher = useFetcher<T>();
  const [data, setData] = useState(fetcher.data);

  useEffect(() => {
    if (fetcher.state === "idle") {
      setData(fetcher.data);
    }
  }, [fetcher.data, fetcher.state]);

  return {
    state: fetcher.state,
    formMethod: fetcher.formMethod,
    formData: fetcher.formData,
    Form: fetcher.Form,
    submit: fetcher.submit,
    load: fetcher.load,
    data: data as T,
    reset: () => setData(undefined),
  };
}
