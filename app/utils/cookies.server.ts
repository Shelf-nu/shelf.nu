import { createCookie } from "@remix-run/node"; // or cloudflare/deno

import type { Cookie } from "@remix-run/node";
import { cleanParamsForCookie } from "~/hooks/search-params";
import { getCurrentSearchParams } from "./http.server";

// find cookie by name from request headers
export function getCookie(name: string, headers: Headers) {
  const cookie = headers.get("cookie");
  if (!cookie) return null;

  const match = cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  if (match) return match[2];
}

/**
 * Parse a cookie from a request
 *
 */
export async function parseCookie<T>(
  cookie: Cookie,
  request: Request
): Promise<T | null> {
  const cookieHeader = request.headers.get("Cookie");
  const result = await cookie.parse(cookieHeader).catch(() => null);

  if (!result) {
    return null;
  }

  return result;
}

/**
 * Serialize a cookie for a response
 *
 */
export async function serializeCookie<T>(cookie: Cookie, value: T | null) {
  return cookie.serialize(value).catch(() => "");
}

/**
 * Serialize a cookie for deletion
 *
 */
export async function destroyCookie(cookie: Cookie) {
  return cookie.serialize("", { maxAge: 0 }).catch(() => "");
}

export function setCookie(cookieValue: string): [string, string] {
  return ["Set-Cookie", cookieValue];
}

/** USER PREFS COOKIE */

export const userPrefs = createCookie("user-prefs", {
  maxAge: 604_800, // one week
});

export async function updateCookieWithPerPage(
  request: Request,
  perPageParam: number
) {
  /* Get the cookie header */
  const cookieHeader = request.headers.get("Cookie");

  let cookie = (await userPrefs.parse(cookieHeader)) || {};
  /** If the cookie doesn't have perPage, adding perPage attribute and setting it to its default value 20*/
  if (!cookie.perPage) {
    cookie.perPage = 20;
  }
  /** If the perPageParam is different from the cookie, we update the cookie */
  if (cookie && perPageParam !== cookie.perPage && perPageParam !== 0) {
    cookie.perPage = perPageParam;
  }
  return cookie;
}

/**
 * Used to set the perPage cookie on the first load of the page if it doesn't exist
 *
 */
export async function initializePerPageCookieOnLayout(request: Request) {
  const cookieHeader = request.headers.get("Cookie");
  const cookie = (await userPrefs.parse(cookieHeader)) || {};
  if (!cookie.perPage) {
    cookie.perPage = 20;
  }
  return cookie;
}

/** ASSET FILTER COOKIE - SIMPLE MODE */
export const createAssetFilterCookie = (orgId: string) =>
  createCookie(`${orgId}_assetFilter`, {
    path: "/assets",
    sameSite: "lax",
    secrets: [process.env.SESSION_SECRET],
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });

export async function getFiltersFromRequest(
  request: Request,
  organizationId: string
) {
  let filters = getCurrentSearchParams(request).toString();
  const cookieHeader = request.headers.get("Cookie");

  const assetFilterCookie = createAssetFilterCookie(organizationId);
  if (filters) {
    // Clean filters before storing in cookie
    const cleanedFilters = cleanParamsForCookie(filters);
    // Only serialize to cookie if we have filters after cleaning
    const serializedCookie = cleanedFilters
      ? await assetFilterCookie.serialize(cleanedFilters)
      : null;

    // Return original filters for URL but cleaned cookie
    return { filters, serializedCookie };
  } else if (cookieHeader) {
    // Use existing cookie filter but clean it
    filters = (await assetFilterCookie.parse(cookieHeader)) || {};
    const cleanedFilters = cleanParamsForCookie(filters);

    // Only redirect if we have filters after cleaning
    return {
      filters: cleanedFilters,
      redirectNeeded: !!cleanedFilters,
    };
  }
  return { filters: "" };
}

/** ASSET FILTER COOKIE - ADVANCED MODE */
export const createAdvancedAssetFilterCookie = (orgId: string) =>
  createCookie(`${orgId}_advancedAssetFilter`, {
    path: "/assets",
    sameSite: "lax",
    secrets: [process.env.SESSION_SECRET],
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });

export async function getAdvancedFiltersFromRequest(
  request: Request,
  organizationId: string
) {
  let filters = getCurrentSearchParams(request).toString();
  const cookieHeader = request.headers.get("Cookie");

  const assetFilterCookie = createAdvancedAssetFilterCookie(organizationId);
  if (filters) {
    // Clean filters before storing in cookie
    const cleanedFilters = cleanParamsForCookie(filters);
    // Only serialize to cookie if we have filters after cleaning
    const serializedCookie = cleanedFilters
      ? await assetFilterCookie.serialize(cleanedFilters)
      : null;

    // Return original filters for URL but cleaned cookie
    return { filters, serializedCookie };
  } else if (cookieHeader) {
    // Use existing cookie filter but clean it
    filters = (await assetFilterCookie.parse(cookieHeader)) || {};
    const cleanedFilters = cleanParamsForCookie(filters);

    // Only redirect if we have filters after cleaning
    return {
      filters: cleanedFilters,
      redirectNeeded: !!cleanedFilters,
    };
  }
  return { filters };
}

/** HIDE PWA INSTALL PROMPT COOKIE */
export const installPwaPromptCookie = createCookie("hide-pwa-install-prompt", {
  maxAge: 60 * 60 * 24 * 14, // two weeks
});
