import type { AssetIndexSettings } from "@prisma/client";
import { createCookie } from "@remix-run/node"; // or cloudflare/deno

import type { Cookie } from "@remix-run/node";
import { parse } from "cookie";
import { cleanParamsForCookie } from "~/hooks/search-params";
import i18n from "~/i18n/i18n";
import { advancedFilterFormatSchema } from "~/modules/asset/utils.server";
import type { Column } from "~/modules/asset-index-settings/helpers";
import { getCurrentSearchParams } from "./http.server";
// find cookie by name from request headers
export function getCookie(name: string, headers: Headers) {
  const cookie = headers.get("cookie");
  if (!cookie) return null;

  const match = cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  if (match) return match[2];
}
/**
 *  Get the language from the cookie , return the fallback language if not found
 *  This function is used to determine the language for i18n based on the cookie
 */
export function getLng(request: { headers: { get: (arg0: string) => any } }) {
  const cookies = request.headers.get("cookie");
  if (!cookies) return i18n.fallbackLng;

  const parsedCookies = parse(cookies);
  return parsedCookies.i18next || i18n.fallbackLng;
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

/**
 * Gets and validates advanced filters from request parameters
 * Ensures URL parameters match the expected advanced filter format
 * @param request - The incoming request
 * @param organizationId - The organization ID for the request
 * @param settings - The asset index settings containing column configuration
 * @returns Object containing filters, serialized cookie, and redirect status
 */
export async function getAdvancedFiltersFromRequest(
  request: Request,
  organizationId: string,
  settings: AssetIndexSettings
): Promise<{
  filters: string | undefined;
  serializedCookie: string | undefined;
  redirectNeeded: boolean;
}> {
  let filters = getCurrentSearchParams(request).toString();
  const cookieHeader = request.headers.get("Cookie");
  const advancedAssetFilterCookie =
    createAdvancedAssetFilterCookie(organizationId);

  if (filters) {
    const validatedParams = new URLSearchParams();
    const columnNames = (settings.columns as Column[]).map((col) => col.name);

    new URLSearchParams(filters).forEach((value, key) => {
      if (!columnNames.includes(key as any)) {
        validatedParams.append(key, value);
        return;
      }

      if (advancedFilterFormatSchema.safeParse(value).success) {
        validatedParams.append(key, value);
      }
    });

    const validatedParamsString = validatedParams.toString();
    const cleanedFilters = cleanParamsForCookie(validatedParamsString);

    return {
      filters: validatedParamsString,
      serializedCookie: cleanedFilters
        ? await advancedAssetFilterCookie.serialize(cleanedFilters)
        : undefined,
      redirectNeeded: validatedParamsString !== filters,
    };
  } else if (cookieHeader) {
    filters = (await advancedAssetFilterCookie.parse(cookieHeader)) || "";

    if (filters) {
      const validatedParams = new URLSearchParams();
      const columnNames = (settings.columns as Column[]).map((col) => col.name);

      new URLSearchParams(filters).forEach((value, key) => {
        if (!columnNames.includes(key as any)) {
          validatedParams.append(key, value);
          return;
        }

        if (advancedFilterFormatSchema.safeParse(value).success) {
          validatedParams.append(key, value);
        }
      });

      const validatedParamsString = validatedParams.toString();
      const cleanedFilters = cleanParamsForCookie(validatedParamsString);

      return {
        filters: cleanedFilters || undefined,
        serializedCookie: undefined,
        redirectNeeded: !!cleanedFilters,
      };
    }
  }

  return {
    filters: "",
    serializedCookie: undefined,
    redirectNeeded: false,
  };
}

/** HIDE PWA INSTALL PROMPT COOKIE */
export const installPwaPromptCookie = createCookie("hide-pwa-install-prompt", {
  maxAge: 60 * 60 * 24 * 14, // two weeks
});
