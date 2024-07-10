import type { AuthSession } from "server/session";
import { db } from "~/database/db.server";
import { getAuthUserById } from "~/modules/auth/service.server";
import { INCLUDE_SSO_DETAILS_VIA_USER_ORGANIZATION } from "~/modules/user/fields";
import {
  createUserFromSSO,
  updateUserFromSSO,
} from "~/modules/user/service.server";
import { ShelfError } from "./error";

/**
 * This resolves the correct org we should redirec the user to
 * Also it handles:
 * - Creating a new user if the user doesn't exist
 * - Throwing an error if the user is already connected to an email account
 * - Linking the user to the correct org
 */
export async function resolveUserAndOrgForSsoCallback({
  authSession,
  firstName,
  lastName,
  groups,
}: {
  authSession: AuthSession;
  firstName: string;
  lastName: string;
  groups: string[];
}) {
  /**
   * Cases to handle:
   * - [x] Auth Account & User exists in our database - we just login the user
   * - [x] Auth Account exists but User doesn't exist in our database - we create a new user connecting it to authUser and login the user
   * - [x] Auth Account(SSO version) doesn't exist but User exists in our database - We show an error as we dont allow SSO users to have an email based identity
   * - [x] Auth account exists but is not present in IDP - an employee gets removed from an app. This is handled by IDP
   * - [x] Auth account DOESN'T exist and is not added to IDP - this is handled by IDP. They give an error if its not authenticated
   * - [x] User tries to reset password for a user that is only SSO
   * - [x] User tries to use normal login for a user that is only SSO - we Dont actually need to check that because SSO users will not habe a password they know. As long as we dont allow them to change pwd it should be fine.
   */

  let org;

  /** Look if the user already exists
   * Also get the userOrgs as if we need them for setting the correct cookie
   */
  let user = await db.user.findUnique({
    where: {
      email: authSession.email,
    },
    include: {
      ...INCLUDE_SSO_DETAILS_VIA_USER_ORGANIZATION,
    },
  });

  /** Sign up case */
  if (!user) {
    /**
     * If the user doesnt exist, we create a new one and link to the org which has the domain the user used to log in */
    const response = await createUserFromSSO(authSession, {
      firstName,
      lastName,
      groups,
    });
    user = response.user;
    org = response.org; // This is the org that the user got linked to
  } else {
    /**
     * Login case
     *  - update the names
     *  - update the groups
     * if they are changed in the IDP
     */

    const response = await updateUserFromSSO(authSession, user, {
      firstName,
      lastName,
      groups,
    });
    user = response.user;
    org = response.org;

    if (!org) {
      throw new ShelfError({
        cause: null,
        title: "Organization not found",
        message:
          "It looks like the organization you're trying to log in to is not found. Please contact our support team to get access to your organization.",
        additionalData: { org, user, domain: authSession.email.split("@")[1] },
        label: "Auth",
      });
    }
    /** We check if there is already a auth user with the same id of the user we found
     * If the user is already connected to an email account, we should throw an error
     * Because we dont allow SSO users to have an email based identity
     * @TODO at this point we already have an SSO auth.user created. We need to delete them to keep the app clean.
     */
    const authUser = await getAuthUserById(user.id);
    if (authUser?.app_metadata?.provider === "email") {
      throw new ShelfError({
        cause: null,
        title: "User already exists",
        message:
          "It looks like the email you're using is linked to a personal account in Shelf. Please contact our support team to update your personal workspace to a different email account.",
        label: "Auth",
      });
    }
  }
  return { user, org };
}
