import type { Organization, SsoDetails } from "@prisma/client";
import type { AuthSession } from "server/session";
import { db } from "~/database/db.server";
import {
  deleteAuthAccount,
  getAuthUserById,
} from "~/modules/auth/service.server";
import {
  emailMatchesDomains,
  parseDomains,
} from "~/modules/organization/service.server";
import { INCLUDE_SSO_DETAILS_VIA_USER_ORGANIZATION } from "~/modules/user/fields";
import {
  createUserFromSSO,
  updateUserFromSSO,
} from "~/modules/user/service.server";
import { ShelfError } from "./error";
import { isValidDomain } from "./misc";

/**
 * This resolves the correct org we should redirect the user to
 * Also it handles:
 * - Creating a new user if the user doesn't exist
 * - Throwing an error if the user is already connected to an email account
 * - Linking the user to the correct org if SCIM is configured
 *
 * Cases to handle:
 * - [x] Auth Account & User exists in our database - we just login the user
 * - [x] Auth Account exists but User doesn't exist in our database - we create a new user connecting it to authUser and login the user
 * - [x] Auth Account(SSO version) doesn't exist but User exists in our database - We show an error as we dont allow SSO users to have an email based identity
 * - [x] Auth account exists but is not present in IDP - an employee gets removed from an app. This is handled by IDP
 * - [x] Auth account DOESN'T exist and is not added to IDP - this is handled by IDP. They give an error if its not authenticated
 * - [x] User tries to reset password for a user that is only SSO
 * - [x] User tries to use normal login for a user that is only SSO - we Dont actually need to check that because SSO users will not have a password they know. As long as we dont allow them to change pwd it should be fine.
 *
 * New cases for Pure SSO:
 * - [x] User signs up with SSO from a domain that has no org configured - should create user with personal workspace only
 * - [x] User signs up with SSO from domain that has org with SCIM - should create user with personal workspace and add to org based on groups
 * - [x] User signs up with SSO from domain that has org without SCIM - should create user with personal workspace only
 * - [x] User with SSO gets invited to a workspace - should be able to accept invite
 * - [x] Existing SSO user's domain gets configured for SCIM - on next login should get org access based on groups
 * - [x] SCIM user loses all group access - should keep personal workspace but lose org access
 */
export async function resolveUserAndOrgForSsoCallback({
  authSession,
  firstName,
  lastName,
  groups,
  contactInfo,
}: {
  authSession: AuthSession;
  firstName: string;
  lastName: string;
  groups: string[];
  contactInfo?: {
    phone?: string;
    street?: string;
    city?: string;
    stateProvince?: string;
    zipPostalCode?: string;
    countryRegion?: string;
  };
}) {
  try {
    // First check if user exists
    let user = await db.user.findUnique({
      where: {
        email: authSession.email,
      },
      include: {
        ...INCLUDE_SSO_DETAILS_VIA_USER_ORGANIZATION,
      },
    });

    // If user exists, check if they're trying to convert from email to SSO
    if (user) {
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

      // Existing SSO user - update their info
      const response = await updateUserFromSSO(authSession, user, {
        firstName,
        lastName,
        groups,
        contactInfo,
      });
      return { user: response.user, org: response.org };
    }

    // New user case - create them with SSO
    try {
      const response = await createUserFromSSO(authSession, {
        firstName,
        lastName,
        groups,
        contactInfo,
      });
      return { user: response.user, org: response.org };
    } catch (createError) {
      // If user creation fails, clean up the auth account
      await deleteAuthAccount(authSession.userId);
      throw createError;
    }
  } catch (cause: any) {
    throw new ShelfError({
      cause,
      title: cause.title || "Authentication failed",
      message: cause.message || "Failed to authenticate user",
      additionalData: {
        email: authSession.email,
        domain: authSession.email.split("@")[1],
      },
      label: "Auth",
    });
  }
}

interface SSODomainConfig {
  id: string;
  ssoProviderId: string;
  domain: string;
}

/**
 * Type for domain check response
 */
interface DomainCheckResult {
  isConfiguredForSSO: boolean;
  linkedOrganization: (Organization & { ssoDetails: SsoDetails | null }) | null;
  ssoProviderId: string | null;
}

/**
 * Fetches all domains configured for SSO in the auth schema
 * Uses raw query to access auth schema tables
 */
export async function getConfiguredSSODomains(): Promise<SSODomainConfig[]> {
  try {
    const domains = await db.$queryRaw<SSODomainConfig[]>`
      SELECT 
        id::text,
        sso_provider_id::text as "ssoProviderId",
        domain
      FROM auth.sso_domains
    `;

    return domains;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to fetch SSO domain configurations",
      label: "SSO",
    });
  }
}

/**
 * Checks domain's SSO status and organization linkage
 * Handles multiple domains per organization and multiple SSO providers per domain
 * @param email - Email to check domain for
 */
export async function checkDomainSSOStatus(
  email: string
): Promise<DomainCheckResult> {
  try {
    const domain = email.split("@")[1].toLowerCase();

    // Check all SSO providers configured for this domain
    const ssoConfigs = await db.$queryRaw<{ ssoProviderId: string }[]>`
      SELECT sso_provider_id::text as "ssoProviderId"
      FROM auth.sso_domains
      WHERE lower(domain) = ${domain}
    `;

    if (ssoConfigs.length === 0) {
      return {
        isConfiguredForSSO: false,
        linkedOrganization: null,
        ssoProviderId: null,
      };
    }

    // Get all SSO provider IDs for this domain
    const ssoProviderIds = ssoConfigs.map((config) => config.ssoProviderId);

    // Find organization where this domain is included in their comma-separated domains
    const linkedOrg = await db.organization.findFirst({
      where: {
        ssoDetails: {
          domain: {
            contains: domain,
          },
        },
      },
      include: {
        ssoDetails: true,
      },
    });

    // If we found an org, verify the domain is actually in their list
    const isValidDomain = linkedOrg?.ssoDetails
      ? emailMatchesDomains(email, linkedOrg.ssoDetails.domain)
      : false;

    // Return the first SSO provider ID if we found multiple
    // This maintains backward compatibility while we handle multiple domains
    return {
      isConfiguredForSSO: true,
      linkedOrganization: isValidDomain ? linkedOrg : null,
      ssoProviderId: ssoProviderIds[0] || null,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to check domain SSO status",
      additionalData: { email },
      label: "SSO",
    });
  }
}

/**
 * Checks if a user with given email exists and uses SSO
 * @param email - Email to check
 */
export async function doesSSOUserExist(email: string): Promise<boolean> {
  try {
    const user = await db.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { sso: true },
    });

    return user?.sso || false;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to check SSO user existence",
      additionalData: { email },
      label: "SSO",
    });
  }
}

/**
 * Validates if signup is allowed for an email based on SSO configuration
 * @throws ShelfError if signup is not allowed due to SSO configuration
 */
export async function validateNonSSOSignup(email: string): Promise<void> {
  const domainStatus = await checkDomainSSOStatus(email);

  if (domainStatus.isConfiguredForSSO) {
    throw new ShelfError({
      cause: null,
      message:
        "This email domain uses SSO authentication. Please sign in using your organization's SSO provider.",
      label: "Auth",
      status: 400,
      shouldBeCaptured: false,
    });
  }
}

/**
 * Validates multiple comma-separated domains
 * @param domainsString Comma-separated string of domains
 * @returns Array of validated domains
 * @throws Error if any domain is invalid
 */
export function validateDomains(domainsString: string): string[] {
  const domains = parseDomains(domainsString);

  if (domains.length === 0) {
    throw new Error("At least one domain is required");
  }

  // Validate each domain
  const invalidDomains = domains.filter((domain) => !isValidDomain(domain));
  if (invalidDomains.length > 0) {
    throw new Error(`Invalid domain(s): ${invalidDomains.join(", ")}`);
  }

  return domains;
}
