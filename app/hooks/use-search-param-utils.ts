import { useMemo } from "react";
import { useSearchParams } from "@remix-run/react";

/**
 * Returns a Boolean indicating if any values exists for any key passed
 */
export function useSearchParamHasValue(...keys: string[]) {
  const [searchParams] = useSearchParams();

  const hasValue = useMemo(
    () => keys.map((key) => searchParams.has(key)).some(Boolean),
    [keys, searchParams]
  );

  return hasValue;
}

/**
 * Returns a handler which can use used to clear all the values
 * for specific keys passed as params
 */
export function useClearValueFromParams(...keys: string[]) {
  const [, setSearchParams] = useSearchParams();

  function clearValuesFromParams() {
    keys.forEach((key) => {
      setSearchParams((prev) => {
        prev.delete(key);
        return prev;
      });
    });
  }

  return clearValuesFromParams;
}
