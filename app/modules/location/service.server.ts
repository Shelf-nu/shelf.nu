import type { Prisma, User, Location, Organization } from "@prisma/client";
import { db } from "~/database";
import { handleUniqueConstraintError } from "~/utils/error";
import type { CreateAssetFromContentImportPayload } from "../asset/types";

export async function getLocation({
  organizationId,
  id,
  page = 1,
  perPage = 8,
  search,
}: Pick<Location, "id"> & {
  organizationId: Organization["id"];
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
      where: { id, organizationId },
      include: {
        image: {
          select: {
            updatedAt: true,
          },
        },
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

export async function getAllLocations({
  organizationId,
}: {
  organizationId: Organization["id"];
}) {
  return await db.location.findMany({ where: { organizationId } });
}

export async function getLocations({
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
  let where: Prisma.LocationWhereInput = { organizationId };

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
        image: {
          select: {
            updatedAt: true,
          },
        },
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
  organizationId,
  image,
}: Pick<Location, "description" | "name" | "address"> & {
  userId: User["id"];
  organizationId: Organization["id"];
  image: File | null;
}) {
  try {
    const data = {
      name,
      description,
      address,
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
    };

    if (image?.size && image?.size > 0) {
      Object.assign(data, {
        image: {
          create: {
            blob: Buffer.from(await image.arrayBuffer()),
            contentType: image.type,
            ownerOrg: {
              connect: {
                id: organizationId,
              },
            },
            user: {
              connect: {
                id: userId,
              },
            },
          },
        },
      });
    }

    const location = await db.location.create({ data });
    return { location, error: null };
  } catch (cause) {
    return handleUniqueConstraintError(cause, "Location");
  }
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
  organizationId: Organization["id"];
}) {
  try {
    const { id, name, address, description, image, userId, organizationId } =
      payload;
    const data = {
      name,
      description,
      address,
    };

    if (image?.size && image?.size > 0) {
      const imageData = {
        blob: Buffer.from(await image.arrayBuffer()),
        contentType: image.type,
        ownerOrg: {
          connect: {
            id: organizationId,
          },
        },
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

    const location = await db.location.update({
      where: { id },
      data: data,
    });
    return { location, error: null };
  } catch (cause) {
    return handleUniqueConstraintError(cause, "Location");
  }
}

export async function createLocationsIfNotExists({
  data,
  userId,
  organizationId,
}: {
  data: CreateAssetFromContentImportPayload[];
  userId: User["id"];
  organizationId: Organization["id"];
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
      where: { name: location, organizationId },
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
          organization: {
            connect: {
              id: organizationId,
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
