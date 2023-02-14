import type { SerializeFrom } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import type { FetcherWithComponents } from "@remix-run/react";

type TypedFetcherWithComponents<T> = Omit<FetcherWithComponents<T>, "data"> & {
  data: SerializeFrom<T> | null;
};
export function useTypedFetcher<T>(): TypedFetcherWithComponents<T> {
  return useFetcher<T>() as TypedFetcherWithComponents<T>;
}
