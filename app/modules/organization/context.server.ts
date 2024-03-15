import { createCookie } from "@remix-run/node";
import { NODE_ENV, SESSION_SECRET } from "~/utils";
import {
  destroyCookie,
  parseCookie,
  serializeCookie,
} from "~/utils/cookies.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";

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
 *
 * It checks if the user is part of the current selected organization
 *
 * **It always defaults to the personal organization if the user is not part of the current selected organization.**
 *
 * @throws If the user is not part of any organization
 */
export async function getSelectedOrganisation({
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
  const organizations = userOrganizations.map((uo) => uo.organization);
  const userOrganizationIds = organizations.map((org) => org.id);
  const personalOrganization = organizations.find(
    (org) => org.type === "PERSONAL"
  );

  if (!personalOrganization) {
    throw new ShelfError({
      cause: null,
      title: "No personal organization found",
      message:
        "You do not have a personal organization. This should not happen. Please contact support.",
      additionalData: { userId, organizationId, userOrganizationIds },
      label,
    });
  }

  // If the organizationId is not set or the user is not part of the organization, we set it to the personal organization
  // This case should be extremely rare (be revoked from an organization while browsing it), so, I keep it simple
  if (!organizationId || !userOrganizationIds.includes(organizationId)) {
    organizationId = personalOrganization.id;
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

  return {
    organizationId,
    organizations,
    userOrganizations,
    currentOrganization,
  };
}
