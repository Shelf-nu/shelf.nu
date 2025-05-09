import { OrganizationRoles, OrganizationType } from "@prisma/client";
import type { Organization, Prisma, User } from "@prisma/client";

import { db } from "~/database/db.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import { defaultFields } from "../asset-index-settings/helpers";
import { defaultUserCategories } from "../category/default-categories";

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
    const owner = await db.user.findFirstOrThrow({ where: { id: userId } });

    const data = {
      name,
      currency,
      type: OrganizationType.TEAM,
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
}) {
  try {
    const data = {
      name,
      ...(currency && { currency }),
      ...(ssoDetails && {
        ssoDetails: {
          update: ssoDetails,
        },
      }),
    };

    if (image?.size && image?.size > 0) {
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
      message:
        "Something went wrong while updating the organization. Please try again or contact support.",
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
        "Something went wrong while toggling organization SSO. Please try again or contact support.",
      additionalData: { organizationId, workspaceDisabled },
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
