import type { Organization, User } from "@shelf/database";
import { db } from "~/database/db.server";
import {
  findFirstOrThrow,
  throwIfNotFound,
  update,
} from "~/database/query-helpers.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";

const label: ErrorLabel = "Tier";

/** TierId enum values — mirrors the Prisma TierId enum */
type TierId = "free" | "tier_1" | "tier_2" | "custom";

/** Shape of the TierLimit table row */
interface TierLimit {
  id: TierId;
  canImportAssets: boolean;
  canExportAssets: boolean;
  canImportNRM: boolean;
  canHideShelfBranding: boolean;
  maxCustomFields: number;
  maxOrganizations: number;
  createdAt: string;
  updatedAt: string;
}

/** Shape of the CustomTierLimit table row */
interface CustomTierLimit {
  id: string;
  userId: string | null;
  canImportAssets: boolean;
  canExportAssets: boolean;
  canImportNRM: boolean;
  canHideShelfBranding: boolean;
  maxCustomFields: number;
  maxOrganizations: number;
  isEnterprise: boolean;
  createdAt: string;
  updatedAt: string;
}

export type { TierId, TierLimit, CustomTierLimit };

export async function getUserTierLimit(
  id: User["id"]
): Promise<TierLimit | CustomTierLimit> {
  try {
    const user = await findFirstOrThrow(db, "User", {
      where: { id },
      select: "tierId",
    }).catch((cause) => {
      throw new ShelfError({
        cause,
        message:
          "User tier not found. This seems like a bug. Please contact support.",
        additionalData: { userId: id },
        label,
      });
    });

    const tierId = (user as unknown as { tierId: TierId }).tierId;

    /**
     * If the tier is custom, we fetch the custom tier limit and return it
     */
    if (tierId === "custom") {
      const result = await db
        .from("CustomTierLimit" as any)
        .select("*")
        .eq("userId", id)
        .single();

      if (result.error || !result.data) {
        throw new ShelfError({
          cause: result.error,
          message:
            "Failed to get custom tier limit. This seems like a bug. Please contact support.",
          additionalData: { userId: id },
          label,
        });
      }

      return result.data as unknown as CustomTierLimit;
    }

    // Fetch the tier limit for the user's tier
    const tierLimitResult = await db
      .from("TierLimit" as any)
      .select("*")
      .eq("id", tierId)
      .single();

    if (tierLimitResult.error || !tierLimitResult.data) {
      throw new ShelfError({
        cause: tierLimitResult.error,
        message:
          "Tier limit not found. This seems like a bug. Please contact support.",
        additionalData: { userId: id, tierId },
        label,
      });
    }

    return tierLimitResult.data as unknown as TierLimit;
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
    // Update the user's tierId
    const updatedUser = await update(db, "User", {
      where: { id },
      data: { tierId } as Record<string, unknown>,
    });

    /**
     * If the user tier is being changed to custom, we upsert CustomTierLimit.
     * The upsert will make sure that if there is no customTierLimit for
     * that user it's created.
     */
    if (tierId === "custom") {
      const upsertResult = await db
        .from("CustomTierLimit" as any)
        .upsert({ userId: id } as any, { onConflict: "userId" })
        .select("*")
        .single();

      throwIfNotFound(upsertResult);
    }

    return { id: updatedUser.id, tierId };
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
