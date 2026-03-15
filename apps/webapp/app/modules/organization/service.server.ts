import {
  AssetIndexMode,
  OrganizationRoles,
  OrganizationType,
  Roles,
} from "@shelf/database";
import type { Organization, TierId, User } from "@shelf/database";
import type Stripe from "stripe";

import { db } from "~/database/db.server";
import {
  create,
  createMany,
  findFirst,
  findFirstOrThrow,
  findMany,
  findUnique,
  findUniqueOrThrow,
  update,
  updateMany,
} from "~/database/query-helpers.server";
import { rpc } from "~/database/transaction.server";
import { sendEmail } from "~/emails/mail.server";
import { DEFAULT_MAX_IMAGE_UPLOAD_SIZE } from "~/utils/constants";
import { ADMIN_EMAIL } from "~/utils/env";
import type { ErrorLabel } from "~/utils/error";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import {
  createStripeCustomer,
  customerHasPaymentMethod,
  getUserActiveSubscription,
  getUserActiveSubscriptions,
  premiumIsEnabled,
  transferSubscriptionToCustomer,
} from "~/utils/stripe.server";
import { newOwnerEmailText, previousOwnerEmailText } from "./email";
import { defaultFields } from "../asset-index-settings/helpers";
import { defaultUserCategories } from "../category/default-categories";
import { updateUserTierId } from "../tier/service.server";
import { getDefaultWeeklySchedule } from "../working-hours/service.server";

const label: ErrorLabel = "Organization";

export type OrganizationWithIncludes = Organization & {
  [key: string]: unknown;
};

export async function getOrganizationById(
  id: Organization["id"],
  extraIncludes?: Record<string, unknown>
) {
  try {
    // Build a select string based on extraIncludes
    let selectStr = "*";
    if (extraIncludes) {
      const joinParts: string[] = [];
      for (const [relation] of Object.entries(extraIncludes)) {
        // Map known relation names to their Supabase join syntax
        if (relation === "customFields") {
          joinParts.push("customFields:CustomField(*)");
        } else if (relation === "ssoDetails") {
          joinParts.push("ssoDetails:SsoDetails(*)");
        } else {
          joinParts.push(`${relation}(*)`);
        }
      }
      if (joinParts.length > 0) {
        selectStr = `*, ${joinParts.join(", ")}`;
      }
    }

    return await findUniqueOrThrow(db, "Organization", {
      where: { id },
      select: selectStr,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "No organization found with this ID",
      additionalData: { id },
      label,
    });
  }
}

export const getOrganizationByUserId = async ({
  userId,
  orgType,
}: {
  userId: User["id"];
  orgType: OrganizationType;
}) => {
  try {
    return await findFirstOrThrow(db, "Organization", {
      where: {
        userId,
        type: orgType,
      },
      select: "id, name, type, currency",
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "No organization found for this user.",
      additionalData: {
        userId,
        orgType,
      },
      label,
    });
  }
};

/**
 * Gets organizations that use the email domain for SSO
 * Supports multiple domains per organization via comma-separated domain strings
 * @param emailDomain - Email domain to check
 * @returns Array of organizations that use this domain for SSO
 */
export async function getOrganizationsBySsoDomain(emailDomain: string) {
  try {
    if (!emailDomain) {
      throw new ShelfError({
        cause: null,
        message: "Email domain is required",
        additionalData: { emailDomain },
        label: "SSO",
      });
    }

    // Query for organizations that have ssoDetails with a domain containing the email domain
    // First get all organizations with ssoDetails, then filter
    const organizations = await findMany(db, "Organization", {
      select: "*, ssoDetails:SsoDetails(*)",
    });

    // Filter organizations that have ssoDetails and domain contains emailDomain
    const orgsWithMatchingDomain = (organizations as any[]).filter((org) => {
      if (!org.ssoDetails || !org.ssoDetails.domain) return false;
      return (org.ssoDetails.domain as string).includes(emailDomain);
    });

    // Filter to ensure exact domain matches
    return orgsWithMatchingDomain.filter((org) =>
      org.ssoDetails?.domain
        ? emailMatchesDomains(emailDomain, org.ssoDetails.domain)
        : false
    );
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to get organizations by SSO domain",
      additionalData: { emailDomain },
      label: "SSO",
    });
  }
}

export async function createOrganization({
  name,
  userId,
  image,
  currency,
}: Pick<Organization, "name" | "currency"> & {
  userId: User["id"];
  image: File | null;
}) {
  try {
    const owner = await findFirstOrThrow(db, "User", {
      where: { id: userId },
      select: "id, firstName, lastName",
    });

    // Create the organization
    const org = await create(db, "Organization", {
      name,
      currency,
      type: OrganizationType.TEAM,
      userId,
      hasSequentialIdsMigrated: true, // New organizations don't need migration
    });

    // Create related records in parallel where possible
    const categoryData = defaultUserCategories.map((c) => ({
      ...c,
      userId,
      organizationId: org.id,
    }));

    await Promise.all([
      // Create categories
      createMany(db, "Category", categoryData),

      // Create user organization
      create(db, "UserOrganization", {
        userId,
        organizationId: org.id,
        roles: [OrganizationRoles.OWNER],
      }),

      // Create team member for the owner
      create(db, "TeamMember", {
        name: `${owner.firstName} ${owner.lastName} (Owner)`,
        organizationId: org.id,
        userId: owner.id,
      }),

      // Create asset index settings
      create(db, "AssetIndexSettings", {
        mode: AssetIndexMode.ADVANCED,
        columns: defaultFields as any,
        userId,
        organizationId: org.id,
      }),

      // Create working hours
      create(db, "WorkingHours", {
        organizationId: org.id,
        enabled: false,
        weeklySchedule: getDefaultWeeklySchedule(),
      }),

      // Create booking settings
      create(db, "BookingSettings", {
        organizationId: org.id,
        bufferStartTime: 0,
      }),
    ]);

    if (image?.size && image?.size > 0) {
      await create(db, "Image", {
        blob: Buffer.from(await image.arrayBuffer()) as any,
        contentType: image.type,
        ownerOrgId: org.id,
        organizationId: org.id,
        userId,
      });
    }

    return org;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating the organization. Please try again or contact support.",
      additionalData: { name, userId },
      label,
    });
  }
}
export async function updateOrganization({
  id,
  name,
  image,
  userId,
  currency,
  ssoDetails,
  hasSequentialIdsMigrated,
  qrIdDisplayPreference,
  showShelfBranding,
  customEmailFooter,
}: Pick<Organization, "id"> & {
  currency?: Organization["currency"];
  name?: string;
  userId: User["id"];
  image?: File | null;
  ssoDetails?: {
    selfServiceGroupId: string;
    adminGroupId: string;
    baseUserGroupId: string;
  };
  hasSequentialIdsMigrated?: Organization["hasSequentialIdsMigrated"];
  qrIdDisplayPreference?: Organization["qrIdDisplayPreference"];
  showShelfBranding?: Organization["showShelfBranding"];
  customEmailFooter?: string | null;
}) {
  try {
    const data: Record<string, unknown> = {
      name,
      ...(currency && { currency }),
      ...(qrIdDisplayPreference && { qrIdDisplayPreference }),
      ...(hasSequentialIdsMigrated !== undefined && {
        hasSequentialIdsMigrated,
      }),
      ...(typeof showShelfBranding === "boolean" && {
        showShelfBranding,
      }),
      ...(customEmailFooter !== undefined && { customEmailFooter }),
    };

    // Handle ssoDetails update separately
    if (ssoDetails) {
      await update(db, "SsoDetails", {
        where: { organizationId: id },
        data: ssoDetails,
      });
    }

    if (image?.size && image?.size > 0) {
      if (image.size > DEFAULT_MAX_IMAGE_UPLOAD_SIZE) {
        throw new ShelfError({
          cause: null,
          message: `Image size exceeds maximum allowed size of ${
            DEFAULT_MAX_IMAGE_UPLOAD_SIZE / (1024 * 1024)
          }MB`,
          additionalData: { id, userId, field: "image" },
          label,
          shouldBeCaptured: false,
          status: 400,
        });
      }

      const imageData = {
        blob: Buffer.from(await image.arrayBuffer()) as any,
        contentType: image.type,
        ownerOrgId: id,
        userId,
      };

      // Check if image exists for this org, then upsert
      const existingImage = await findFirst(db, "Image", {
        where: { ownerOrgId: id },
      });

      if (existingImage) {
        await update(db, "Image", {
          where: { id: existingImage.id },
          data: imageData,
        });
      } else {
        await create(db, "Image", {
          ...imageData,
          organizationId: id,
        });
      }
    }

    return await update(db, "Organization", {
      where: { id },
      data: data as any,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while updating the organization. Please try again or contact support.",
      additionalData: { id, userId, name },
      label,
    });
  }
}

const ORGANIZATION_SELECT_FIELDS =
  "id, type, name, imageId, userId, updatedAt, currency, enabledSso, ssoDetails:SsoDetails(*), workspaceDisabled, selfServiceCanSeeCustody, selfServiceCanSeeBookings, baseUserCanSeeCustody, baseUserCanSeeBookings, barcodesEnabled, auditsEnabled, usedAuditTrial, hasSequentialIdsMigrated, qrIdDisplayPreference, showShelfBranding, customEmailFooter, owner:User!userId(id, email)";

export type OrganizationFromUser = Organization & {
  owner: { id: string; email: string };
  ssoDetails: unknown;
};

export async function getUserOrganizations({ userId }: { userId: string }) {
  try {
    return await findMany(db, "UserOrganization", {
      where: { userId },
      select: `organizationId, roles, organization:Organization(${ORGANIZATION_SELECT_FIELDS}), user:User(lastSelectedOrganizationId)`,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while fetching user organizations. Please try again or contact support.",
      additionalData: { userId },
      label,
    });
  }
}

export async function getOrganizationAdminsEmails({
  organizationId,
}: {
  organizationId: string;
}) {
  try {
    // Supabase PostgREST doesn't support hasSome for array columns directly.
    // We fetch all user orgs for this org and filter in JS.
    const userOrgs = await findMany(db, "UserOrganization", {
      where: { organizationId },
      select: "roles, user:User(email)",
    });

    const admins = (userOrgs as any[]).filter(
      (uo) =>
        uo.roles?.includes(OrganizationRoles.OWNER) ||
        uo.roles?.includes(OrganizationRoles.ADMIN)
    );

    return admins.map((a: any) => a.user.email);
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while fetching organization admins emails. Please try again or contact support.",
      additionalData: { organizationId },
      label,
    });
  }
}

export async function toggleOrganizationSso({
  organizationId,
  enabledSso,
}: {
  organizationId: string;
  enabledSso: boolean;
}) {
  try {
    return await update(db, "Organization", {
      where: { id: organizationId, type: OrganizationType.TEAM },
      data: {
        enabledSso,
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while toggling organization SSO. Please try again or contact support.",
      additionalData: { organizationId, enabledSso },
      label,
    });
  }
}

export async function toggleWorkspaceDisabled({
  organizationId,
  workspaceDisabled,
}: {
  organizationId: string;
  workspaceDisabled: boolean;
}) {
  try {
    return await update(db, "Organization", {
      where: { id: organizationId, type: OrganizationType.TEAM },
      data: {
        workspaceDisabled,
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while toggling workspace disabled. Please try again or contact support.",
      additionalData: { organizationId, workspaceDisabled },
      label,
    });
  }
}

export async function toggleBarcodeEnabled({
  organizationId,
  barcodesEnabled,
}: {
  organizationId: string;
  barcodesEnabled: boolean;
}) {
  try {
    return await update(db, "Organization", {
      where: { id: organizationId },
      data: {
        barcodesEnabled,
        barcodesEnabledAt: barcodesEnabled ? new Date().toISOString() : null,
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while toggling barcode functionality. Please try again or contact support.",
      additionalData: { organizationId, barcodesEnabled },
      label,
    });
  }
}

export async function toggleAuditEnabled({
  organizationId,
  auditsEnabled,
}: {
  organizationId: string;
  auditsEnabled: boolean;
}) {
  try {
    return await update(db, "Organization", {
      where: { id: organizationId },
      data: {
        auditsEnabled,
        auditsEnabledAt: auditsEnabled ? new Date().toISOString() : null,
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while toggling audit functionality. Please try again or contact support.",
      additionalData: { organizationId, auditsEnabled },
      label,
    });
  }
}

/**
 * Utility function to parse and validate domains from a comma-separated string
 * @param domainsString - Comma-separated string of domains
 * @returns Array of cleaned domain strings
 */
export function parseDomains(domainsString: string): string[] {
  return domainsString
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Checks if a given email matches any of the provided comma-separated domains
 * @param email - Email address to check
 * @param domainsString - Comma-separated string of domains
 * @returns boolean indicating if email matches any domain
 */
export function emailMatchesDomains(
  emailDomain: string,
  domainsString: string | null
): boolean {
  if (!emailDomain || !domainsString) return false;
  const domains = parseDomains(domainsString);
  return domains.includes(emailDomain.toLowerCase());
}

/** Permissions functions */

/**
 * Gets the permissions columns in the organization table
 * Columns:
 * - selfServiceCanSeeCustody
 * - selfServiceCanSeeBookings
 * - baseUserCanSeeCustody
 * - baseUserCanSeeBookings
 */
export function getOrganizationPermissionColumns(id: string) {
  return findUnique(db, "Organization", {
    where: { id },
    select:
      "selfServiceCanSeeCustody, selfServiceCanSeeBookings, baseUserCanSeeCustody, baseUserCanSeeBookings",
  });
}

/**
 * Updates the permissions columns in the organization table
 * Updated columns:
 * - selfServiceCanSeeCustody
 * - selfServiceCanSeeBookings
 * - baseUserCanSeeCustody
 * - baseUserCanSeeBookings
 */
export function updateOrganizationPermissions({
  id,
  configuration,
}: {
  id: string;
  configuration: Pick<
    Organization,
    | "selfServiceCanSeeCustody"
    | "selfServiceCanSeeBookings"
    | "baseUserCanSeeCustody"
    | "baseUserCanSeeBookings"
  >;
}) {
  return update(db, "Organization", {
    where: { id },
    data: {
      ...configuration,
    },
  });
}

export async function getOrganizationAdmins({
  organizationId,
}: {
  organizationId: Organization["id"];
}) {
  try {
    /** Get all the admins in current organization */
    const userOrgs = await findMany(db, "UserOrganization", {
      where: { organizationId },
      select: "roles, user:User(id, firstName, lastName, email)",
    });

    const admins = (userOrgs as any[]).filter((uo) =>
      uo.roles?.includes(OrganizationRoles.ADMIN)
    );

    return admins.map((a: any) => a.user);
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching organization admins.",
      label,
    });
  }
}

export async function transferOwnership({
  currentOrganization,
  newOwnerId,
  userId,
  transferSubscription = false,
}: {
  currentOrganization: Pick<Organization, "id" | "name" | "type">;
  newOwnerId: User["id"];
  userId: User["id"];
  /** Whether to transfer the owner's subscription to the new owner */
  transferSubscription?: boolean;
}) {
  try {
    if (currentOrganization.type === OrganizationType.PERSONAL) {
      throw new ShelfError({
        cause: null,
        message: "Personal workspaces cannot be transferred.",
        label,
      });
    }

    let user: any;
    try {
      user = await findUniqueOrThrow(db, "User", {
        where: { id: userId },
        select: "id, roles:Role(name)",
      });
    } catch (cause) {
      throw new ShelfError({
        cause,
        message: "Something went wrong while fetching current user.",
        label,
      });
    }

    const isCurrentUserShelfAdmin = (user.roles as any[]).some(
      (role: any) => role.name === Roles.ADMIN
    );

    /**
     * To transfer ownership, we need to:
     * 1. Update the owner of the organization
     * 2. Update the role of both users in the current organization
     * 3. Optionally transfer the subscription
     */
    const userOrganization = await findMany(db, "UserOrganization", {
      where: {
        organizationId: currentOrganization.id,
      },
      select:
        "id, roles, user:User(id, firstName, lastName, email, customerId, tierId, usedFreeTrial, roles:Role(name))",
    });

    // Filter to get the new owner and the current owner
    const relevantUserOrgs = (userOrganization as any[]).filter(
      (uo) =>
        uo.user?.id === newOwnerId ||
        uo.roles?.includes(OrganizationRoles.OWNER)
    );

    const currentOwnerUserOrg = relevantUserOrgs.find((userOrg: any) =>
      userOrg.roles.includes(OrganizationRoles.OWNER)
    );
    /** Validate if the current user is a member of the organization */
    if (!currentOwnerUserOrg) {
      throw new ShelfError({
        cause: null,
        message: "Current user is not a member of the organization.",
        label,
      });
    }

    /**
     * Validate if the current user is the owner of organization
     * or is a Shelf admin
     */
    if (
      !currentOwnerUserOrg.roles.includes(OrganizationRoles.OWNER) &&
      !isCurrentUserShelfAdmin
    ) {
      throw new ShelfError({
        cause: null,
        message: "Current user is not the owner of the organization.",
        label,
      });
    }

    const newOwnerUserOrg = relevantUserOrgs.find(
      (userOrg: any) => userOrg.user.id === newOwnerId
    );
    if (!newOwnerUserOrg) {
      throw new ShelfError({
        cause: null,
        message: "New owner is not a member of the organization.",
        label,
      });
    }

    /** Validate if the new owner is ADMIN in the current organization */
    if (!newOwnerUserOrg.roles.includes(OrganizationRoles.ADMIN)) {
      throw new ShelfError({
        cause: null,
        message: "New owner is not an admin of the organization.",
        label,
      });
    }

    // Check if new owner already has an active subscription (BLOCK transfer)
    // This applies regardless of whether subscription transfer is requested,
    // as we don't want two owners with separate active subscriptions
    if (premiumIsEnabled) {
      const newOwnerActiveSubscription =
        await getUserActiveSubscription(newOwnerId);
      if (newOwnerActiveSubscription) {
        throw new ShelfError({
          cause: null,
          message:
            "Cannot transfer ownership to a user who already has an active subscription.",
          label,
        });
      }
    }

    // Track subscription transfer info for emails
    let subscriptionTransferred = false;
    const currentOwnerTierId: TierId = currentOwnerUserOrg.user.tierId;

    // Use RPC for atomic ownership transfer
    await rpc(db, "transfer_org_ownership", {
      p_organization_id: currentOrganization.id,
      p_new_owner_user_id: newOwnerUserOrg.user.id,
      p_current_owner_user_org_id: currentOwnerUserOrg.id,
      p_new_owner_user_org_id: newOwnerUserOrg.id,
    });

    // Handle subscription transfer AFTER the ownership transfer succeeds
    // Wrapped in try/catch to ensure ownership transfer completes even if subscription transfer fails
    let subscriptionTransferError: Error | null = null;
    if (premiumIsEnabled && transferSubscription) {
      try {
        const activeSubscriptions = await getUserActiveSubscriptions(
          currentOwnerUserOrg.user.id
        );

        // Filter to subscriptions relevant to this workspace:
        // - Tier subscriptions (always relevant)
        // - Addon subscriptions linked to THIS workspace
        const relevantSubscriptions = filterRelevantSubscriptions(
          activeSubscriptions,
          currentOrganization.id
        );

        if (relevantSubscriptions.length > 0) {
          // Ensure new owner has a Stripe customer ID (only once)
          let newOwnerCustomerId: string | null | undefined =
            newOwnerUserOrg.user.customerId;
          if (!newOwnerCustomerId) {
            newOwnerCustomerId = await createStripeCustomer({
              email: newOwnerUserOrg.user.email,
              name: `${newOwnerUserOrg.user.firstName} ${newOwnerUserOrg.user.lastName}`,
              userId: newOwnerId,
            });
          }

          if (newOwnerCustomerId) {
            // Transfer each relevant subscription
            for (const sub of relevantSubscriptions) {
              await transferSubscriptionToCustomer({
                subscriptionId: sub.id,
                newCustomerId: newOwnerCustomerId,
              });
            }

            // Update tier if a tier subscription was transferred
            const hasTierSubscription = relevantSubscriptions.some((sub) =>
              isTierSubscription(sub)
            );
            if (hasTierSubscription) {
              await updateUserTierId(newOwnerId, currentOwnerTierId);
              await updateUserTierId(currentOwnerUserOrg.user.id, "free");
            }

            subscriptionTransferred = true;

            // Transfer usedFreeTrial flag if original owner used it
            // This prevents the new owner from starting another trial
            if (currentOwnerUserOrg.user.usedFreeTrial) {
              await update(db, "User", {
                where: { id: newOwnerId },
                data: { usedFreeTrial: true },
              });
            }

            // Check if new owner has a payment method on their Stripe customer
            // If not, set the warning flag so they see the banner
            const hasPaymentMethod =
              await customerHasPaymentMethod(newOwnerCustomerId);
            if (!hasPaymentMethod) {
              await update(db, "User", {
                where: { id: newOwnerId },
                data: { warnForNoPaymentMethod: true },
              });
            }
          }
        }
      } catch (error) {
        // Capture the error but don't throw - ownership transfer should still succeed
        subscriptionTransferError = error as Error;
      }
    }

    /** Send email to new owner */
    sendEmail({
      subject: `🎉 You're now the Owner of ${currentOrganization.name} - Shelf`,
      to: newOwnerUserOrg.user.email,
      text: newOwnerEmailText({
        newOwnerName: `${newOwnerUserOrg.user.firstName} ${newOwnerUserOrg.user.lastName}`,
        workspaceName: currentOrganization.name,
        subscriptionTransferred,
      }),
    });

    /** Send email to previous owner */
    sendEmail({
      subject: `🔁 You've Transferred Ownership of ${currentOrganization.name}`,
      to: currentOwnerUserOrg.user.email,
      text: previousOwnerEmailText({
        previousOwnerName: `${currentOwnerUserOrg.user.firstName} ${currentOwnerUserOrg.user.lastName}`,
        newOwnerName: `${newOwnerUserOrg.user.firstName} ${newOwnerUserOrg.user.lastName}`,
        workspaceName: currentOrganization.name,
        subscriptionTransferred,
      }),
    });

    /** Send admin notification */
    if (ADMIN_EMAIL) {
      const subscriptionStatus = subscriptionTransferError
        ? `Failed - ${subscriptionTransferError.message}`
        : subscriptionTransferred
          ? "Yes"
          : "No (not requested)";

      sendEmail({
        subject: subscriptionTransferError
          ? `⚠️ Workspace transferred with errors: ${currentOrganization.name}`
          : `Workspace transferred: ${currentOrganization.name}`,
        to: ADMIN_EMAIL,
        text: `A workspace ownership transfer has occurred.

Workspace: ${currentOrganization.name}
Workspace ID: ${currentOrganization.id}

Previous Owner: ${currentOwnerUserOrg.user.firstName} ${
          currentOwnerUserOrg.user.lastName
        } (${currentOwnerUserOrg.user.email})
New Owner: ${newOwnerUserOrg.user.firstName} ${
          newOwnerUserOrg.user.lastName
        } (${newOwnerUserOrg.user.email})

Subscription transferred: ${subscriptionStatus}
${
  subscriptionTransferError
    ? `\nError details: ${
        subscriptionTransferError.stack || subscriptionTransferError.message
      }`
    : ""
}`,
      });
    }

    return {
      newOwner: newOwnerUserOrg.user,
      subscriptionTransferred,
      subscriptionTransferError: subscriptionTransferError?.message,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while transferring ownership. Please try again or contact support.",
      additionalData: { currentOrganization, newOwnerId },
      label,
    });
  }
}

/**
 * Resets showShelfBranding to true for all personal workspaces owned by a user.
 * Called when Plus user downgrades to free tier.
 *
 * @param userId - The ID of the user whose personal workspaces should be reset
 * @returns Promise resolving to the update result
 */
export async function resetPersonalWorkspaceBranding(userId: User["id"]) {
  try {
    return await updateMany(db, "Organization", {
      where: {
        userId,
        type: OrganizationType.PERSONAL,
      },
      data: {
        showShelfBranding: true,
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while resetting personal workspace branding.",
      additionalData: { userId },
      label,
    });
  }
}

/**
 * Checks if a Stripe subscription is a tier subscription
 * by looking at its line-item product metadata.
 */
function isTierSubscription(sub: Stripe.Subscription): boolean {
  return sub.items.data.some((item) => {
    const product = item.price?.product;
    if (typeof product === "object" && product && "metadata" in product) {
      return !!(product as Stripe.Product).metadata?.shelf_tier;
    }
    return false;
  });
}

/**
 * Checks if a Stripe subscription is an addon linked to a specific workspace.
 */
function isAddonForOrganization(
  sub: Stripe.Subscription,
  organizationId: string
): boolean {
  const subOrgId = sub.metadata?.organizationId;
  if (subOrgId !== organizationId) return false;

  return sub.items.data.some((item) => {
    const product = item.price?.product;
    if (typeof product === "object" && product && "metadata" in product) {
      return (product as Stripe.Product).metadata?.product_type === "addon";
    }
    return false;
  });
}

/**
 * Filters subscriptions to those relevant to a workspace transfer:
 * - Tier subscriptions (always relevant)
 * - Addon subscriptions linked to the specific workspace
 */
function filterRelevantSubscriptions(
  subscriptions: Stripe.Subscription[],
  organizationId: string
): Stripe.Subscription[] {
  return subscriptions.filter(
    (sub) =>
      isTierSubscription(sub) || isAddonForOrganization(sub, organizationId)
  );
}
