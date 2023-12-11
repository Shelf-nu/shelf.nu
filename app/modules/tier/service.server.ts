import type { Organization, User } from "@prisma/client";
import { db } from "~/database";
import { ShelfStackError } from "~/utils/error";
import { isPersonalOrg } from "~/utils/organization";
import {
  canCreateMoreCustomFields,
  canCreateMoreOrganizations,
  canExportAssets,
  canImportAssets,
} from "~/utils/subscription";
import { countAcviteCustomFields } from "../custom-field";
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
  userId,
  organizationId,
}: {
  userId: User["id"];
  organizationId: Organization["id"];
}) {
  const user = await db.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      tier: {
        include: { tierLimit: true },
      },
      organizations: {
        select: {
          id: true,
          type: true,
        },
      },
    },
  });
  const currentOrg = user?.organizations.find((o) => o.id === organizationId);
  //to have a team org you need subscription hence we only assert for personal org for now
  if (currentOrg?.type !== "TEAM" && !canImportAssets(user?.tier?.tierLimit)) {
    throw new Error("Your user cannot import assets");
  }
  return { user };
}

export async function assertUserCanExportAssets({
  userId,
}: {
  userId: User["id"];
}) {
  /** Get the tier limit and check if they can export */
  const tierLimit = await getUserTierLimit(userId);

  if (!canExportAssets(tierLimit)) {
    throw new Error("Your user cannot export assets");
  }
}

export const assertUserCanCreateMoreCustomFields = async ({
  userId,
  organizationId,
}: {
  userId: User["id"];
  organizationId: Organization["id"];
}) => {
  /** Get the tier limit and check if they can export */
  const tierLimit = await getUserTierLimit(userId);

  const totalActiveCustomFields = await countAcviteCustomFields({
    organizationId,
  });

  const canCreateMore = canCreateMoreCustomFields({
    tierLimit,
    totalCustomFields: totalActiveCustomFields,
  });

  if (!canCreateMore) {
    throw new Error("Your user cannot create more custom fields");
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
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      type: true,
    },
  });

  if (!org) {
    throw new ShelfStackError({ message: "Organization not found" });
  }

  if (isPersonalOrg(org)) {
    throw new ShelfStackError({
      message:
        "You cannot invite other users to a personal workspace. Please create a Team workspace.",
    });
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
    throw new ShelfStackError({
      message: "You cannot create workspaces with your current plan.",
    });
  }
  return true;
};
