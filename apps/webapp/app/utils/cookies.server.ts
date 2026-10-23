import type { AssetIndexSettings } from "@prisma/client";
import { createCookie } from "react-router"; // or cloudflare/deno

import type { Cookie } from "react-router";
import type { AllowedPathname } from "~/hooks/search-params";
import {
  ADVANCED_ASSET_FILTER_COOKIE_SUFFIX,
  ALLOWED_FILTER_PATHNAMES,
  cleanParamsForFilterCookie,
} from "~/hooks/search-params";
import { advancedFilterFormatSchema } from "~/modules/asset/utils.server";
import type { Column } from "~/modules/asset-index-settings/helpers";
import { COOKIE_DOMAIN } from "./env";
import { getCurrentSearchParams } from "./http.server";
import { DEFAULT_PER_PAGE, isPerPageOption } from "./per-page";

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

/**
 * MOBILE SSO PKCE CHALLENGE COOKIE
 *
 * Carries the PKCE `code_challenge` (S256) across the native-app SSO round-trip.
 * A PKCE-capable companion build appends `?code_challenge=…` when it opens
 * `/sso-login`; the loader stashes it here so it survives the browser-session
 * redirect chain (Supabase → IdP → `/oauth/callback/mobile`), where it is bound
 * to the minted auth code and then cleared. HttpOnly + short-lived: it only
 * needs to outlive one SSO login. The value is a non-secret hash, so it is not
 * signed — tampering only breaks the attacker's own exchange.
 *
 * @see apps/webapp/app/routes/_auth+/sso-login.tsx — sets it
 * @see apps/webapp/app/routes/_auth+/oauth.callback_.mobile.tsx — reads + clears it
 */
export const mobilePkceChallengeCookie = createCookie("mobile_pkce_challenge", {
  path: "/",
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 10, // 10 min — must outlive the IdP login + the redirect chain
});

/** USER PREFS COOKIE */

export const userPrefs = createCookie("user-prefs", {
  maxAge: 604_800, // one week
  sameSite: "lax" as const,
  domain: COOKIE_DOMAIN, // e.g. ".shelf.nu" — lets the marketing site detect signed-in users
});

/**
 * Expires the old host-only `user-prefs` cookie left over from before the
 * `domain` attribute was added, so a browser does not carry two cookies of the
 * same name for up to 7 days.
 *
 * Only emitted when {@link COOKIE_DOMAIN} is set. Without a domain the real
 * cookie IS host-only, so this would delete the very cookie the same response
 * is writing — which is every deployment that leaves `COOKIE_DOMAIN` unset,
 * local development included, where it silently discards every user preference
 * on each page load.
 *
 * Returns a list so a caller can spread it and emit nothing at all.
 *
 * @returns The expiry header, or an empty list when there is nothing to expire
 * @TODO Can be removed once every session predating the domain attribute has
 * aged out (the cookie's own lifetime is a week).
 */
export function expireHostOnlyUserPrefsCookie(): Array<[string, string]> {
  if (!COOKIE_DOMAIN) {
    return [];
  }

  return [["Set-Cookie", "user-prefs=; Path=/; Max-Age=0; SameSite=Lax"]];
}

/**
 * Resolves the page size to remember for a list request.
 *
 * A `per_page` from the URL is remembered only when the per-page menu offers
 * it. Otherwise the stored size stands, and a stored size the menu does not
 * offer falls back to the default.
 *
 * @param request - The list request, carrying the `user-prefs` cookie
 * @param perPageParam - `per_page` from the URL, 0 when absent
 * @returns The `user-prefs` value to serialize back, with a supported `perPage`
 */
export async function updateCookieWithPerPage(
  request: Request,
  perPageParam: number
) {
  const cookieHeader = request.headers.get("Cookie");
  const cookie = (await userPrefs.parse(cookieHeader)) || {};

  if (isPerPageOption(perPageParam)) {
    cookie.perPage = perPageParam;
  } else if (!isPerPageOption(cookie.perPage)) {
    cookie.perPage = DEFAULT_PER_PAGE;
  }
  return cookie;
}

/**
 * Makes sure `user-prefs` holds a supported page size on every page load, so
 * a missing or unsupported value is replaced with the default.
 *
 * @param request - The layout request, carrying the `user-prefs` cookie
 * @returns The `user-prefs` value to serialize back
 */
export async function initializePerPageCookieOnLayout(request: Request) {
  const cookieHeader = request.headers.get("Cookie");
  const cookie = (await userPrefs.parse(cookieHeader)) || {};
  if (!isPerPageOption(cookie.perPage)) {
    cookie.perPage = DEFAULT_PER_PAGE;
  }
  return cookie;
}

/**
 * Attributes every list filter cookie is written with. Expiring one must use
 * the same path, so {@link expireFilterCookie} reads them from here too.
 *
 * No secrets: filter cookies are UI preferences, and unsigned cookies work
 * with RR7 single fetch.
 */
const FILTER_COOKIE_OPTIONS = {
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 365, // 1 year
} as const;

/**
 * Index FILTER COOKIE
 * This cookie is used to store the current search params for an index page.
 * It is used to persist filters across page loads. It never holds the typed
 * search, and signing out or in expires it (see {@link expireListPreferenceCookies}).
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
}) => createCookie(`${orgId}_${name}`, { ...FILTER_COOKIE_OPTIONS, path });

/**
 * Serializes the expiry of a root-path list filter cookie.
 *
 * @param name - The full cookie name (`<orgId>_<suffix>`)
 * @returns The `Set-Cookie` value that deletes it
 */
function expireFilterCookie(name: string) {
  return createCookie(name, { ...FILTER_COOKIE_OPTIONS, path: "/" }).serialize(
    "",
    { maxAge: 0 }
  );
}

/**
 * Names of the cookies a request carries.
 *
 * @param cookieHeader - The request's Cookie header
 */
function getCookieNames(cookieHeader: string | null) {
  return new Set(
    (cookieHeader ?? "").split(";").map((pair) => pair.trim().split("=")[0])
  );
}

/**
 * The `Set-Cookie` value for a list whose URL has params: the cleaned filters
 * to remember, or an expiry when nothing is left to remember (a URL holding
 * only a search), so an older cookie cannot bring back filters the URL dropped.
 *
 * @param filterCookie - The list's filter cookie
 * @param cleanedFilters - The URL params after {@link cleanParamsForFilterCookie}
 * @param cookieHeader - The request's Cookie header
 * @returns The value to send, or null when there is nothing to write
 */
async function serializeFilterCookieForUrl(
  filterCookie: Cookie,
  cleanedFilters: string,
  cookieHeader: string | null
) {
  if (cleanedFilters) {
    return filterCookie.serialize(cleanedFilters);
  }
  return getCookieNames(cookieHeader).has(filterCookie.name)
    ? expireFilterCookie(filterCookie.name)
    : null;
}

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
  // Get filters from URL query parameters (e.g., "status=AVAILABLE&s=laptop")
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
    // Remove pagination, one-off keys and the typed search before saving
    const serializedCookie = await serializeFilterCookieForUrl(
      filterCookie,
      cleanParamsForFilterCookie(filters),
      cookieHeader
    );

    // Return original filters for current request, cleaned version for cookie
    return { filters, serializedCookie };
  }
  // CASE 2: No URL filters, but cookie exists
  // Parse cookie and redirect to apply filters to URL
  else if (cookieHeader) {
    // Parse cookie to get saved filters
    filters = (await filterCookie.parse(cookieHeader)) || {};
    // Apply the same rule to what an older cookie may still hold
    const cleanedFilters = cleanParamsForFilterCookie(filters);

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
  createCookie(`${orgId}_${ADVANCED_ASSET_FILTER_COOKIE_SUFFIX}`, {
    ...FILTER_COOKIE_OPTIONS,
    path: "/", // Use root path so cookie is sent with RR7 single fetch .data requests
  });

/**
 * Normalize a filter param string for the Advanced-mode Assets index.
 *
 * Column filters not in operator form (e.g. `?location=<uuid>` emitted by
 * report drill-downs or external deep links) are promoted to `is:<value>`
 * so downstream filter parsing applies them rather than dropping them
 * silently — which previously broke drill-down for Advanced-mode workspaces.
 * Non-column params (page, search, etc.) pass through unchanged.
 *
 * Values that contain a `:` but fail operator validation are treated as
 * **malformed operator attempts** and dropped, preserving the previous
 * reject-unknown-operator semantics. Otherwise downstream code would split
 * something like `?status=foo:AVAILABLE` into operator=`is`, value=`foo`
 * and try to cast `foo` to the AssetStatus enum at query time.
 *
 * Used by both the URL path (CASE 1) and the cookie path (CASE 2) of
 * {@link getAdvancedFiltersFromRequest}.
 */
function normalizeAdvancedFilterParams(
  filters: string,
  columnNames: string[],
  dropParam?: (key: string, value: string) => boolean
): URLSearchParams {
  const normalized = new URLSearchParams();
  new URLSearchParams(filters).forEach((value, key) => {
    if (dropParam?.(key, value)) return;
    if (!columnNames.includes(key)) {
      normalized.append(key, value);
      return;
    }
    if (advancedFilterFormatSchema.safeParse(value).success) {
      normalized.append(key, value);
      return;
    }
    // Only promote unambiguous bare values. A `:` indicates the caller meant
    // operator form; if it didn't validate above, the operator is unknown and
    // we keep the old "drop malformed" behavior rather than coercing it.
    if (value && !value.includes(":")) {
      normalized.append(key, `is:${value}`);
    }
  });
  return normalized;
}

/**
 * Gets and validates advanced filters from request parameters
 * Ensures URL parameters match the expected advanced filter format
 * @param request - The incoming request
 * @param organizationId - The organization ID for the request
 * @param settings - The asset index settings containing column configuration
 * @param dropParam - Params the caller may not use. They are removed from both
 *   the URL (with a redirect, and from the saved cookie) and a restored cookie.
 * @returns Object containing filters, serialized cookie, and redirect status
 */
export async function getAdvancedFiltersFromRequest(
  request: Request,
  organizationId: string,
  settings: AssetIndexSettings,
  dropParam?: (key: string, value: string) => boolean
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
  const columnNames = (settings.columns as Column[]).map((col) => col.name);

  // CASE 1: URL has filters
  // Validate them, save to cookie, and return (with redirect if validation changed params)
  if (filters) {
    const validatedParams = normalizeAdvancedFilterParams(
      filters,
      columnNames,
      dropParam
    );
    const validatedParamsString = validatedParams.toString();
    const serializedCookie = await serializeFilterCookieForUrl(
      advancedAssetFilterCookie,
      cleanParamsForFilterCookie(validatedParamsString),
      cookieHeader
    );

    return {
      filters: validatedParamsString,
      // Save validated filters to cookie for next visit
      serializedCookie: serializedCookie ?? undefined,
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
      const validatedParams = normalizeAdvancedFilterParams(
        filters,
        columnNames,
        dropParam
      );
      const validatedParamsString = validatedParams.toString();
      const cleanedFilters = cleanParamsForFilterCookie(validatedParamsString);

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

/** Name suffixes of every list filter cookie, simple and Advanced. */
const LIST_FILTER_COOKIE_SUFFIXES = [
  ...Object.values(ALLOWED_FILTER_PATHNAMES),
  ADVANCED_ASSET_FILTER_COOKIE_SUFFIX,
];

/**
 * Whether a cookie name is a list filter cookie (`<orgId>_<suffix>`).
 *
 * @param name - A cookie name from the request
 */
function isListFilterCookieName(name: string) {
  return LIST_FILTER_COOKIE_SUFFIXES.some((suffix) =>
    name.endsWith(`_${suffix}`)
  );
}

/**
 * Expires the list preferences this browser remembers, which are not tied to
 * an account: the filter cookies of the assets (simple and Advanced), bookings
 * and kits lists for every workspace, and the page size in `user-prefs`.
 *
 * - **Sign-out** expires the whole `user-prefs` cookie: the next person on the
 *   browser also gets the default sidebar, scanner camera, onboarding
 *   checklist and banners.
 * - **Sign-in** drops only `perPage` from `user-prefs` and keeps the other UI
 *   choices, so a person signing in again keeps their own. It still resets the
 *   lists, which covers a session that ended without a sign-out.
 *
 * Only cookies the request carries are touched. Filter cookies are named per
 * workspace, so the Cookie header is where they are found; they all live on the
 * root path, which every request carries.
 *
 * @param request - The sign-out or sign-in request
 * @param options.event - Whether the response signs a person out or in
 * @returns `Set-Cookie` tuples to spread into the response headers
 */
export async function expireListPreferenceCookies(
  request: Request,
  { event }: { event: "sign-in" | "sign-out" }
): Promise<Array<[string, string]>> {
  const cookieHeader = request.headers.get("Cookie");
  const cookieNames = getCookieNames(cookieHeader);

  const filterExpiries = await Promise.all(
    [...cookieNames]
      .filter(isListFilterCookieName)
      .map(async (name) => setCookie(await expireFilterCookie(name)))
  );

  if (!cookieNames.has(userPrefs.name)) {
    return filterExpiries;
  }

  const prefs: unknown = await userPrefs.parse(cookieHeader);
  const keptPrefs =
    event === "sign-in" && prefs && typeof prefs === "object"
      ? { ...(prefs as Record<string, unknown>) }
      : {};
  delete keptPrefs.perPage;

  // Rewriting keeps the deployment's cookie domain from `userPrefs`
  if (Object.keys(keptPrefs).length > 0) {
    return [...filterExpiries, setCookie(await userPrefs.serialize(keptPrefs))];
  }

  // `userPrefs` carries the deployment's cookie domain, so this expiry reaches
  // the domain-scoped cookie; the shim clears a host-only leftover.
  return [
    ...filterExpiries,
    setCookie(await userPrefs.serialize({}, { maxAge: 0 })),
    ...expireHostOnlyUserPrefsCookie(),
  ];
}
