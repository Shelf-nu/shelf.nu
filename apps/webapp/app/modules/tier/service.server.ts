import type {
  CustomTierLimit,
  Organization,
  TierId,
  TierLimit,
  User,
} from "@prisma/client";
import { sbDb } from "~/database/supabase.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";

const label: ErrorLabel = "Tier";

export async function getUserTierLimit(
  id: User["id"]
): Promise<TierLimit | CustomTierLimit> {
  try {
    /** Fetch user with tier and tierLimit in a single query via join */
    const { data: user, error: userError } = await sbDb
      .from("User")
      .select(
        "tierId, Tier:tierId ( id, tierLimitId, TierLimit:tierLimitId (*) )"
      )
      .eq("id", id)
      .single();

    if (userError || !user) {
      throw new ShelfError({
        cause: userError,
        message:
          "User tier not found. This seems like a bug. Please contact support.",
        additionalData: { userId: id },
        label,
      });
    }

    const tier = user.Tier as unknown as {
      id: string;
      tierLimitId: string | null;
      TierLimit: TierLimit | null;
    } | null;

    if (!tier) {
      throw new ShelfError({
        cause: null,
        message:
          "User tier not found. This seems like a bug. Please contact support.",
        additionalData: { userId: id },
        label,
      });
    }

    /**
     * If the tier is custom, we fetch the custom tier limit and return it
     */
    if (tier.id === "custom") {
      const { data: customLimit, error: customError } = await sbDb
        .from("CustomTierLimit")
        .select("*")
        .eq("userId", id)
        .single();

      if (customError || !customLimit) {
        throw new ShelfError({
          cause: customError,
          message:
            "Failed to get custom tier limit. This seems like a bug. Please contact support.",
          additionalData: { userId: id },
          label,
        });
      }

      return customLimit as unknown as CustomTierLimit;
    }

    return tier.TierLimit as TierLimit;
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
    /**
     * If the user tier is being changed to custom, we upsert CustomTierLimit.
     * The upsert will make sure that if there is no customTierLimit for that user it's created.
     */
    if (tierId === "custom") {
      const { data: existing, error: lookupError } = await sbDb
        .from("CustomTierLimit")
        .select("id")
        .eq("userId", id)
        .maybeSingle();

      if (lookupError) {
        throw new ShelfError({
          cause: lookupError,
          message: "Failed to look up custom tier limit",
          additionalData: { userId: id, tierId },
          label,
        });
      }

      if (!existing) {
        const { error: insertError } = await sbDb
          .from("CustomTierLimit")
          .insert({ userId: id });

        if (insertError) {
          throw new ShelfError({
            cause: insertError,
            message: "Failed to create custom tier limit",
            additionalData: { userId: id, tierId },
            label,
          });
        }
      }
    }

    const { data, error } = await sbDb
      .from("User")
      .update({ tierId })
      .eq("id", id)
      .select("id, tierId")
      .single();

    if (error) {
      throw new ShelfError({
        cause: error,
        message: "Something went wrong while updating user tier limit",
        additionalData: { userId: id, tierId },
        label,
      });
    }

    return data;
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
