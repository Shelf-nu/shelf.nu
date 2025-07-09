import type {
  Organization,
  Prisma,
  Tag,
  TeamMember,
  User,
} from "@prisma/client";
import { TagUseFor } from "@prisma/client";
import loadash from "lodash";
import { db } from "~/database/db.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError, maybeUniqueConstraintViolation } from "~/utils/error";
import { getCurrentSearchParams } from "~/utils/http.server";
import { ALL_SELECTED_KEY } from "~/utils/list";
import type { CreateAssetFromContentImportPayload } from "../asset/types";

const label: ErrorLabel = "Tag";

export async function getTags(params: {
  organizationId: Organization["id"];
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
    const take = perPage >= 1 ? perPage : 8; // min 1 and max 25 per page

    /** Default value of where. Takes the items belonging to current user */
    let where: Prisma.TagWhereInput = { organizationId };

    /** If the search string exists, add it to the where object */
    if (search) {
      where.name = {
        contains: search,
        mode: "insensitive",
      };
    }

    if (useFor) {
      where.useFor = { has: useFor as TagUseFor };
    }

    const [tags, totalTags] = await Promise.all([
      /** Get the items */
      db.tag.findMany({
        skip,
        take,
        where,
        orderBy: { updatedAt: "desc" },
      }),

      /** Count them */
      db.tag.count({ where }),
    ]);

    return { tags, totalTags };
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
  userId,
  organizationId,
  useFor,
}: Pick<Tag, "description" | "name" | "organizationId"> & {
  userId: User["id"];
  useFor: TagUseFor[];
}) {
  try {
    return await db.tag.create({
      data: {
        name: loadash.trim(name),
        description,
        useFor,
        user: {
          connect: {
            id: userId,
          },
        },
        organization: {
          connect: {
            id: organizationId,
          },
        },
      },
    });
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
}: Pick<Tag, "id"> & { organizationId: Organization["id"] }) {
  try {
    return await db.tag.deleteMany({
      where: { id, organizationId },
    });
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
  userId: User["id"];
  organizationId: Organization["id"];
}): Promise<Record<string, TeamMember["id"]>> {
  try {
    const tags = data
      .filter(({ tags }) => tags?.length > 0)
      .reduce((acc: Record<string, string>, curr) => {
        curr.tags.forEach((tag) => tag !== "" && (acc[tag.trim()] = ""));
        return acc;
      }, {});
    // Handle the case where there are no tags
    if (!Object.keys(tags).length) {
      return {};
    }

    // now we loop through the categories and check if they exist
    for (const tag of Object.keys(tags)) {
      const existingTag = await db.tag.findFirst({
        where: {
          name: { equals: tag, mode: "insensitive" },
          organizationId,
        },
      });

      if (!existingTag) {
        // if the tag doesn't exist, we create a new one
        const newTag = await db.tag.create({
          data: {
            name: tag as string,
            user: {
              connect: {
                id: userId,
              },
            },
            organization: {
              connect: {
                id: organizationId,
              },
            },
          },
        });
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
}: Pick<Tag, "id" | "organizationId">) {
  try {
    return await db.tag.findUniqueOrThrow({
      where: {
        id,
        organizationId,
      },
    });
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
  useFor,
}: Pick<Tag, "id" | "organizationId" | "name" | "description"> & {
  useFor?: TagUseFor[];
}) {
  try {
    return await db.tag.update({
      where: {
        id,
        organizationId,
      },
      data: {
        name: loadash.trim(name),
        description,
        useFor: {
          set: useFor,
        },
      },
    });
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
  tagIds: Tag["id"][];
  organizationId: Organization["id"];
}) {
  try {
    return await db.tag.deleteMany({
      where: tagIds.includes(ALL_SELECTED_KEY)
        ? { organizationId }
        : { id: { in: tagIds }, organizationId },
    });
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
 * This function fetches tags that can be used for booking tags filter, which is used in the booking create forms as well as in the bookings filters
 */
export async function getTagsForBookingTagsFilter({
  organizationId,
}: {
  organizationId: Organization["id"];
}) {
  try {
    const tags = await db.tag.findMany({
      where: {
        organizationId,
        OR: [
          { useFor: { isEmpty: true } },
          { useFor: { has: TagUseFor.BOOKING } },
        ],
      },
    });

    return { tags, totalTags: tags.length };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching tags for booking filter",
      additionalData: { organizationId },
      label,
    });
  }
}
