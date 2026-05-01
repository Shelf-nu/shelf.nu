import { createCookie } from "react-router";
import { getRequestCache } from "@server/request-cache.server";
import {
  destroyCookie,
  parseCookie,
  serializeCookie,
} from "~/utils/cookies.server";
import { NODE_ENV, SESSION_SECRET } from "~/utils/env";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";

import type { OrganizationFromUser } from "./service.server";
import { getUserOrganizations } from "./service.server";

const label: ErrorLabel = "Organization";

const selectedOrganizationIdCookie = createCookie("selected-organization-id", {
  httpOnly: true,
  path: "/",
  sameSite: "lax",
  secrets: [SESSION_SECRET],
  secure: NODE_ENV === "production",
  maxAge: 60 * 60 * 24 * 365, // 1 year
});

type SelectedOrganizationId = string;

// Shape returned by getSelectedOrganization for cache typing.
type SelectedOrganization = {
  organizationId: string;
  organizations: OrganizationFromUser[];
  userOrganizations: Awaited<ReturnType<typeof getUserOrganizations>>;
  currentOrganization: OrganizationFromUser;
  cookieRefreshNeeded: boolean;
  /** True when an SSO user has no visible (non-personal) organizations. */
  noVisibleOrganizations?: boolean;
};

type SelectedOrganizationCache = Map<string, Promise<SelectedOrganization>>;

async function getSelectedOrganizationIdCookie(request: Request) {
  return parseCookie<SelectedOrganizationId>(
    selectedOrganizationIdCookie,
    request
  );
}

export function setSelectedOrganizationIdCookie<
  T extends SelectedOrganizationId,
>(value: T) {
  return serializeCookie<T>(selectedOrganizationIdCookie, value);
}

export function destroySelectedOrganizationIdCookie() {
  return destroyCookie(selectedOrganizationIdCookie);
}

/**
 * This function is used to get the selected organization for the user.
 * It checks if the user is part of the current selected organization.
 *
 * For non-SSO users it defaults to the personal organization when no
 * valid selection exists. For SSO users (`user.sso === true`) the
 * personal workspace is automatically hidden — the fallback skips it.
 *
 * The SSO flag is resolved internally from the `getUserOrganizations`
 * query so every caller (layout loader, child loaders, permission
 * checks) gets consistent behaviour without needing to pass `isSSO`.
 *
 * @throws If a non-SSO user has no organizations at all.
 */
// Uncached implementation used as the single source of truth.
async function getSelectedOrganizationUncached({
  userId,
  request,
}: {
  userId: string;
  request: Request;
}) {
  let organizationId = await getSelectedOrganizationIdCookie(request);

  /** There could be a case when you get removed from an organization while browsing it.
   * In this case what we do is we set the current organization to the first one in the list
   */
  const userOrganizations = await getUserOrganizations({ userId });
  const allOrganizations = userOrganizations.map((uo) => uo.organization);

  // Resolve the SSO flag from the already-fetched user data so the
  // result is consistent regardless of which loader populates the cache.
  const isSSO = userOrganizations[0]?.user?.sso === true;

  // SSO users never see their personal workspace — filter it out.
  const organizations = isSSO
    ? allOrganizations.filter((org) => org.type !== "PERSONAL")
    : allOrganizations;

  // SSO user with no team orgs — return early with a sentinel so the
  // caller can redirect to the "pending assignment" page.
  if (isSSO && organizations.length === 0) {
    return {
      organizationId: "",
      organizations: [],
      userOrganizations,
      currentOrganization: null as unknown as OrganizationFromUser,
      cookieRefreshNeeded: false,
      noVisibleOrganizations: true,
    };
  }

  const userOrganizationIds = organizations.map((org) => org.id);

  // Track whether we need to refresh the cookie (fallback was used)
  let cookieRefreshNeeded = false;

  // If the organizationId is not set or the user is not part of the organization,
  // fall back to the last selected organization from the database (cross-device persistence),
  // then to the personal organization (non-SSO only), then to the first available organization
  if (!organizationId || !userOrganizationIds.includes(organizationId)) {
    cookieRefreshNeeded = true;

    // Piggyback on the already-fetched userOrganizations query
    const user = userOrganizations[0]?.user;
    const lastSelectedOrganizationId = user?.lastSelectedOrganizationId ?? null;

    if (
      lastSelectedOrganizationId &&
      userOrganizationIds.includes(lastSelectedOrganizationId)
    ) {
      // DB field is valid — cross-device persistence working
      organizationId = lastSelectedOrganizationId;
    } else if (!isSSO) {
      // Non-SSO: prefer the personal org, then first available
      const personalOrg = organizations.find((org) => org.type === "PERSONAL");
      organizationId = personalOrg?.id ?? userOrganizationIds[0];
    } else {
      // SSO: personal org already filtered out, use first team org
      organizationId = userOrganizationIds[0];
    }
  }

  const currentOrganization = organizations.find(
    (org) => org.id === organizationId
  );

  // (should not happen but just in case)
  if (!currentOrganization) {
    throw new ShelfError({
      cause: null,
      title: "No organization",
      message:
        "You do not have access to any organization. Please contact support.",
      status: 403,
      additionalData: { userId, organizationId, userOrganizationIds },
      shouldBeCaptured: false,
      label,
    });
  }

  const nonNullCurrentOrganization: OrganizationFromUser = currentOrganization;

  return {
    organizationId,
    organizations,
    userOrganizations,
    currentOrganization: nonNullCurrentOrganization,
    cookieRefreshNeeded,
  };
}

/**
 * Returns the selected organization for the user and caches the result per
 * incoming request to avoid duplicate DB queries when loaders run in parallel.
 *
 * SSO filtering is resolved internally from the user record — callers do
 * not need to pass an `isSSO` flag.
 */
export async function getSelectedOrganization({
  userId,
  request,
}: {
  userId: string;
  request: Request;
}) {
  // Create a per-request cache bucket keyed by userId.
  const requestCache = getRequestCache(
    "selected-organization"
  ) as SelectedOrganizationCache | null;
  if (!requestCache) {
    return getSelectedOrganizationUncached({ userId, request });
  }

  // Reuse the same promise during this request to avoid duplicate queries.
  const cached = requestCache.get(userId);
  if (cached) {
    return cached;
  }

  // Store the in-flight promise so concurrent callers share it.
  const pending = getSelectedOrganizationUncached({
    userId,
    request,
  }).catch((error) => {
    // Evict failed promises so later calls in this request can retry.
    requestCache.delete(userId);
    throw error;
  });
  requestCache.set(userId, pending);
  return pending;
}
