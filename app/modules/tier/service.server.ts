import type { Organization, OrganizationType, User } from "@prisma/client";
import { json } from "@remix-run/node";
import { db } from "~/database";
import { error } from "~/utils";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError, makeShelfError } from "~/utils/error";
import { isPersonalOrg } from "~/utils/organization";
import {
  canCreateMoreCustomFields,
  canCreateMoreOrganizations,
  canExportAssets,
  canImportAssets,
} from "~/utils/subscription";
import { countAcviteCustomFields } from "../custom-field";

const label: ErrorLabel = "Tier";

export async function getUserTierLimit(id: User["id"]) {
  try {
    const { tier } = await db.user.findUniqueOrThrow({
      where: { id },
      select: {
        tier: {
          include: { tierLimit: true },
        },
      },
    });

    return tier?.tierLimit;
  } catch (cause) {
    throw new Error("Something went wrong while fetching user tier limit");
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
  /* Check the tier limit */
  const tierLimit = await getOrganizationTierLimit({
    organizationId,
    organizations,
  });

  if (!canImportAssets(tierLimit)) {
    throw new Error("Your user cannot import assets");
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
    throw new Error("Your user cannot export assets");
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
  const totalActiveCustomFields = await countAcviteCustomFields({
    organizationId,
  });

  const canCreateMore = canCreateMoreCustomFields({
    tierLimit,
    totalCustomFields: totalActiveCustomFields,
  });

  if (!canCreateMore) {
    throw new ShelfError({
      cause: null,
      message: "Your user cannot create more custom fields",
      label,
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
  try {
    /** Get the tier limit and check if they can export */
    // const tierLimit = await getUserTierLimit(userId);
    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: {
        type: true,
      },
    });

    if (!org) {
      // @TODO Solve error
      throw new ShelfError({
        cause: null,
        message: "Organization not found",
        label,
      });
    }

    if (isPersonalOrg(org)) {
      // @TODO Solve error
      throw new ShelfError({
        cause: null,
        title: "Cannot invite users",
        message:
          "You cannot invite other users to a personal workspace. Please create a Team workspace.",
        status: 403,
        label,
      });
    }
    return true;
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason), { status: reason.status });
  }
}

/**
 * Fetches user and calls {@link canCreateMoreOrganizations};.
 * Throws an error if the user cannot create more organizations.
 */
export const assertUserCanCreateMoreOrganizations = async (userId: string) => {
  const user = await db.user.findUnique({
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
  });

  const organizations = user?.userOrganizations
    .map((o) => o.organization)
    .filter((o) => o.userId === userId);

  if (
    !canCreateMoreOrganizations({
      tierLimit: user?.tier?.tierLimit,
      totalOrganizations: organizations?.length || 1,
    })
  ) {
    throw new ShelfError({
      cause: null,
      message: "You cannot create workspaces with your current plan.",
      label,
    });
  }
  return true;
};

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
  /** Find the current organization as we need the owner */
  const currentOrganization = organizations.find(
    (org) => org.id === organizationId
  );
  /** We get the owner ID so we can check if the organization has permissions for importing */
  const ownerId = currentOrganization?.userId as string;

  /** Get the tier limit and check if they can export */
  return await getUserTierLimit(ownerId);
}
