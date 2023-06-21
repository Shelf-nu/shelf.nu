import type { Prisma, User, Location } from "@prisma/client";
import { db } from "~/database";

export async function getLocation({
  userId,
  id,
}: Pick<Location, "id"> & {
  userId: User["id"];
}) {
  return db.location.findFirst({
    where: { id, userId },
    include: {
      assets: {
        include: {
          category: true,
          tags: true,
        },
      },
    },
  });
}

export async function getAllLocations({ userId }: { userId: User["id"] }) {
  return await db.location.findMany({ where: { userId } });
}

export async function getLocations({
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
  let where: Prisma.LocationWhereInput = { userId };

  /** If the search string exists, add it to the where object */
  if (search) {
    where.name = {
      contains: search,
      mode: "insensitive",
    };
  }

  const [locations, totalLocations] = await db.$transaction([
    /** Get the items */
    db.location.findMany({
      skip,
      take,
      where,
      orderBy: { updatedAt: "desc" },
      include: {
        assets: true,
      },
    }),

    /** Count them */
    db.location.count({ where }),
  ]);

  return { locations, totalLocations };
}

export async function createLocation({
  name,
  description,
  address,
  userId,
}: Pick<Location, "description" | "name" | "address"> & {
  userId: User["id"];
}) {
  return db.location.create({
    data: {
      name,
      description,
      address,
      user: {
        connect: {
          id: userId,
        },
      },
    },
  });
}

export async function deleteLocation({
  id,
  userId,
}: Pick<Location, "id"> & { userId: User["id"] }) {
  return await db.location.deleteMany({
    where: { id, userId },
  });
}
