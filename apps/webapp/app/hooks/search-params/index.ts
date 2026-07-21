import { useCallback, useMemo, useRef } from "react";
import Cookies from "js-cookie";
import {
  useLoaderData,
  useLocation,
  // eslint-disable-next-line no-restricted-imports
  useSearchParams as remixUseSearchParams,
} from "react-router";

import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";

import { useAssetIndexViewState } from "../use-asset-index-view-state";
import { useCurrentOrganization } from "../use-current-organization";

export const SEARCH_PARAMS_KEYS_TO_EXCLUDE = [
  "page",
  "scanId",
  "redirectTo",
  "getAll",
] as const;
type ExcludedKeys = (typeof SEARCH_PARAMS_KEYS_TO_EXCLUDE)[number];

/**
 * Helper function to check if a key should be excluded from cookie storage
 * @param key - The search parameter key to check
 * @returns boolean indicating if the key should be excluded from cookie storage
 */
export function shouldExcludeFromCookie(key: string): key is ExcludedKeys {
  return SEARCH_PARAMS_KEYS_TO_EXCLUDE.includes(key as ExcludedKeys);
}

/**
 * Clean URLSearchParams from any excluded keys that shouldn't be stored in cookies
 * @param params - URLSearchParams or string to clean
 * @returns Cleaned params string
 */
export function cleanParamsForCookie(params: URLSearchParams | string): string {
  const searchParams =
    params instanceof URLSearchParams ? params : new URLSearchParams(params);
  SEARCH_PARAMS_KEYS_TO_EXCLUDE.forEach((key) => {
    searchParams.delete(key);
  });
  return searchParams.toString();
}

// Allowed pathnames for cookie naming
export const ALLOWED_FILTER_PATHNAMES = {
  assets: "assetFilter_v2",
  bookings: "bookingFilter_v2",
  kits: "kitFilter_v2",
} as const;

export type AllowedPathname = keyof typeof ALLOWED_FILTER_PATHNAMES;
type CookieNameSuffix = (typeof ALLOWED_FILTER_PATHNAMES)[AllowedPathname];

/**
 * Helper function to extract and validate pathname for cookie naming
 * @param pathname - The current pathname (e.g., "/assets", "/bookings")
 * @returns The validated cookie name suffix, or "assetFilter_v2" as fallback
 */
export function getValidatedPathname(pathname: string): CookieNameSuffix {
  // Strip leading slash and get the first segment
  const cleanPath = pathname
    .replace(/^\//, "")
    .split("/")[0] as AllowedPathname;

  // Check if it's an allowed pathname and return the corresponding value
  if (cleanPath in ALLOWED_FILTER_PATHNAMES) {
    return ALLOWED_FILTER_PATHNAMES[cleanPath];
  }

  // Fallback to "assetFilter_v2" if pathname is not in allowed list
  return "assetFilter_v2";
}

/**
 * Helper function to get the appropriate cookie name based on organization, mode, and pathname
 * @param organizationId - The organization ID
 * @param modeIsAdvanced - Whether advanced mode is enabled
 * @param pathname - The current pathname (e.g., "/assets", "/bookings")
 * @returns The appropriate cookie name
 */
export function getCookieName(
  organizationId: string,
  modeIsAdvanced: boolean,
  pathname: string
): string {
  if (modeIsAdvanced) {
    return `${organizationId}_advancedAssetFilter_v2`;
  }

  const validatedPathname = getValidatedPathname(pathname);
  return `${organizationId}_${validatedPathname}`;
}

/**
 * Custom hook to check if the current page supports cookie filters
 * @returns boolean indicating if the current page is in ALLOWED_FILTER_PATHNAMES
 */
export function useIsPageWithCookieFilters(): boolean {
  const location = useLocation();

  // Strip leading slash and get the first segment
  const cleanPath = location.pathname.replace(/^\//, "").split("/")[0];

  // Check if it's one of the allowed filter pathnames
  return cleanPath in ALLOWED_FILTER_PATHNAMES;
}
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
  const isPageWithCookieFilters = useIsPageWithCookieFilters();
  const currentOrganization = useCurrentOrganization();

  /**
   * Cookie-aware setter used on pages that persist filters in a cookie (assets,
   * bookings, kits). Memoized with `useCallback` so consumers that put the returned
   * setter in an effect/callback dependency array (e.g. `set-or-edit-reminder-dialog.tsx`)
   * get a stable identity across renders instead of a new function every render — an
   * unstable identity there re-fires those effects on every render and can sustain a
   * revalidation loop.
   *
   * NOTE: this hook is called unconditionally on every render (rules of hooks). The
   * conditional choice of *which* setter to return happens after, at the `return`
   * statement below.
   */
  const customSetSearchParams = useCallback<
    (
      nextInit: Parameters<SetSearchParamsType>[0],
      navigateOptions?: Parameters<SetSearchParamsType>[1]
    ) => void
  >(
    (nextInit, navigateOptions) => {
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
            newParams = new URLSearchParams(
              newParams as ConstructorParameters<typeof URLSearchParams>[0]
            );
          }
          checkAndDestroyCookies(newParams);
          return newParams;
        }, navigateOptions);
      } else {
        let newParams = nextInit;
        // Ensure newParams is an instance of URLSearchParams
        if (!(newParams instanceof URLSearchParams)) {
          newParams = new URLSearchParams(
            newParams as ConstructorParameters<typeof URLSearchParams>[0]
          );
        }
        checkAndDestroyCookies(newParams);
        setSearchParams(newParams, navigateOptions);
      }
    },
    [searchParams, setSearchParams, destroyCookieValues]
  );

  /** In those cases, we return the default searchParams and setSearchParams as we don't need to handle cookies */
  return isPageWithCookieFilters && currentOrganization
    ? [searchParams, customSetSearchParams]
    : [searchParams, setSearchParams];
};

type SetSearchParams = (
  setter: (prev: URLSearchParams) => URLSearchParams
) => void;

/**
 * Custom hook to gather and return metadata related to the asset index page.
 *
 * @returns - An object containing the filters, a boolean indicating if it's the asset index page,
 * a URLSearchParams object constructed from the filters, and the organization ID.
 */
export function useAssetIndexCookieSearchParams() {
  const assetIndexData = useLoaderData<AssetIndexLoaderData>();
  const isPageWithCookieFilters = useIsPageWithCookieFilters();

  if (!assetIndexData || !isPageWithCookieFilters) {
    return new URLSearchParams();
  }

  const { filters } = assetIndexData;
  // Ensure we're passing a string to URLSearchParams constructor
  const cookieSearchParams = new URLSearchParams(
    isPageWithCookieFilters && filters && filters !== ""
      ? filters.toString()
      : ""
  );

  return cookieSearchParams;
}

/**
 * Returns a boolean indicating whether any of the specified keys have values
 * in the provided cookie search parameters.
 *
 * @param {string[]} keys - Array of keys (strings) to check in the cookie search parameters.
 * @param {URLSearchParams} cookieSearchParams - URLSearchParams object representing the parameters extracted from cookies.
 * @returns {boolean} - True if any of the keys exist in the cookie search parameters, otherwise false.
 */
export function checkValueInCookie(
  keys: string[],
  cookieSearchParams: URLSearchParams
): boolean {
  return keys.map((key) => cookieSearchParams.has(key)).some(Boolean);
}

/**
 * Custom hook to check if any of the specified keys have values in the URL search parameters or in cookies.
 *
 * @param {string[]} keys - Array of keys (strings) to check in the URL search parameters and cookies.
 * @returns {boolean} - True if any of the keys have values in the search parameters or in the cookies, otherwise false.
 */
export function useSearchParamHasValue(...keys: string[]): boolean {
  const [searchParams] = useSearchParams();
  const cookieSearchParams = useAssetIndexCookieSearchParams();
  const isPageWithCookieFilters = useIsPageWithCookieFilters();
  const hasValue = useMemo(
    () => keys.map((key) => searchParams.has(key)).some(Boolean),
    [keys, searchParams]
  );

  const hasValueInCookie =
    isPageWithCookieFilters && checkValueInCookie(keys, cookieSearchParams);

  return hasValue || hasValueInCookie;
}

/**
 * Function to delete specific keys from the URL search parameters.
 *
 * @param {string[]} keys - Array of keys (strings) to be deleted from the URL search parameters.
 * @param {SetSearchParams} setSearchParams - Function to update the URL search parameters.
 */
export function deleteKeysInSearchParams(
  keys: string[],
  setSearchParams: SetSearchParams
) {
  // Delete all keys in a single setSearchParams call to avoid multiple cookie updates
  setSearchParams((prev) => {
    keys.forEach((key) => {
      prev.delete(key);
    });
    return prev;
  });
}

/**
 * Function to delete specific keys from the cookie search parameters and update the cookie.
 *
 * @param {string} cookieName - The name of the cookie to update.
 * @param {string[]} keys - Array of keys (strings) to be deleted from the cookie search parameters.
 * @param {URLSearchParams} cookieSearchParams - URLSearchParams object representing the parameters extracted from cookies.
 * @param {string} [cookiePath] - Optional cookie path. If not provided, will be determined from pathname.
 */
export function destroyCookieValues(
  cookieName: string,
  keys: string[],
  cookieSearchParams: URLSearchParams,
  cookiePath?: string
) {
  // Always remove excluded keys and the specifically requested keys
  keys.forEach((key) => {
    cookieSearchParams.delete(key);
  });

  // Ensure all excluded keys are removed
  SEARCH_PARAMS_KEYS_TO_EXCLUDE.forEach((key) => {
    cookieSearchParams.delete(key);
  });

  const finalCookieValue = cookieSearchParams.toString();

  // Always use root path to ensure cookies are sent with RR7 single fetch .data requests
  // Client-side must match server-side cookie path
  const path = cookiePath || "/";

  // Cookie options must match between set and remove operations
  const cookieOptions = {
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };

  // If no filters remain, DELETE the cookie entirely
  // Otherwise, update it with the new value
  if (!finalCookieValue) {
    Cookies.remove(cookieName, { path, ...cookieOptions });

    // Also remove any legacy cookies at old paths to ensure complete cleanup
    Cookies.remove(cookieName, { path: "/assets", ...cookieOptions });
    Cookies.remove(cookieName, { path: "/bookings", ...cookieOptions });
    Cookies.remove(cookieName, { path: "/kits", ...cookieOptions });
  } else {
    Cookies.set(cookieName, finalCookieValue, {
      path,
      ...cookieOptions,
      expires: 365, // 1 year
    });
  }
}

/**
 * Custom hook to create a handler for clearing specific keys from URL search parameters and cookies.
 *
 * @param {string[]} keys - Array of keys (strings) to be cleared from the URL search parameters and cookies.
 * @returns {Function} - A function that, when called, clears the specified keys from the URL search parameters and, if on the asset index page, also from the cookies.
 */
export function useClearValueFromParams(...keys: string[]): Function {
  const [, setSearchParams] = useSearchParams();
  const cookieSearchParams = useAssetIndexCookieSearchParams();
  const currentOrganization = useCurrentOrganization();
  const { isAssetIndexPage, modeIsAdvanced } = useAssetIndexViewState();
  const isPageWithCookieFilters = useIsPageWithCookieFilters();
  const location = useLocation();

  function clearValuesFromParams() {
    if (isPageWithCookieFilters && currentOrganization) {
      // For asset pages, use the actual modeIsAdvanced value
      // For other pages (like bookings), default to false (non-advanced mode)
      const effectiveModeIsAdvanced = isAssetIndexPage
        ? modeIsAdvanced || false
        : false;

      const cookieName = getCookieName(
        currentOrganization.id,
        effectiveModeIsAdvanced,
        location.pathname
      );

      // Always use root path to match server-side cookie path
      // This ensures cookies work with RR7 single fetch .data requests
      destroyCookieValues(cookieName, keys, cookieSearchParams, "/");
      deleteKeysInSearchParams(keys, setSearchParams);
      return;
    }
    deleteKeysInSearchParams(keys, setSearchParams);
  }

  return clearValuesFromParams;
}

/**
 * Custom hook to provide a handler for destroying specific keys from cookies if on the asset index page.
 *
 * @returns {Object} - An object containing the `destroyCookieValues` function that clears specific keys from cookies.
 */
export function useCookieDestroy() {
  const cookieSearchParams = useAssetIndexCookieSearchParams();
  const currentOrganization = useCurrentOrganization();
  const { isAssetIndexPage, modeIsAdvanced } = useAssetIndexViewState();
  const isPageWithCookieFilters = useIsPageWithCookieFilters();
  const location = useLocation();

  /**
   * Latch holding this render's closed-over values. `_destroyCookieValues` (below)
   * reads from this ref at *call time* instead of closing over these values
   * directly, so its identity can stay stable across renders (empty-deps
   * `useCallback` below) while still always acting on the freshest state when
   * it's actually invoked — the standard "latest ref" pattern for giving an
   * event-handler-like callback a stable identity without going stale.
   *
   * This keeps `destroyCookieValues`'s reference stable for consumers that put
   * it in an effect/callback dependency array (e.g. `useSearchParams`'s
   * `customSetSearchParams`, which closes over it) — see
   * `.claude/rules/react-render-stability.md`.
   *
   * IMPORTANT: `cookieSearchParams` itself must stay a *fresh* URLSearchParams
   * instance every render (not memoized) — `destroyCookieValues()` mutates it
   * via `.delete()`, and caching it across renders would leak those mutations
   * into a later render that reuses the same instance before its inputs
   * change. The ref only stabilizes the *function identity*, never the
   * search-params object itself.
   */
  const latestRef = useRef({
    cookieSearchParams,
    currentOrganization,
    isAssetIndexPage,
    modeIsAdvanced,
    isPageWithCookieFilters,
    pathname: location.pathname,
  });
  latestRef.current = {
    cookieSearchParams,
    currentOrganization,
    isAssetIndexPage,
    modeIsAdvanced,
    isPageWithCookieFilters,
    pathname: location.pathname,
  };

  /**
   * Function to destroy specific keys from cookies if on the asset index page.
   * Referentially stable across renders (see `latestRef` above), so it is
   * safe for consumers to place in a `useEffect`/`useCallback` dependency array.
   *
   * @param {string[]} keys - Array of keys (strings) to be removed from the cookies.
   */
  const _destroyCookieValues = useCallback((keys: string[]) => {
    const {
      isPageWithCookieFilters,
      currentOrganization,
      isAssetIndexPage,
      modeIsAdvanced,
      pathname,
      cookieSearchParams,
    } = latestRef.current;

    // Check if the current page supports cookie filters
    if (
      isPageWithCookieFilters &&
      currentOrganization &&
      currentOrganization?.id
    ) {
      // For asset pages, use the actual modeIsAdvanced value
      // For other pages (like bookings), default to false (non-advanced mode)
      const effectiveModeIsAdvanced = isAssetIndexPage
        ? modeIsAdvanced || false
        : false;

      const cookieName = getCookieName(
        currentOrganization.id,
        effectiveModeIsAdvanced,
        pathname
      );

      // Always use root path to match server-side cookie path
      // This ensures cookies work with RR7 single fetch .data requests
      const cookiePath = "/";

      // Call the destroyCookieValues utility function to delete keys from cookies and update the cookie
      destroyCookieValues(cookieName, keys, cookieSearchParams, cookiePath);
    }
  }, []);

  return { destroyCookieValues: _destroyCookieValues };
}
