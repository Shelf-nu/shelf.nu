import type { Prisma, Tag, User } from "@prisma/client";
import { db } from "~/database";

export async function getTags({
  userId,
  page = 1,
  perPage = 8,
  search,
}: {
  userId: User["id"];

  /** Page number. Starts at 1 */
  page?: number;

  /** Items to be loaded per page */
  perPage?: number;

  search?: string | null;
}) {
  const skip = page > 1 ? (page - 1) * perPage : 0;
  const take = perPage >= 1 ? perPage : 8; // min 1 and max 25 per page

  /** Default value of where. Takes the items belonging to current user */
  let where: Prisma.CategoryWhereInput = { userId };

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

export async function getAllTags({ userId }: { userId: User["id"] }) {
  return await db.tag.findMany({ where: { userId } });
}

export async function createTag({
  name,
  description,
  userId,
}: Pick<Tag, "description" | "name"> & {
  userId: User["id"];
}) {
  return db.tag.create({
    data: {
      name,
      description,
      user: {
        connect: {
          id: userId,
        },
      },
    },
  });
}

export async function deleteTag({
  id,
  userId,
}: Pick<Tag, "id"> & { userId: User["id"] }) {
  return db.tag.deleteMany({
    where: { id, userId },
  });
}

export const buildTagsSet = (tags: string | undefined) =>
  /** This checks if tags are passed and build the object needed to set tags to an asset  */
  tags && tags !== ""
    ? {
        set: tags?.split(",").map((t) => ({ id: t })) || [],
      }
    : { set: [] };

    export async function getTag({ id }: Pick<Tag, "id">){
      return db.tag.findUnique({
        where: { 
          id
         }
      })
    }
    
    export async function updateTag({
      id,
      name,
      description
    }: Pick<Tag, "id" | "name" | "description" > 
    ) {
      return db.tag.update({
        where: {
          id
        },
        data: {
          name,
          description
        },
      });
    }