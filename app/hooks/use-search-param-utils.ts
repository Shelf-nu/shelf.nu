import { useMemo } from "react";
import { useLoaderData, useLocation, useSearchParams } from "@remix-run/react";
import Cookies from "js-cookie";
import type { loader } from "~/routes/_layout+/assets._index";

type SetSearchParams = (
  setter: (prev: URLSearchParams) => URLSearchParams
) => void;

export function useAssetIndexMeta() {
  const location = useLocation();
  const { filters, organizationId } = useLoaderData<typeof loader>();
  const isAssetIndexPage = location.pathname === "/assets";
  const cookieSearchParams = new URLSearchParams(filters);

  return { filters, isAssetIndexPage, cookieSearchParams, organizationId };
}

export function checkValueInCookie(
  keys: string[],
  cookieSearchParams: URLSearchParams
): boolean {
  return keys.map((key) => cookieSearchParams.has(key)).some(Boolean);
}

/**
 * Returns a Boolean indicating if any values exists for any key passed
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
 * Returns a handler which can use used to clear all the values
 * for specific keys passed as params
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

export function destoryCookieValues(
  organizationId: string,
  keys: string[],
  cookieSearchParams: URLSearchParams
) {
  keys.forEach((key) => {
    cookieSearchParams.delete(key);
  });
  Cookies.set(`${organizationId}_assetFilter`, cookieSearchParams.toString(), {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: 365, // 1 year
  });
}

export function useClearValueFromParams(...keys: string[]) {
  const [, setSearchParams] = useSearchParams();
  const { isAssetIndexPage, organizationId, cookieSearchParams } =
    useAssetIndexMeta();

  function clearValuesFromParams() {
    if (isAssetIndexPage) {
      destoryCookieValues(organizationId, keys, cookieSearchParams);
      deleteKeysInSearchParams(keys, setSearchParams);
      return;
    }
    deleteKeysInSearchParams(keys, setSearchParams);
  }

  return clearValuesFromParams;
}

export function useCookieDestory() {
  const { isAssetIndexPage, cookieSearchParams, organizationId } =
    useAssetIndexMeta();

  function _destoryCookieValues(keys: string[]) {
    if (isAssetIndexPage) {
      destoryCookieValues(organizationId, keys, cookieSearchParams);
    }
  }
  return { destoryCookieValues: _destoryCookieValues };
}
