import type { Organization, OrganizationType, User } from "@prisma/client";
import { db } from "~/database";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import { isPersonalOrg } from "~/utils/organization";
import {
  canCreateMoreCustomFields,
  canCreateMoreOrganizations,
  canExportAssets,
  canImportAssets,
} from "~/utils/subscription";
import { countActiveCustomFields } from "../custom-field";

const label: ErrorLabel = "Tier";

async function getUserTierLimit(id: User["id"]) {
  try {
    const { tier } = await db.user.findUniqueOrThrow({
      where: { id },
      select: {
        tier: {
          include: { tierLimit: true },
        },
      },
    });

    return tier.tierLimit;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching user tier limit",
      additionalData: { userId: id },
      label,
    });
  }
}

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
      message: "Your user cannot export assets",
      additionalData: { organizationId },
      label,
    });
  }
}

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
  const tierLimit = await getOrganizationTierLimit({
    organizationId,
    organizations,
  });

  const totalActiveCustomFields = await countActiveCustomFields({
    organizationId,
  });

  const canCreateMore = canCreateMoreCustomFields({
    tierLimit,
    totalCustomFields: totalActiveCustomFields,
  });

  if (!canCreateMore) {
    throw new ShelfError({
      cause: null,
      title: "Not allowed",
      message: "Your user cannot create more custom fields",
      additionalData: { organizationId },
      label,
      shouldBeCaptured: false,
    });
  }
};

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
    .findUnique({
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

  if (!org) {
    throw new ShelfError({
      cause: null,
      message: "Organization not found",
      additionalData: { organizationId },
      label,
    });
  }

  if (isPersonalOrg(org)) {
    throw new ShelfError({
      cause: null,
      title: "Not allowed",
      message:
        "You cannot invite other users to a personal workspace. Please create a Team workspace.",
      status: 403,
      label,
    });
  }
}

/**
 * Fetches user and calls {@link canCreateMoreOrganizations};.
 * Throws an error if the user cannot create more organizations.
 */
export async function assertUserCanCreateMoreOrganizations(userId: string) {
  const user = await db.user
    .findUnique({
      where: {
        id: userId,
      },
      include: {
        tier: {
          include: { tierLimit: true },
        },
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
    })
    .catch((cause) => {
      throw new ShelfError({
        cause,
        message: "Failed to get user",
        additionalData: { userId },
        label,
      });
    });

  if (!user) {
    throw new ShelfError({
      cause: null,
      message: "User not found",
      additionalData: { userId },
      label,
    });
  }

  const organizations = user.userOrganizations
    .map((o) => o.organization)
    .filter((o) => o.userId === userId);

  if (
    !canCreateMoreOrganizations({
      tierLimit: user.tier.tierLimit,
      totalOrganizations: organizations.length || 1,
    })
  ) {
    throw new ShelfError({
      cause: null,
      title: "Not allowed",
      message: "You cannot create workspaces with your current plan.",
      additionalData: { userId, tierLimit: user.tier.tierLimit },
      label,
    });
  }
}

/**
 * @returns The tier limit of the organization's owner
 * This is needed as the tier is based on the organization rather than the current user
 */
export async function getOrganizationTierLimit({
  organizationId,
  organizations,
}: {
  organizationId?: string;
  organizations: {
    id: string;
    type: OrganizationType;
    name: string;
    imageId: string | null;
    userId: string;
  }[];
}) {
  try {
    /** Find the current organization as we need the owner */
    const currentOrganization = organizations.find(
      (org) => org.id === organizationId
    );
    /** We get the owner ID so we can check if the organization has permissions for importing */
    const ownerId = currentOrganization?.userId as string;

    /** Get the tier limit and check if they can export */
    return await getUserTierLimit(ownerId);
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching organization tier limit",
      additionalData: { organizationId },
      label,
    });
  }
}
