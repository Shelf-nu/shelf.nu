import { OrganizationType, type Organization } from "@prisma/client";
import { config } from "~/config/shelf.config";
import { db } from "~/database/db.server";
import { countActiveCustomFields } from "~/modules/custom-field/service.server";
import {
  getOrganizationTierLimit,
  getUserTierLimit,
} from "~/modules/tier/service.server";
import { getUserByID } from "~/modules/user/service.server";
import type { ErrorLabel } from "./error";
import { ShelfError } from "./error";
import { isPersonalOrg } from "./organization";

const label: ErrorLabel = "Tier";
export const premiumIsEnabled = config.enablePremiumFeatures;

/**
 * Utilities for checking weather the user can perform certain premium actions.
 * We have 2 types:
 * - Functions that return a boolean
 * - Functions that throw an error if the user cannot perform the action. Those functions are named `assertUserCan...`
 *
 * */

/** Export */
export const canExportAssets = (
  tierLimit: { canExportAssets: boolean } | null | undefined
) => {
  /** If the premium features are not enabled, just return true */
  if (!premiumIsEnabled) return true;
  if (tierLimit?.canExportAssets === null) return false;
  return tierLimit?.canExportAssets || false;
};

export async function assertUserCanExportAssets({
  organizationId,
  organizations,
}: {
  organizationId: Organization["id"];
  organizations: {
    id: string;
    type: OrganizationType;
    name: string;
    imageId: string | null;
    userId: string;
  }[];
}) {
  /* Check the tier limit */
  const tierLimit = await getOrganizationTierLimit({
    organizationId,
    organizations,
  });

  if (!canExportAssets(tierLimit)) {
    throw new ShelfError({
      cause: null,
      title: "Not allowed",
      message:
        "Your user cannot export assets. Please update your subscription to unlock this feature.",
      additionalData: { organizationId },
      label,
    });
  }
}

/** End Export */

/** Import */
/** Important:
 * For this to work properly it needs to receive the tierLimit of the organization owner not the current user
 * This is because the owner is the one that has the premium package attached to their account
 */
export const canImportAssets = (
  tierLimit: { canImportAssets: boolean } | null | undefined
) => {
  /** If the premium features are not enabled, just return true */
  if (!premiumIsEnabled) return true;
  if (!tierLimit?.canImportAssets) return false;
  return tierLimit?.canImportAssets;
};

export async function assertUserCanImportAssets({
  organizationId,
  organizations,
}: {
  organizationId: Organization["id"];
  organizations: {
    id: string;
    type: OrganizationType;
    name: string;
    imageId: string | null;
    userId: string;
  }[];
}) {
  const tierLimit = await getOrganizationTierLimit({
    organizationId,
    organizations,
  });

  if (!canImportAssets(tierLimit)) {
    throw new ShelfError({
      cause: null,
      title: "Not allowed",
      message: "You are not allowed to import assets",
      additionalData: { organizationId },
      label,
    });
  }
}

export const canImportNRM = (
  tierLimit: { canImportNRM: boolean } | null | undefined
) => {
  /** If the premium features are not enabled, just return true */
  if (!premiumIsEnabled) return true;
  if (!tierLimit?.canImportNRM) return false;
  return tierLimit?.canImportNRM;
};

export async function assertUserCanImportNRM({
  organizationId,
  organizations,
}: {
  organizationId: Organization["id"];
  organizations: {
    id: string;
    type: OrganizationType;
    name: string;
    imageId: string | null;
    userId: string;
  }[];
}) {
  const tierLimit = await getOrganizationTierLimit({
    organizationId,
    organizations,
  });

  if (!canImportNRM(tierLimit)) {
    throw new ShelfError({
      cause: null,
      title: "Not allowed",
      message:
        "You are not allowed to import Non-registered members due to your current plan. Please upgrade to unlock this feature.",
      additionalData: { organizationId },
      label,
      shouldBeCaptured: false,
    });
  }
}

/** End Import */

/** Custom Fields */
export const canCreateMoreCustomFields = ({
  tierLimit,
  totalCustomFields,
}: {
  tierLimit: { maxCustomFields: number } | null | undefined;
  totalCustomFields: number;
}) => {
  if (!premiumIsEnabled) return true;
  if (!tierLimit?.maxCustomFields) return false;

  return totalCustomFields < tierLimit?.maxCustomFields;
};

export const assertUserCanCreateMoreCustomFields = async ({
  organizationId,
  organizations,
}: {
  organizationId: Organization["id"];
  organizations: {
    id: string;
    type: OrganizationType;
    name: string;
    imageId: string | null;
    userId: string;
  }[];
}) => {
  const [tierLimit, totalActiveCustomFields] = await Promise.all([
    getOrganizationTierLimit({ organizationId, organizations }),
    countActiveCustomFields({ organizationId }),
  ]);

  const canCreateMore = canCreateMoreCustomFields({
    tierLimit,
    totalCustomFields: totalActiveCustomFields,
  });

  if (!canCreateMore) {
    throw new ShelfError({
      cause: null,
      title: "Not allowed",
      message:
        "You have reached your limit of active custom fields. Please upgrade your plan to add more.",
      additionalData: { organizationId },
      label,
      shouldBeCaptured: false,
    });
  }
};

/**
 * This function checks if the new activating custom fields will exceed the allowed limit or not
 */
export function willExceedCustomFieldLimit({
  tierLimit,
  currentCustomFields,
  newActivatingFields,
}: {
  tierLimit: { maxCustomFields: number } | null | undefined;
  currentCustomFields: number;
  newActivatingFields: number;
}) {
  if (!premiumIsEnabled) {
    return false;
  }

  if (!tierLimit?.maxCustomFields) {
    return true;
  }

  return currentCustomFields + newActivatingFields > tierLimit.maxCustomFields;
}

export async function assertWillExceedCustomFieldLimit({
  organizationId,
  organizations,
  newActivatingFields,
}: {
  organizationId: Organization["id"];
  organizations: {
    id: string;
    type: OrganizationType;
    name: string;
    imageId: string | null;
    userId: string;
  }[];
  newActivatingFields: number;
}) {
  const [tierLimit, totalActiveCustomFields] = await Promise.all([
    getOrganizationTierLimit({ organizationId, organizations }),
    countActiveCustomFields({ organizationId }),
  ]);

  const willExceedLimit = willExceedCustomFieldLimit({
    tierLimit,
    currentCustomFields: totalActiveCustomFields,
    newActivatingFields,
  });

  if (willExceedLimit) {
    throw new ShelfError({
      cause: null,
      message: `Activating these fields will exceed your allowed limit(${tierLimit.maxCustomFields}) of active custom fields . Try selecting a smaller number or fields or upgrade your plan to activate more.`,
      shouldBeCaptured: false,
      label: "Custom fields",
    });
  }
}
/** End Custom Fields */

/** Organizations */
export const canCreateMoreOrganizations = ({
  tierLimit,
  totalOrganizations,
}: {
  tierLimit: { maxOrganizations: number } | null | undefined;
  totalOrganizations: number;
}) => {
  if (!premiumIsEnabled) return true;
  if (!tierLimit?.maxOrganizations) return false;

  return totalOrganizations < tierLimit?.maxOrganizations;
};
/**
 * Fetches user and calls {@link canCreateMoreOrganizations};.
 * Throws an error if the user cannot create more organizations.
 */
export async function assertUserCanCreateMoreOrganizations(userId: string) {
  const [user, tierLimit] = await Promise.all([
    await getUserByID(userId, {
      select: {
        id: true,
        userOrganizations: {
          include: {
            organization: {
              select: {
                userId: true,
              },
            },
          },
        },
      },
    }),
    getUserTierLimit(userId),
  ]);

  const organizations = user.userOrganizations
    .map((o) => o.organization)
    .filter((o) => o.userId === userId);

  if (
    !canCreateMoreOrganizations({
      tierLimit: tierLimit,
      totalOrganizations: organizations.length || 1,
    })
  ) {
    throw new ShelfError({
      cause: null,
      title: "Not allowed",
      message: "You cannot create more workspaces with your current plan.",
      additionalData: { userId, tierLimit },
      label,
      shouldBeCaptured: false,
    });
  }
}
/** End Organizations */

/** Team Features */
export const canUseBookings = (
  currentOrganization: Pick<Organization, "type">
) => {
  if (!premiumIsEnabled) return true;

  if (currentOrganization.type !== OrganizationType.TEAM) return false;

  return true;
};

/**
 * This function checks if the user can use bookings in the current organization
 * It simply checks the organization type
 *
 * Throws error of not allowed
 */
export function assertCanUseBookings(
  currentOrganization: Pick<Organization, "type">
) {
  if (!canUseBookings(currentOrganization)) {
    throw new ShelfError({
      cause: null,
      title: "Not allowed",
      message:
        "You cannot use bookings in a personal workspace. Please create a Team workspace.",
      status: 403,
      label,
      shouldBeCaptured: false,
    });
  }
}

/**
 * This validates if more users can be invited to organization
 * It simply checks the organization type
 */
export async function assertUserCanInviteUsersToWorkspace({
  organizationId,
}: {
  organizationId: Organization["id"];
}) {
  /** Get the tier limit and check if they can export */
  // const tierLimit = await getUserTierLimit(userId);
  const org = await db.organization
    .findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        type: true,
      },
    })
    .catch((cause) => {
      throw new ShelfError({
        cause,
        message: "Failed to get organization",
        additionalData: { organizationId },
        label,
      });
    });

  if (isPersonalOrg(org)) {
    throw new ShelfError({
      cause: null,
      title: "Not allowed",
      message:
        "You cannot invite other users to a personal workspace. Please create a Team workspace.",
      status: 403,
      label,
      shouldBeCaptured: false,
    });
  }
}
/** End Team Features */
