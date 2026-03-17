import type { Sb } from "@shelf/database";
import lodash from "lodash";
import { sbDb } from "~/database/supabase.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError, maybeUniqueConstraintViolation } from "~/utils/error";
import { getRandomColor } from "~/utils/get-random-color";
import { getCurrentSearchParams } from "~/utils/http.server";
import { ALL_SELECTED_KEY } from "~/utils/list";
import type { CreateAssetFromContentImportPayload } from "../asset/types";

const label: ErrorLabel = "Tag";

export async function getTags(params: {
  organizationId: string;
  /** Page number. Starts at 1 */
  page?: number;
  /** Items to be loaded per page */
  perPage?: number;
  search?: string | null;
  request: Request;
}) {
  const { organizationId, page = 1, perPage = 8, search, request } = params;

  try {
    const searchParams = getCurrentSearchParams(request);
    const useFor = searchParams.get("useFor");

    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 ? perPage : 8;

    let query = sbDb
      .from("Tag")
      .select("*", { count: "exact" })
      .eq("organizationId", organizationId)
      .order("updatedAt", { ascending: false })
      .range(skip, skip + take - 1);

    if (search) {
      query = query.ilike("name", `%${search}%`);
    }

    if (useFor) {
      query = query.contains("useFor", [useFor]);
    }

    const { data: tags, count, error } = await query;

    if (error) throw error;

    return { tags: tags ?? [], totalTags: count ?? 0 };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching the tags",
      additionalData: { ...params },
      label,
    });
  }
}

export async function createTag({
  name,
  description,
  color,
  userId,
  organizationId,
  useFor,
}: {
  name: string;
  description: string | null;
  color: string | null;
  userId: string;
  organizationId: string;
  useFor: Sb.TagUseFor[];
}) {
  try {
    const { data, error } = await sbDb
      .from("Tag")
      .insert({
        name: lodash.trim(name),
        description,
        useFor,
        color,
        userId,
        organizationId,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (cause) {
    throw maybeUniqueConstraintViolation(cause, "Tag", {
      additionalData: {
        userId,
        organizationId,
      },
    });
  }
}

export async function deleteTag({
  id,
  organizationId,
}: {
  id: string;
  organizationId: string;
}) {
  try {
    const { error, count } = await sbDb
      .from("Tag")
      .delete({ count: "exact" })
      .eq("id", id)
      .eq("organizationId", organizationId);

    if (error) throw error;
    return { count };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while deleting the tag",
      additionalData: { id, organizationId },
      label,
    });
  }
}

export const buildTagsSet = (tags: string | undefined) =>
  /** This checks if tags are passed and build the object needed to set tags to an asset  */
  tags && tags !== ""
    ? {
        set: tags?.split(",").map((t) => ({ id: t })) || [],
      }
    : { set: [] };

export async function createTagsIfNotExists({
  data,
  userId,
  organizationId,
}: {
  data: CreateAssetFromContentImportPayload[];
  userId: string;
  organizationId: string;
}): Promise<Record<string, string>> {
  try {
    const tags = data
      .filter(({ tags }) => tags && tags.length > 0)
      .reduce((acc: Record<string, string>, curr) => {
        curr.tags!.forEach((tag) => tag !== "" && (acc[tag.trim()] = ""));
        return acc;
      }, {});
    // Handle the case where there are no tags
    if (!Object.keys(tags).length) {
      return {};
    }

    // now we loop through the tags and check if they exist
    for (const tag of Object.keys(tags)) {
      const { data: existingTag } = await sbDb
        .from("Tag")
        .select("id")
        .ilike("name", tag)
        .eq("organizationId", organizationId)
        .maybeSingle();

      if (!existingTag) {
        // if the tag doesn't exist, we create a new one
        const { data: newTag, error } = await sbDb
          .from("Tag")
          .insert({
            name: tag as string,
            color: getRandomColor(),
            userId,
            organizationId,
          })
          .select("id")
          .single();

        if (error) throw error;
        tags[tag] = newTag.id;
      } else {
        // if the tag exists, we just update the id
        tags[tag] = existingTag.id;
      }
    }

    return tags;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating the tags. Seems like some of the tag data in your import file is invalid. Please check and try again.",
      additionalData: { userId, organizationId },
      label,
      /** No need to capture those. They are mostly related to malformed CSV data */
      shouldBeCaptured: false,
    });
  }
}

export async function getTag({
  id,
  organizationId,
}: {
  id: string;
  organizationId: string;
}) {
  try {
    const { data, error } = await sbDb
      .from("Tag")
      .select("*")
      .eq("id", id)
      .eq("organizationId", organizationId)
      .single();

    if (error) throw error;
    return data;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Tag not found",
      message:
        "The tag you are trying to access does not exist or you do not have permission to access it.",
      additionalData: { id, organizationId },
      label,
    });
  }
}

export async function updateTag({
  id,
  organizationId,
  name,
  description,
  color,
  useFor,
}: {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  color: string | null;
  useFor?: Sb.TagUseFor[];
}) {
  try {
    const updateData: Record<string, unknown> = {
      name: lodash.trim(name),
      description,
      color,
    };
    if (useFor !== undefined) {
      updateData.useFor = useFor;
    }

    const { data, error } = await sbDb
      .from("Tag")
      .update(updateData)
      .eq("id", id)
      .eq("organizationId", organizationId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (cause) {
    throw maybeUniqueConstraintViolation(cause, "Tag", {
      additionalData: {
        id,
        organizationId,
      },
    });
  }
}

export async function bulkDeleteTags({
  tagIds,
  organizationId,
}: {
  tagIds: string[];
  organizationId: string;
}) {
  try {
    let query = sbDb
      .from("Tag")
      .delete({ count: "exact" })
      .eq("organizationId", organizationId);

    if (!tagIds.includes(ALL_SELECTED_KEY)) {
      query = query.in("id", tagIds);
    }

    const { error, count } = await query;

    if (error) throw error;
    return { count };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while bulk deleting tags.",
      additionalData: { tagIds, organizationId },
      label,
    });
  }
}

/**
 * This function fetches tags that can be used for booking tags filter,
 * which is used in the booking create forms as well as in the bookings filters
 */
export async function getTagsForBookingTagsFilter({
  organizationId,
}: {
  organizationId: string;
}) {
  try {
    const { data: tags, error } = await sbDb
      .from("Tag")
      .select("*")
      .eq("organizationId", organizationId)
      .or("useFor.eq.{},useFor.cs.{BOOKING}");

    if (error) throw error;

    return { tags: tags ?? [], totalTags: (tags ?? []).length };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching tags for booking filter",
      additionalData: { organizationId },
      label,
    });
  }
}
