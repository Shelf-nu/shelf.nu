import { useSearchParams as remixUseSearchParams } from "@remix-run/react";
import { useCookieDestroy } from "./utils";

// Type definition for the setSearchParams function
type SetSearchParams = (
  nextInit: URLSearchParams | ((prev: URLSearchParams) => URLSearchParams),
  navigateOptions?: { replace?: boolean; state?: any }
) => void;

export const useSearchParams = (): [URLSearchParams, SetSearchParams] => {
  const [searchParams, setSearchParams] = remixUseSearchParams();
  const { destroyCookieValues } = useCookieDestroy();

  const customSetSearchParams: SetSearchParams = (
    nextInit,
    navigateOptions
  ) => {
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
        const newParams = nextInit(prev);
        checkAndDestroyCookies(newParams);
        return newParams;
      }, navigateOptions);
    } else {
      const newParams = nextInit;
      checkAndDestroyCookies(newParams);
      setSearchParams(newParams, navigateOptions);
    }
  };

  return [searchParams, customSetSearchParams];
};
