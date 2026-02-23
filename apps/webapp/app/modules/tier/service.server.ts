import type {
  CustomTierLimit,
  Organization,
  TierId,
  TierLimit,
  User,
} from "@prisma/client";
import { db } from "~/database/db.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";

const label: ErrorLabel = "Tier";

export async function getUserTierLimit(id: User["id"]) {
  try {
    const { tier } = await db.user
      .findUniqueOrThrow({
        where: { id },
        select: {
          tier: {
            include: { tierLimit: true },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message:
            "User tier not found. This seems like a bug. Please contact support.",
          additionalData: { userId: id },
          label,
        });
      });

    /**
     * If the tier is custom, we fetch the custom tier limit and return it
     */
    if (tier.id === "custom") {
      return (await db.customTierLimit
        .findUniqueOrThrow({
          where: { userId: id },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message:
              "Failed to get custom tier limit. This seems like a bug. Please contact support.",
            additionalData: { userId: id },
            label,
          });
        })) as CustomTierLimit;
    }

    return tier.tierLimit as TierLimit;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching user tier limit",
      additionalData: { userId: id },
      label,
    });
  }
}

export async function updateUserTierId(id: User["id"], tierId: TierId) {
  try {
    return await db.user.update({
      where: { id },
      data: {
        tierId,
        /**
         * If the user tier is being change to custom, we upsert CustomTierLimit
         * The upsert will make sure that if there is no customTierLimit for that user its created
         */
        ...(tierId === "custom" && {
          customTierLimit: {
            upsert: {
              create: {},
              update: {},
            },
          },
        }),
      },
      select: {
        id: true,
        tierId: true,
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while updating user tier limit",
      additionalData: { userId: id, tierId },
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
  organizations: Pick<
    Organization,
    "id" | "type" | "name" | "imageId" | "userId"
  >[];
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
