import type { AssetIndexSettings } from "@prisma/client";
import { createCookie } from "react-router"; // or cloudflare/deno

import type { Cookie } from "react-router";
import type {
  ALLOWED_FILTER_PATHNAMES,
  AllowedPathname,
} from "~/hooks/search-params";
import { cleanParamsForCookie } from "~/hooks/search-params";
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
 * Parse a cookie from a request
 * This function takes a cookie object and a request, and attempts to parse the cookie from the request headers.
 * If the cookie is not found or cannot be parsed, it returns null.
 * If the cookie is successfully parsed, it returns the parsed value.
 * @param cookie - The cookie object to parse
 * @param request - The request object containing headers
 * @returns The parsed cookie value or null if parsing fails
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

  const cookie = (await userPrefs.parse(cookieHeader)) || {};
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

/**
 * Index FILTER COOKIE
 * This cookie is used to store the current search params for an index page.
 * It is used to persist filters across page loads and sessions.
 * It is created with a 1 year max age and is stored in the root path of the organization.
 * The cookie is created with the organization ID and filter name to avoid conflicts between different organizations.
 * IMPORTANT: When using this to add new cookies, make sure to update ALLOWED_FILTER_PATHNAMES in useSearchParams hook
 *
 * @param orgId - The organization ID to create the cookie for
 * @param name - The name of the filter to create the cookie for
 * @param path - The path to set the cookie for, typically the root of the organization
 * @returns A cookie object that can be used to serialize and parse the filter data
 */
export const createFilterCookie = ({
  orgId,
  name,
  path,
}: {
  orgId: string;
  name: string;
  path: string;
}) =>
  createCookie(`${orgId}_${name}`, {
    path,
    sameSite: "lax",
    // No secrets - filter cookies don't need signing (just UI preferences)
    // This ensures they work correctly in RR7 single fetch mode
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });

type FilterCookieConfig = {
  [K in AllowedPathname]: {
    name: (typeof ALLOWED_FILTER_PATHNAMES)[K];
    path: `/${K}` | "/"; // Allow root path for RR7 single fetch compatibility
  };
}[AllowedPathname];

/**
 * Gets and validates filters from request parameters
 * Ensures URL parameters match the expected filter format
 * @param request - The incoming request
 * @param organizationId - The organization ID for the request
 * @param cookie - The cookie configuration containing name and path
 * @returns Object containing filters, serialized cookie, and redirect status
 */
export async function getFiltersFromRequest(
  request: Request,
  organizationId: string,
  cookie: FilterCookieConfig
) {
  // Get filters from URL query parameters (e.g., "status=AVAILABLE&search=laptop")
  let filters = getCurrentSearchParams(request).toString();
  const cookieHeader = request.headers.get("Cookie");

  const filterCookie = createFilterCookie({
    orgId: organizationId,
    name: cookie.name,
    path: cookie.path,
  });

  // CASE 1: URL has filters
  // Save them to cookie and return (no redirect needed, URL already has filters)
  if (filters) {
    // Remove sensitive params (page, getAll, etc.) before saving to cookie
    const cleanedFilters = cleanParamsForCookie(filters);
    // Serialize to Set-Cookie header if we have filters after cleaning
    const serializedCookie = cleanedFilters
      ? await filterCookie.serialize(cleanedFilters)
      : null;

    // Return original filters for current request, cleaned version for cookie
    return { filters, serializedCookie };
  }
  // CASE 2: No URL filters, but cookie exists
  // Parse cookie and redirect to apply filters to URL
  else if (cookieHeader) {
    // Parse cookie to get saved filters
    filters = (await filterCookie.parse(cookieHeader)) || {};
    // Remove sensitive params before applying
    const cleanedFilters = cleanParamsForCookie(filters);

    // Redirect to add filters to URL if we have any
    return {
      filters: cleanedFilters,
      redirectNeeded: !!cleanedFilters,
    };
  }

  // CASE 3: No filters in URL and no cookie
  // Return empty state
  return { filters: "" };
}

/** ASSET FILTER COOKIE - ADVANCED MODE */
export const createAdvancedAssetFilterCookie = (orgId: string) =>
  createCookie(`${orgId}_advancedAssetFilter_v2`, {
    path: "/", // Use root path so cookie is sent with RR7 single fetch .data requests
    sameSite: "lax",
    // No secrets - filter cookies don't need signing (just UI preferences)
    // This ensures they work correctly in RR7 single fetch mode
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
  // Get filters from URL query parameters
  let filters = getCurrentSearchParams(request).toString();
  const cookieHeader = request.headers.get("Cookie");
  const advancedAssetFilterCookie =
    createAdvancedAssetFilterCookie(organizationId);

  // CASE 1: URL has filters
  // Validate them, save to cookie, and return (with redirect if validation changed params)
  if (filters) {
    const validatedParams = new URLSearchParams();
    const columnNames = (settings.columns as Column[]).map((col) => col.name);

    // Validate each filter parameter
    new URLSearchParams(filters).forEach((value, key) => {
      // Non-column params (like page, search) pass through without validation
      if (!columnNames.includes(key as any)) {
        validatedParams.append(key, value);
        return;
      }

      // Column filters must match advanced filter format (e.g., "is:AVAILABLE")
      if (advancedFilterFormatSchema.safeParse(value).success) {
        validatedParams.append(key, value);
      }
    });

    const validatedParamsString = validatedParams.toString();
    const cleanedFilters = cleanParamsForCookie(validatedParamsString);

    return {
      filters: validatedParamsString,
      // Save validated filters to cookie for next visit
      serializedCookie: cleanedFilters
        ? await advancedAssetFilterCookie.serialize(cleanedFilters)
        : undefined,
      // Redirect needed if validation changed the params
      redirectNeeded: validatedParamsString !== filters,
    };
  }
  // CASE 2: No URL filters, but cookie exists
  // Parse cookie, validate filters from it, and redirect to apply them to URL
  else if (cookieHeader) {
    // Parse the cookie to get saved filters
    filters = (await advancedAssetFilterCookie.parse(cookieHeader)) || "";

    if (filters) {
      const validatedParams = new URLSearchParams();
      const columnNames = (settings.columns as Column[]).map((col) => col.name);

      // Validate each filter from cookie
      new URLSearchParams(filters).forEach((value, key) => {
        // Non-column params pass through
        if (!columnNames.includes(key as any)) {
          validatedParams.append(key, value);
          return;
        }

        // Column filters must match advanced filter format
        if (advancedFilterFormatSchema.safeParse(value).success) {
          validatedParams.append(key, value);
        }
      });

      const validatedParamsString = validatedParams.toString();
      const cleanedFilters = cleanParamsForCookie(validatedParamsString);

      return {
        filters: cleanedFilters || undefined,
        // Don't save back to cookie (already there)
        serializedCookie: undefined,
        // Redirect to apply filters to URL
        redirectNeeded: !!cleanedFilters,
      };
    }
  }

  // CASE 3: No filters in URL and no cookie
  // Return empty state, no redirect needed
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
