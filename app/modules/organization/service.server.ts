import { OrganizationRoles, OrganizationType, Roles } from "@prisma/client";
import type { Organization, Prisma, User } from "@prisma/client";

import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { DEFAULT_MAX_IMAGE_UPLOAD_SIZE } from "~/utils/constants";
import type { ErrorLabel } from "~/utils/error";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { newOwnerEmailText, previousOwnerEmailText } from "./email";
import { defaultFields } from "../asset-index-settings/helpers";
import { defaultUserCategories } from "../category/default-categories";
import { getDefaultWeeklySchedule } from "../working-hours/service.server";

const label: ErrorLabel = "Organization";

export async function getOrganizationById<T extends Prisma.OrganizationInclude>(
  id: Organization["id"],
  extraIncludes?: T
) {
  try {
    return (await db.organization.findUniqueOrThrow({
      where: { id },
      include: extraIncludes,
    })) as Prisma.OrganizationGetPayload<{ include: T }>;
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
    return await db.organization.findFirstOrThrow({
      where: {
        owner: {
          is: {
            id: userId,
          },
        },
        type: orgType,
      },
      select: {
        id: true,
        name: true,
        type: true,
        currency: true,
      },
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

    // Query for organizations where the domain field contains the email domain
    const organizations = await db.organization.findMany({
      where: {
        ssoDetails: {
          isNot: null,
        },
        AND: [
          {
            ssoDetails: {
              domain: {
                contains: emailDomain,
              },
            },
          },
        ],
      },
      include: {
        ssoDetails: true,
      },
    });

    // Filter to ensure exact domain matches
    return organizations.filter((org) =>
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
    const owner = await db.user.findFirstOrThrow({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
      },
    });

    const data = {
      name,
      currency,
      type: OrganizationType.TEAM,
      hasSequentialIdsMigrated: true, // New organizations don't need migration
      categories: {
        create: defaultUserCategories.map((c) => ({ ...c, userId })),
      },
      userOrganizations: {
        create: {
          userId,
          roles: [OrganizationRoles.OWNER],
        },
      },
      owner: {
        connect: {
          id: userId,
        },
      },
      /**
       * Creating a teamMember when a new organization/workspace is created
       * so that the owner appear in the list by default
       */
      members: {
        create: {
          name: `${owner.firstName} ${owner.lastName} (Owner)`,
          user: { connect: { id: owner.id } },
        },
      },

      assetIndexSettings: {
        create: {
          mode: "SIMPLE",
          columns: defaultFields,
          user: {
            connect: {
              id: userId,
            },
          },
        },
      },

      workingHours: {
        create: {
          enabled: false,
          weeklySchedule: getDefaultWeeklySchedule(),
        },
      },

      bookingSettings: {
        create: {
          bufferStartTime: 0,
        },
      },
    } satisfies Prisma.OrganizationCreateInput;

    const org = await db.organization.create({ data });

    if (image?.size && image?.size > 0) {
      await db.image.create({
        data: {
          blob: Buffer.from(await image.arrayBuffer()),
          contentType: image.type,
          ownerOrg: {
            connect: {
              id: org.id,
            },
          },
          organization: {
            connect: {
              id: org.id,
            },
          },
          user: {
            connect: {
              id: userId,
            },
          },
        },
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
}) {
  try {
    const data = {
      name,
      ...(currency && { currency }),
      ...(qrIdDisplayPreference && { qrIdDisplayPreference }),
      ...(hasSequentialIdsMigrated !== undefined && {
        hasSequentialIdsMigrated,
      }),
      ...(typeof showShelfBranding === "boolean" && {
        showShelfBranding,
      }),
      ...(ssoDetails && {
        ssoDetails: {
          update: ssoDetails,
        },
      }),
    };

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
        blob: Buffer.from(await image.arrayBuffer()),
        contentType: image.type,
        ownerOrg: {
          connect: {
            id: id,
          },
        },
        user: {
          connect: {
            id: userId,
          },
        },
      };

      Object.assign(data, {
        image: {
          upsert: {
            create: imageData,
            update: imageData,
          },
        },
      });
    }

    return await db.organization.update({
      where: { id },
      data: data,
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

const ORGANIZATION_SELECT_FIELDS = {
  id: true,
  type: true,
  name: true,
  imageId: true,
  userId: true,
  updatedAt: true,
  currency: true,
  enabledSso: true,
  owner: {
    select: {
      id: true,
      email: true,
    },
  },
  ssoDetails: true,
  workspaceDisabled: true,
  selfServiceCanSeeCustody: true,
  selfServiceCanSeeBookings: true,
  baseUserCanSeeCustody: true,
  baseUserCanSeeBookings: true,
  barcodesEnabled: true,
  hasSequentialIdsMigrated: true,
  qrIdDisplayPreference: true,
  showShelfBranding: true,
};

export type OrganizationFromUser = Prisma.OrganizationGetPayload<{
  select: typeof ORGANIZATION_SELECT_FIELDS;
}>;

export async function getUserOrganizations({ userId }: { userId: string }) {
  try {
    return await db.userOrganization.findMany({
      where: { userId },
      select: {
        organizationId: true,
        roles: true,
        organization: {
          select: ORGANIZATION_SELECT_FIELDS,
        },
      },
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
    const admins = await db.userOrganization.findMany({
      where: {
        organizationId,
        roles: {
          hasSome: [OrganizationRoles.OWNER, OrganizationRoles.ADMIN],
        },
      },
      select: {
        user: {
          select: {
            email: true,
          },
        },
      },
    });

    return admins.map((a) => a.user.email);
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
    return await db.organization.update({
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
    return await db.organization.update({
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
    return await db.organization.update({
      where: { id: organizationId, type: OrganizationType.TEAM },
      data: {
        barcodesEnabled,
        barcodesEnabledAt: barcodesEnabled ? new Date() : null,
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
  return db.organization.findUnique({
    where: { id },
    select: {
      selfServiceCanSeeCustody: true,
      selfServiceCanSeeBookings: true,
      baseUserCanSeeCustody: true,
      baseUserCanSeeBookings: true,
    },
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
  return db.organization.update({
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
    const admins = await db.userOrganization.findMany({
      where: { organizationId, roles: { has: OrganizationRoles.ADMIN } },
      select: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    return admins.map((a) => a.user);
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
}: {
  currentOrganization: Pick<Organization, "id" | "name" | "type">;
  newOwnerId: User["id"];
  userId: User["id"];
}) {
  try {
    if (currentOrganization.type === OrganizationType.PERSONAL) {
      throw new ShelfError({
        cause: null,
        message: "Personal workspaces cannot be transferred.",
        label,
      });
    }

    const user = await db.user
      .findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, roles: true },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Something went wrong while fetching current user.",
          label,
        });
      });

    const isCurrentUserShelfAdmin = user.roles.some(
      (role) => role.name === Roles.ADMIN
    );

    /**
     * To transfer ownership, we need to:
     * 1. Update the owner of the organization
     * 2. Update the role of both users in the current organization
     */
    const userOrganization = await db.userOrganization.findMany({
      where: {
        organizationId: currentOrganization.id,
        OR: [
          { userId: newOwnerId },
          { roles: { has: OrganizationRoles.OWNER } },
        ],
      },
      select: {
        id: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            roles: true,
          },
        },
        roles: true,
      },
    });

    const currentOwnerUserOrg = userOrganization.find((userOrg) =>
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

    const newOwnerUserOrg = userOrganization.find(
      (userOrg) => userOrg.user.id === newOwnerId
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

    await db.$transaction(async (tx) => {
      /** Update the owner of the organization */
      await tx.organization.update({
        where: { id: currentOrganization.id },
        data: {
          owner: { connect: { id: newOwnerUserOrg.user.id } },
        },
      });

      /** Update the role of current owner to ADMIN */
      await tx.userOrganization.update({
        where: { id: currentOwnerUserOrg.id },
        data: { roles: { set: [OrganizationRoles.ADMIN] } },
      });

      /** Update the role of new owner to OWNER */
      await tx.userOrganization.update({
        where: { id: newOwnerUserOrg.id },
        data: { roles: { set: [OrganizationRoles.OWNER] } },
      });
    });

    /** Send email to new owner */
    sendEmail({
      subject: `🎉 You're now the Owner of ${currentOrganization.name} - Shelf`,
      to: newOwnerUserOrg.user.email,
      text: newOwnerEmailText({
        newOwnerName: `${newOwnerUserOrg.user.firstName} ${newOwnerUserOrg.user.lastName}`,
        workspaceName: currentOrganization.name,
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
      }),
    });

    return {
      newOwner: newOwnerUserOrg.user,
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
    return await db.organization.updateMany({
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
