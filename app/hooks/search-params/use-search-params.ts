// eslint-disable-next-line no-restricted-imports
import { useSearchParams as remixUseSearchParams } from "@remix-run/react";
// eslint-disable-next-line import/no-cycle
import { useCookieDestroy } from "./utils";

/**
 * Get the types from the ReturnType of the original useSearchParams hook
 */
type SearchParamsType = ReturnType<typeof remixUseSearchParams>[0]; // URLSearchParams
type SetSearchParamsType = ReturnType<typeof remixUseSearchParams>[1];

export const useSearchParams = (): [
  SearchParamsType,
  (
    nextInit: Parameters<SetSearchParamsType>[0],
    navigateOptions?: Parameters<SetSearchParamsType>[1]
  ) => void,
] => {
  const [searchParams, setSearchParams] = remixUseSearchParams();
  const { destroyCookieValues } = useCookieDestroy();

  const customSetSearchParams: (
    nextInit: Parameters<SetSearchParamsType>[0],
    navigateOptions?: Parameters<SetSearchParamsType>[1]
  ) => void = (nextInit, navigateOptions) => {
    const prevParams = new URLSearchParams(searchParams.toString());

    const checkAndDestroyCookies = (newParams: URLSearchParams) => {
      const removedKeys: string[] = [];
      prevParams.forEach((_value, key) => {
        if (!newParams.has(key)) {
          removedKeys.push(key);
        }
      });
      if (removedKeys.length > 0) {
        destroyCookieValues(removedKeys);
      }
    };

    if (typeof nextInit === "function") {
      setSearchParams((prev) => {
        let newParams = nextInit(prev);
        // Ensure newParams is an instance of URLSearchParams
        if (!(newParams instanceof URLSearchParams)) {
          newParams = new URLSearchParams(newParams as any); // Safely cast to any to handle URLSearchParamsInit types
        }
        checkAndDestroyCookies(newParams);
        return newParams;
      }, navigateOptions);
    } else {
      let newParams = nextInit;
      // Ensure newParams is an instance of URLSearchParams
      if (!(newParams instanceof URLSearchParams)) {
        newParams = new URLSearchParams(newParams as any); // Safely cast to any to handle URLSearchParamsInit types
      }
      checkAndDestroyCookies(newParams);
      setSearchParams(newParams, navigateOptions);
    }
  };

  return [searchParams, customSetSearchParams];
};
