import type { Booking, Kit, Organization, Prisma } from "@prisma/client";
import { AssetStatus, BookingStatus, KitStatus } from "@prisma/client";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import { dateTimeInUnix } from "~/utils/date-time-in-unix";
import type { ErrorLabel } from "~/utils/error";
import { maybeUniqueConstraintViolation, ShelfError } from "~/utils/error";
import { extractImageNameFromSupabaseUrl } from "~/utils/extract-image-name-from-supabase-url";
import { getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import { Logger } from "~/utils/logger";
import { oneDayFromNow } from "~/utils/one-week-from-now";
import { createSignedUrl, parseFileFormData } from "~/utils/storage.server";
import type { MergeInclude } from "~/utils/utils";
import type { UpdateKitPayload } from "./types";
import { GET_KIT_STATIC_INCLUDES, KITS_INCLUDE_FIELDS } from "./types";
import { createNote } from "../asset/service.server";

const label: ErrorLabel = "Kit";

export async function createKit({
  name,
  description,
  createdById,
  organizationId,
}: Pick<Kit, "name" | "description" | "createdById" | "organizationId">) {
  try {
    return await db.kit.create({
      data: {
        name,
        description,
        createdBy: { connect: { id: createdById } },
        organization: { connect: { id: organizationId } },
      },
    });
  } catch (cause) {
    throw maybeUniqueConstraintViolation(cause, "Kit", {
      additionalData: { userId: createdById, organizationId },
    });
  }
}

export async function updateKit({
  id,
  name,
  description,
  image,
  imageExpiration,
  status,
  createdById,
}: UpdateKitPayload) {
  try {
    return await db.kit.update({
      where: { id },
      data: {
        name,
        description,
        image,
        imageExpiration,
        status,
      },
    });
  } catch (cause) {
    throw maybeUniqueConstraintViolation(cause, "Kit", {
      additionalData: { userId: createdById, id },
    });
  }
}

export async function updateKitImage({
  request,
  kitId,
  userId,
}: {
  request: Request;
  kitId: string;
  userId: string;
}) {
  try {
    const fileData = await parseFileFormData({
      request,
      bucketName: "kits",
      newFileName: `${userId}/${kitId}/image-${dateTimeInUnix(Date.now())}`,
      resizeOptions: {
        width: 800,
        withoutEnlargement: true,
      },
    });

    const image = fileData.get("image") as string;
    if (!image) return;

    const signedUrl = await createSignedUrl({
      filename: image,
      bucketName: "kits",
    });

    await updateKit({
      id: kitId,
      image: signedUrl,
      imageExpiration: oneDayFromNow(),
      createdById: userId,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while updating image for kit.",
      additionalData: { kitId, userId },
      label,
    });
  }
}

export async function getPaginatedAndFilterableKits<
  T extends Prisma.KitInclude,
>({
  request,
  organizationId,
  extraInclude,
  currentBookingId,
}: {
  request: LoaderFunctionArgs["request"];
  organizationId: Organization["id"];
  extraInclude?: T;
  currentBookingId?: Booking["id"];
}) {
  function hasAssetsIncluded(
    extraInclude?: Prisma.KitInclude
  ): extraInclude is Prisma.KitInclude & { assets: boolean } {
    return !!extraInclude?.assets;
  }

  const searchParams = getCurrentSearchParams(request);
  const paramsValues = getParamsValues(searchParams);

  const status =
    searchParams.get("status") === "ALL"
      ? null
      : (searchParams.get("status") as KitStatus | null);
  const teamMember = searchParams.get("teamMember"); // custodian

  const {
    page,
    perPageParam,
    search,
    hideUnavailable,
    bookingFrom,
    bookingTo,
  } = paramsValues;

  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 100 ? perPage : 200;

    const where: Prisma.KitWhereInput = { organizationId };

    if (search) {
      where.name = {
        contains: search.toLowerCase().trim(),
        mode: "insensitive",
      };
    }

    if (status) {
      where.status = status;
    }

    if (teamMember) {
      Object.assign(where, {
        custody: { custodianId: teamMember },
      });
    }

    const unavailableBookingStatuses = [
      BookingStatus.RESERVED,
      BookingStatus.ONGOING,
      BookingStatus.OVERDUE,
    ];

    if (currentBookingId && hideUnavailable) {
      where.assets = {
        every: {
          organizationId,
          custody: null,
        },
      };

      if (bookingFrom && bookingTo) {
        where.assets = {
          every: {
            ...where.assets.every,
            bookings: {
              none: {
                id: { not: currentBookingId },
                status: { in: unavailableBookingStatuses },
                OR: [
                  {
                    from: { lte: bookingTo },
                    to: { gte: bookingFrom },
                  },
                  {
                    from: { gte: bookingFrom },
                    to: { lte: bookingTo },
                  },
                ],
              },
            },
          },
        };
      }
    }

    if (
      currentBookingId &&
      hideUnavailable === true &&
      (!bookingFrom || !bookingTo)
    ) {
      throw new ShelfError({
        cause: null,
        message: "Booking dates are needed to hide unavailable kit.",
        additionalData: { hideUnavailable, bookingFrom, bookingTo },
        label,
      });
    }

    const include = {
      ...extraInclude,
      ...KITS_INCLUDE_FIELDS,
    } as MergeInclude<typeof KITS_INCLUDE_FIELDS, T>;

    let [kits, totalKits, totalKitsWithoutAssets] = await Promise.all([
      db.kit.findMany({
        skip,
        take,
        where,
        include,
        orderBy: { createdAt: "desc" },
      }),
      db.kit.count({ where }),
      db.kit.count({ where: { organizationId, assets: { none: {} } } }),
    ]);

    if (hideUnavailable && hasAssetsIncluded(extraInclude)) {
      kits = kits.filter(
        // @ts-ignore
        (kit) => Array.isArray(kit.assets) && kits?.assets?.length > 0
      );
    }

    const totalPages = Math.ceil(totalKits / perPage);

    return {
      page,
      perPage,
      kits,
      totalKits: hideUnavailable
        ? totalKits - totalKitsWithoutAssets
        : totalKits,
      totalPages,
      search,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching kits",
      additionalData: { page, perPage, organizationId },
      label,
    });
  }
}

export async function getKit<T extends Prisma.KitInclude>({
  id,
  organizationId,
  extraInclude,
}: Pick<Kit, "id" | "organizationId"> & { extraInclude?: T }) {
  try {
    // Merge static includes with dynamic includes
    const includes = {
      ...GET_KIT_STATIC_INCLUDES,
      ...extraInclude,
    } as MergeInclude<typeof GET_KIT_STATIC_INCLUDES, T>;

    return (await db.kit.findUniqueOrThrow({
      where: { id, organizationId },
      include: includes,
    })) as Prisma.KitGetPayload<{ include: typeof includes }>;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Kit not found",
      message:
        "The kit you are trying to access does not exist or you do not have permission to access it.",
      additionalData: { id },
      label, // Adjust the label as needed
    });
  }
}

export async function getAssetsForKits({
  request,
  organizationId,
  extraWhere,
  kitId,
}: {
  request: LoaderFunctionArgs["request"];
  organizationId: Organization["id"];
  kitId?: Kit["id"] | null;
  extraWhere?: Prisma.AssetWhereInput;
}) {
  const searchParams = getCurrentSearchParams(request);
  const paramsValues = getParamsValues(searchParams);
  const status =
    searchParams.get("status") === "ALL" // If the value is "ALL", we just remove the param
      ? null
      : (searchParams.get("status") as AssetStatus | null);

  const { page, perPageParam, search, hideUnavailable } = paramsValues;

  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 100 ? perPage : 20; // min 1 and max 100 per page

    let where: Prisma.AssetWhereInput = { organizationId };
    if (search) {
      where.title = {
        contains: search.toLowerCase().trim(),
        mode: "insensitive",
      };
    }

    if (status) {
      where.status = status;
    }

    if (hideUnavailable) {
      //not disabled for booking
      where.availableToBook = true;
      //not assigned to team member
      where.custody = null;
    }

    if (kitId) {
      where.kitId = kitId;
    }

    const finalQuery = {
      ...where,
      ...extraWhere,
    };

    const [items, totalItems] = await Promise.all([
      db.asset.findMany({
        skip,
        take,
        where: finalQuery,
        include: {
          kit: true,
          custody: { select: { id: true } },
          category: true,
          location: { include: { image: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      db.asset.count({ where: finalQuery }),
    ]);

    const totalPages = Math.ceil(totalItems / perPage);

    return { page, perPage, search, items, totalItems, totalPages };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Fail to fetch paginated and filterable assets",
      additionalData: {
        organizationId,
        paramsValues,
      },
      label,
    });
  }
}

export async function deleteKit({
  id,
  organizationId,
}: {
  id: Kit["id"];
  organizationId: Kit["organizationId"];
}) {
  try {
    return await db.kit.delete({ where: { id, organizationId } });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while deleting kit",
      additionalData: { id, organizationId },
      label,
    });
  }
}

export async function deleteKitImage({
  url,
  bucketName = "kits",
}: {
  url: string;
  bucketName?: string;
}) {
  try {
    const path = extractImageNameFromSupabaseUrl({ url, bucketName });
    if (!path) {
      throw new ShelfError({
        cause: null,
        message: "Cannot extract the image path from the URL",
        additionalData: { url, bucketName },
        label,
      });
    }

    const { error } = await getSupabaseAdmin()
      .storage.from(bucketName)
      .remove([path]);

    if (error) {
      throw error;
    }

    return true;
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to delete kit image",
        additionalData: { url, bucketName },
        label,
      })
    );
  }
}

export async function releaseCustody({
  kitId,
  userId,
}: {
  kitId: Kit["id"];
  userId: string;
}) {
  try {
    const kit = await db.kit.findUniqueOrThrow({
      where: { id: kitId },
      select: {
        name: true,
        assets: true,
        createdBy: { select: { firstName: true, lastName: true } },
        custody: { select: { custodian: true } },
      },
    });

    await Promise.all([
      db.kit.update({
        where: { id: kitId },
        data: {
          status: KitStatus.AVAILABLE,
          custody: { delete: true },
        },
      }),
      ...kit.assets.map((asset) =>
        db.asset.update({
          where: { id: asset.id },
          data: {
            status: AssetStatus.AVAILABLE,
            custody: { delete: true },
          },
        })
      ),
      ...kit.assets.map((asset) =>
        createNote({
          content: `**${kit.createdBy.firstName?.trim()} ${kit.createdBy.lastName?.trim()}** has released **${kit
            .custody?.custodian
            .name}'s** custody over **${asset.title.trim()}**`,
          type: "UPDATE",
          userId,
          assetId: asset.id,
        })
      ),
    ]);

    return kit;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while releasing the custody. Please try again or contact support.",
      additionalData: { kitId },
      label: "Custody",
    });
  }
}

export async function updateKitsWithBookingCustodians<T extends Kit>(
  kits: T[]
): Promise<T[]> {
  try {
    /** When kits are checked out, we have to display the custodian from that booking */
    const checkedOutKits = kits
      .filter((kit) => kit.status === "CHECKED_OUT")
      .map((k) => k.id);

    if (checkedOutKits.length === 0) {
      return kits;
    }

    const resolvedKits: T[] = [];

    for (const kit of kits) {
      if (!checkedOutKits.includes(kit.id)) {
        resolvedKits.push(kit);
        continue;
      }

      /** A kit is not directly associated with booking so have to make an extra query to get the booking for kit  */
      const kitAsset = await db.asset.findFirst({
        where: { kitId: kit.id },
        select: {
          id: true,
          bookings: {
            where: { status: { in: ["ONGOING", "OVERDUE"] } },
            select: {
              id: true,
              custodianTeamMember: true,
              custodianUser: {
                select: {
                  firstName: true,
                  lastName: true,
                  profilePicture: true,
                },
              },
            },
          },
        },
      });

      const booking = kitAsset?.bookings[0];
      const custodianUser = booking?.custodianUser;
      const custodianTeamMember = booking?.custodianTeamMember;

      if (custodianUser) {
        resolvedKits.push({
          ...kit,
          custody: {
            custodian: {
              name: `${custodianUser?.firstName || ""} ${
                custodianUser?.lastName || ""
              }`, // Concatenate firstName and lastName to form the name property with default values
              user: {
                firstName: custodianUser?.firstName || "",
                lastName: custodianUser?.lastName || "",
                profilePicture: custodianUser?.profilePicture || null,
              },
            },
          },
        });
      } else if (custodianTeamMember) {
        resolvedKits.push({
          ...kit,
          custody: {
            custodian: { name: custodianTeamMember.name },
          },
        });
      } else {
        /** This case should never happen because there must be a custodianUser or custodianTeamMember assigned to a booking */
        Logger.error(
          new ShelfError({
            cause: null,
            message: "Could not find custodian for kit",
            additionalData: { kit },
            label,
          })
        );
      }
    }

    return resolvedKits;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to update kits with booking custodian",
      additionalData: { kits },
      label,
    });
  }
}
