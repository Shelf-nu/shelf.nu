import { createCookie, redirect } from "@remix-run/node";
import { NODE_ENV, SESSION_SECRET, getCurrentPath, isGet } from "~/utils";
import {
  destroyCookie,
  parseCookie,
  serializeCookie,
  setCookie,
} from "~/utils/cookies.server";
import { ShelfStackError } from "~/utils/error";

import { getUserOrganizations } from "./service.server";
import type { AuthSession } from "../auth/types";

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

export async function requireOrganisationId(
  { userId }: AuthSession,
  request: Request
) {
  const organizationId = await getSelectedOrganizationIdCookie(request);

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
    throw new ShelfStackError({
      cause: null,
      message:
        "You do not have a personal organization. This should not happen. Please contact support.",
      status: 500,
    });
  }

  // If the user is not part of the organization or the organizationId is not set (should not happen but just in case)
  if (!organizationId || !userOrganizationIds.includes(organizationId)) {
    if (isGet(request)) {
      throw redirect(getCurrentPath(request), {
        headers: [
          setCookie(
            await setSelectedOrganizationIdCookie(personalOrganization.id)
          ),
        ],
      });
    }

    // Other methods should throw an error (mostly for actions)
    throw new ShelfStackError({
      cause: null,
      message: "You do not have access to this organization",
      status: 401,
    });
  }

  return { organizationId, organizations, userOrganizations };
}
