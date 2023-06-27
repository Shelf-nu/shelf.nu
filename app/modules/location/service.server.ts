import type { Prisma, User, Location } from "@prisma/client";
import { db } from "~/database";
// import { blobFromBuffer } from "~/utils/blob-from-buffer";

export async function getLocation({
  userId,
  id,
  page = 1,
  perPage = 8,
  search,
}: Pick<Location, "id"> & {
  userId: User["id"];
  /** Page number. Starts at 1 */
  page?: number;

  /** Assets to be loaded per page with the lcoation */
  perPage?: number;

  search?: string | null;
}) {
  const skip = page > 1 ? (page - 1) * perPage : 0;
  const take = perPage >= 1 ? perPage : 8; // min 1 and max 25 per page
  let assetsWhere: Prisma.AssetWhereInput = {};

  if (search) {
    assetsWhere.title = {
      contains: search,
      mode: "insensitive",
    };
  }
  const [location, totalAssetsWithinLocation] = await db.$transaction([
    /** Get the items */
    db.location.findFirst({
      where: { id, userId },
      include: {
        assets: {
          include: {
            category: true,
            tags: true,
          },
          skip,
          take,
          where: assetsWhere,
        },
      },
    }),

    /** Count them */
    db.asset.count({
      where: {
        locationId: id,
      },
    }),
  ]);

  return { location, totalAssetsWithinLocation };
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
  image,
}: Pick<Location, "description" | "name" | "address"> & {
  userId: User["id"];
  image: File | null;
}) {
  const data = {
    name,
    description,
    address,
    user: {
      connect: {
        id: userId,
      },
    },
  };

  if (image) {
    Object.assign(data, {
      image: {
        create: {
          blob: Buffer.from(await image.arrayBuffer()),
          contentType: image.type,
          user: {
            connect: {
              id: userId,
            },
          },
        },
      },
    });
  }

  return db.location.create({ data });
}

export async function deleteLocation({
  id,
  userId,
}: Pick<Location, "id"> & { userId: User["id"] }) {
  return await db.location.deleteMany({
    where: { id, userId },
  });
}

export async function updateLocation(payload: {
  id: Location["id"];
  name?: Location["name"];
  address?: Location["address"];
  description?: Location["description"];
}) {
  return await db.location.update({
    where: { id: payload.id },
    data: payload,
  });
}
