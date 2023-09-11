import type { Prisma, User, Location } from "@prisma/client";
import { db } from "~/database";
import type { CreateAssetFromContentImportPayload } from "../asset";

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

  /** Build where object for querying related assets */
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

  if (image?.size && image?.size > 0) {
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

export async function deleteLocation({ id }: Pick<Location, "id">) {
  const location = await db.location.delete({
    where: { id },
  });

  if (location.imageId) {
    await db.image.delete({
      where: { id: location.imageId },
    });
  }

  return location;
}

export async function updateLocation(payload: {
  id: Location["id"];
  name?: Location["name"];
  address?: Location["address"];
  description?: Location["description"];
  image: File | null;
  userId: User["id"];
}) {
  const { id, name, address, description, image, userId } = payload;
  const data = {
    name,
    description,
    address,
  };

  if (image?.size && image?.size > 0) {
    const imageData = {
      blob: Buffer.from(await image.arrayBuffer()),
      contentType: image.type,
      user: {
        connect: {
          id: userId,
        },
      },
    };

    /** We do an upsert, because if a user creates a location wihtout an image,
     * we need to create an Image when the location is updated,
     * else we need to update the Image */
    Object.assign(data, {
      image: {
        upsert: {
          create: imageData,
          update: imageData,
        },
      },
    });
  }

  return await db.location.update({
    where: { id },
    data: data,
  });
}

export async function createLocationsIfNotExists({
  data,
  userId,
}: {
  data: CreateAssetFromContentImportPayload[];
  userId: User["id"];
}): Promise<Record<string, Location["id"]>> {
  // first we get all the locations from the assets and make then into an object where the category is the key and the value is an empty string
  const locations = new Map(
    data
      .filter((asset) => asset.location !== "")
      .map((asset) => [asset.location, ""])
  );

  // now we loop through the locations and check if they exist
  for (const [location, _] of locations) {
    const existingCategory = await db.location.findFirst({
      where: { name: location, userId },
    });

    if (!existingCategory) {
      // if the location doesn't exist, we create a new one
      const newLocation = await db.location.create({
        data: {
          name: (location as string).trim(),
          user: {
            connect: {
              id: userId,
            },
          },
        },
      });
      locations.set(location, newLocation.id);
    } else {
      // if the location exists, we just update the id
      locations.set(location, existingCategory.id);
    }
  }

  return Object.fromEntries(Array.from(locations));
}
