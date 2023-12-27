import type {
  Organization,
  Prisma,
  Tag,
  TeamMember,
  User,
} from "@prisma/client";
import { db } from "~/database";
import { handleUniqueConstraintError } from "~/utils/error";
import type { CreateAssetFromContentImportPayload } from "../asset/types";

export async function getTags({
  organizationId,
  page = 1,
  perPage = 8,
  search,
}: {
  organizationId: Organization["id"];

  /** Page number. Starts at 1 */
  page?: number;

  /** Items to be loaded per page */
  perPage?: number;

  search?: string | null;
}) {
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

  const [tags, totalTags] = await db.$transaction([
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
}

export async function getAllTags({
  organizationId,
}: {
  organizationId: Organization["id"];
}) {
  return await db.tag.findMany({ where: { organizationId } });
}

export async function createTag({
  name,
  description,
  userId,
  organizationId,
}: Pick<Tag, "description" | "name" | "organizationId"> & {
  userId: User["id"];
}) {
  try {
    const tag = await db.tag.create({
      data: {
        name,
        description,
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
    return { tag, error: null };
  } catch (cause: any) {
    return handleUniqueConstraintError(cause, "Tag");
  }
}

export async function deleteTag({
  id,
  organizationId,
}: Pick<Tag, "id"> & { organizationId: Organization["id"] }) {
  return db.tag.deleteMany({
    where: { id, organizationId },
  });
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
  const tags = data
    .filter(({ tags }) => tags.length > 0)
    .reduce((acc: Record<string, string>, curr) => {
      curr.tags.forEach((tag) => tag !== "" && (acc[tag.trim()] = ""));
      return acc;
    }, {});

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
}
export async function getTag({ id }: Pick<Tag, "id">) {
  return db.tag.findUnique({
    where: {
      id,
    },
  });
}

export async function updateTag({
  id,
  name,
  description,
}: Pick<Tag, "id" | "name" | "description">) {
  try {
    const tag = await db.tag.update({
      where: {
        id,
      },
      data: {
        name,
        description,
      },
    });
    return { tag, error: null };
  } catch (cause: any) {
    return handleUniqueConstraintError(cause, "Tag");
  }
}
