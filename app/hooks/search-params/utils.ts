import { useMemo } from "react";
import { useLoaderData, useLocation, useSearchParams } from "@remix-run/react";
import Cookies from "js-cookie";
import type { loader } from "~/routes/_layout+/assets._index";

type SetSearchParams = (
  setter: (prev: URLSearchParams) => URLSearchParams
) => void;

/**
 * Custom hook to gather and return metadata related to the asset index page.
 *
 * @returns {Object} - An object containing the filters, a boolean indicating if it's the asset index page,
 * a URLSearchParams object constructed from the filters, and the organization ID.
 */
export function useAssetIndexMeta() {
  const location = useLocation();
  const { filters, organizationId } = useLoaderData<typeof loader>();
  const isAssetIndexPage = location.pathname === "/assets";
  const cookieSearchParams = new URLSearchParams(filters);

  return { filters, isAssetIndexPage, cookieSearchParams, organizationId };
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
export function useSearchParamHasValue(...keys: string[]) {
  const [searchParams] = useSearchParams();
  const { isAssetIndexPage, cookieSearchParams } = useAssetIndexMeta();
  const hasValue = useMemo(
    () => keys.map((key) => searchParams.has(key)).some(Boolean),
    [keys, searchParams]
  );

  const hasValueInCookie =
    isAssetIndexPage && checkValueInCookie(keys, cookieSearchParams);

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
  keys.forEach((key) => {
    setSearchParams((prev) => {
      prev.delete(key);
      return prev;
    });
  });
}

/**
 * Function to delete specific keys from the cookie search parameters and update the cookie.
 *
 * @param {string} organizationId - The organization ID used to name the cookie.
 * @param {string[]} keys - Array of keys (strings) to be deleted from the cookie search parameters.
 * @param {URLSearchParams} cookieSearchParams - URLSearchParams object representing the parameters extracted from cookies.
 */
export function destroyCookieValues(
  organizationId: string,
  keys: string[],
  cookieSearchParams: URLSearchParams
) {
  keys.forEach((key) => {
    cookieSearchParams.delete(key);
  });
  Cookies.set(`${organizationId}_assetFilter`, cookieSearchParams.toString(), {
    path: "/assets",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: 365, // 1 year
  });
}

/**
 * Custom hook to create a handler for clearing specific keys from URL search parameters and cookies.
 *
 * @param {string[]} keys - Array of keys (strings) to be cleared from the URL search parameters and cookies.
 * @returns {Function} - A function that, when called, clears the specified keys from the URL search parameters and, if on the asset index page, also from the cookies.
 */
export function useClearValueFromParams(...keys: string[]) {
  const [, setSearchParams] = useSearchParams();
  const { isAssetIndexPage, organizationId, cookieSearchParams } =
    useAssetIndexMeta();

  function clearValuesFromParams() {
    if (isAssetIndexPage) {
      destroyCookieValues(organizationId, keys, cookieSearchParams);
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
  const { isAssetIndexPage, cookieSearchParams, organizationId } =
    useAssetIndexMeta();

  /**
   * Function to destroy specific keys from cookies if on the asset index page.
   *
   * @param {string[]} keys - Array of keys (strings) to be removed from the cookies.
   */
  function _destroyCookieValues(keys: string[]) {
    // Check if the current page is the asset index page
    if (isAssetIndexPage) {
      // Call the destroyCookieValues utility function to delete keys from cookies and update the cookie
      destroyCookieValues(organizationId, keys, cookieSearchParams);
    }
  }

  return { destroyCookieValues: _destroyCookieValues };
}
