import type {
  Barcode,
  Booking,
  Kit,
  Organization,
  Prisma,
  Qr,
  TeamMember,
  User,
  UserOrganization,
} from "@prisma/client";
import {
  AssetStatus,
  BookingStatus,
  ErrorCorrection,
  KitStatus,
} from "@prisma/client";
import type { LoaderFunctionArgs } from "@remix-run/node";
import invariant from "tiny-invariant";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { updateBarcodes, validateBarcodeUniqueness } from "~/modules/barcode/service.server";
import { getDateTimeFormat } from "~/utils/client-hints";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import { dateTimeInUnix } from "~/utils/date-time-in-unix";
import type { ErrorLabel } from "~/utils/error";
import {
  isLikeShelfError,
  isNotFoundError,
  maybeUniqueConstraintViolation,
  ShelfError,
  VALIDATION_ERROR,
} from "~/utils/error";
import { extractImageNameFromSupabaseUrl } from "~/utils/extract-image-name-from-supabase-url";
import { getRedirectUrlFromRequest } from "~/utils/http";
import { getCurrentSearchParams } from "~/utils/http.server";
import { id } from "~/utils/id/id.server";
import { ALL_SELECTED_KEY, getParamsValues } from "~/utils/list";
import { Logger } from "~/utils/logger";
import { oneDayFromNow } from "~/utils/one-week-from-now";
import { createSignedUrl, parseFileFormData } from "~/utils/storage.server";
import type { MergeInclude } from "~/utils/utils";
import type { UpdateKitPayload } from "./types";
import {
  GET_KIT_STATIC_INCLUDES,
  KIT_SELECT_FIELDS_FOR_LIST_ITEMS,
  KITS_INCLUDE_FIELDS,
} from "./types";
import { getKitsWhereInput } from "./utils.server";
import type { CreateAssetFromContentImportPayload } from "../asset/types";
import { createNote } from "../note/service.server";
import { getQr } from "../qr/service.server";

import { getUserByID } from "../user/service.server";

const label: ErrorLabel = "Kit";

export async function createKit({
  name,
  description,
  createdById,
  organizationId,
  qrId,
  barcodes,
}: Pick<Kit, "name" | "description" | "createdById" | "organizationId"> & {
  qrId?: Qr["id"];
  barcodes?: Pick<Barcode, "type" | "value">[];
}) {
  try {
    /** User connection data */
    const user = {
      connect: {
        id: createdById,
      },
    };

    const organization = {
      connect: {
        id: organizationId as string,
      },
    };

    /**
     * If a qr code is passed, link to that QR
     * Otherwise, create a new one
     * Here we also need to double check:
     * 1. If the qr code exists
     * 2. If the qr code belongs to the current organization
     * 3. If the qr code is not linked to an asset
     */
    const qr = qrId ? await getQr({ id: qrId }) : null;
    const qrCodes =
      qr &&
      qr.organizationId === organizationId &&
      qr.assetId === null &&
      qr.kitId === null
        ? { connect: { id: qrId } }
        : {
            create: [
              {
                id: id(),
                version: 0,
                errorCorrection: ErrorCorrection["L"],
                user,
                organization,
              },
            ],
          };

    const data = {
      name,
      description,
      createdBy: user,
      organization,
      qrCodes,
    };

    /** If barcodes are passed, create them */
    if (barcodes && barcodes.length > 0) {
      const barcodesToAdd = barcodes.filter(
        (barcode) => !!barcode.value && !!barcode.type
      );

      Object.assign(data, {
        barcodes: {
          create: barcodesToAdd.map(({ type, value }) => ({
            type,
            value: value.toUpperCase(),
            organizationId,
          })),
        },
      });
    }

    return await db.kit.create({
      data,
    });
  } catch (cause) {
    // If it's a Prisma unique constraint violation on barcode values, 
    // use our detailed validation to provide specific field errors
    if (cause instanceof Error && 'code' in cause && cause.code === 'P2002') {
      const prismaError = cause as any;
      const target = prismaError.meta?.target;
      
      if (target && target.includes('value') && barcodes && barcodes.length > 0) {
        const barcodesToAdd = barcodes.filter(
          (barcode) => !!barcode.value && !!barcode.type
        );
        if (barcodesToAdd.length > 0) {
          // Use existing validation function for detailed error messages
          await validateBarcodeUniqueness(barcodesToAdd, organizationId);
        }
      }
    }
    
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
  organizationId,
  barcodes,
}: UpdateKitPayload) {
  try {
    const kit = await db.kit.update({
      where: { id, organizationId },
      data: {
        name,
        description,
        image,
        imageExpiration,
        status,
      },
    });

    /** If barcodes are passed, update existing barcodes efficiently */
    if (barcodes !== undefined) {
      await updateBarcodes({
        barcodes,
        kitId: id,
        organizationId,
        userId: createdById,
      });
    }

    return kit;
  } catch (cause) {
    // If it's already a ShelfError with validation errors, re-throw as is
    if (cause instanceof ShelfError && cause.additionalData?.[VALIDATION_ERROR]) {
      throw cause;
    }
    
    throw maybeUniqueConstraintViolation(cause, "Kit", {
      additionalData: { userId: createdById, id },
    });
  }
}

export async function updateKitImage({
  request,
  kitId,
  userId,
  organizationId,
}: {
  request: Request;
  kitId: string;
  userId: string;
  organizationId: Kit["organizationId"];
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
      organizationId,
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
        (kit) => Array.isArray(kit.assets) && kit?.assets?.length > 0
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

type KitWithInclude<T extends Prisma.KitInclude | undefined> =
  T extends Prisma.KitInclude
    ? Prisma.KitGetPayload<{
        include: MergeInclude<typeof GET_KIT_STATIC_INCLUDES, T>;
      }>
    : Prisma.KitGetPayload<{ include: typeof GET_KIT_STATIC_INCLUDES }>;

export async function getKit<T extends Prisma.KitInclude | undefined>({
  id,
  organizationId,
  extraInclude,
  userOrganizations,
  request,
}: Pick<Kit, "id" | "organizationId"> & {
  extraInclude?: T;
  userOrganizations?: Pick<UserOrganization, "organizationId">[];
  request?: Request;
}) {
  try {
    const otherOrganizationIds = userOrganizations?.map(
      (org) => org.organizationId
    );

    // Merge static includes with dynamic includes
    const includes = {
      ...GET_KIT_STATIC_INCLUDES,
      ...extraInclude,
    } as MergeInclude<typeof GET_KIT_STATIC_INCLUDES, T>;

    const kit = await db.kit.findFirstOrThrow({
      where: {
        OR: [
          { id, organizationId },
          ...(userOrganizations?.length
            ? [{ id, organizationId: { in: otherOrganizationIds } }]
            : []),
        ],
      },
      include: includes,
    });

    /* User is accessing the asset in the wrong organizations. In that case we need special 404 handlng. */
    if (
      userOrganizations?.length &&
      kit.organizationId !== organizationId &&
      otherOrganizationIds?.includes(kit.organizationId)
    ) {
      const redirectTo =
        typeof request !== "undefined"
          ? getRedirectUrlFromRequest(request)
          : undefined;

      throw new ShelfError({
        cause: null,
        title: "Kit not found",
        message: "",
        additionalData: {
          model: "kit",
          organization: userOrganizations.find(
            (org) => org.organizationId === kit.organizationId
          ),
          redirectTo,
        },
        label,
        status: 404,
        shouldBeCaptured: false, // In this case we shouldnt be capturing the error
      });
    }

    return kit as KitWithInclude<T>;
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);

    throw new ShelfError({
      cause,
      title: "Kit not found",
      message:
        "The kit you are trying to access does not exist or you do not have permission to access it.",
      additionalData: {
        id,
        ...(isShelfError ? cause.additionalData : {}),
      },
      label,
      shouldBeCaptured: isShelfError
        ? cause.shouldBeCaptured
        : !isNotFoundError(cause),
    });
  }
}

export async function getAssetsForKits({
  request,
  organizationId,
  extraWhere,
  kitId,
  ignoreFilters,
}: {
  request: LoaderFunctionArgs["request"];
  organizationId: Organization["id"];
  kitId: Kit["id"];
  extraWhere?: Prisma.AssetWhereInput;
  /** Set this to true if you don't want the search filters to be applied */
  ignoreFilters?: boolean;
}) {
  const searchParams = getCurrentSearchParams(request);
  const paramsValues = getParamsValues(searchParams);
  const { page, perPageParam, search, orderBy, orderDirection } = paramsValues;

  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 100 ? perPage : 20; // min 1 and max 100 per page

    let where: Prisma.AssetWhereInput = { organizationId, kitId };

    if (search && !ignoreFilters) {
      where.title = {
        contains: search.toLowerCase().trim(),
        mode: "insensitive",
      };
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
        select: KIT_SELECT_FIELDS_FOR_LIST_ITEMS,
        orderBy: { [orderBy]: orderDirection },
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
  organizationId,
}: {
  kitId: Kit["id"];
  userId: string;
  organizationId: Kit["organizationId"];
}) {
  try {
    const kit = await db.kit.findUniqueOrThrow({
      where: { id: kitId, organizationId },
      select: {
        id: true,
        name: true,
        assets: true,
        createdBy: { select: { firstName: true, lastName: true } },
        custody: { select: { custodian: true } },
      },
    });

    await Promise.all([
      db.kit.update({
        where: { id: kitId, organizationId },
        data: {
          status: KitStatus.AVAILABLE,
          custody: { delete: true },
        },
      }),
      ...kit.assets.map((asset) =>
        db.asset.update({
          where: { id: asset.id, organizationId },
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
            .name}'s** custody over **${asset.title.trim()}** via Kit assignment **[${
            kit.name
          }](/kits/${kit.id})**`,
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
        resolvedKits.push(kit);
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

type CurrentBookingType = {
  id: string;
  name: string;
  custodianUser: {
    firstName: string | null;
    lastName: string | null;
    profilePicture: string | null;
    email: string;
  } | null;
  custodianTeamMember: Omit<
    TeamMember,
    "createdAt" | "updatedAt" | "deletedAt"
  > | null;
  status: BookingStatus;
  from: string | Date | null;
};

export function getKitCurrentBooking(
  request: Request,
  kit: {
    id: string;
    assets: {
      bookings: CurrentBookingType[];
    }[];
  }
) {
  const ongoingBookingAsset = kit.assets
    .map((a) => ({
      ...a,
      bookings: a.bookings.filter(
        (b) =>
          b.status === BookingStatus.ONGOING ||
          b.status === BookingStatus.OVERDUE
      ),
    }))
    .find((a) => a.bookings.length > 0);
  const ongoingBooking = ongoingBookingAsset
    ? ongoingBookingAsset.bookings[0]
    : undefined;

  let currentBooking: CurrentBookingType | null | undefined = null;

  if (ongoingBooking && ongoingBooking.from) {
    const bookingFrom = new Date(ongoingBooking.from);
    const bookingDateDisplay = getDateTimeFormat(request, {
      dateStyle: "short",
      timeStyle: "short",
    }).format(bookingFrom);

    currentBooking = { ...ongoingBooking, from: bookingDateDisplay };
  }
  return currentBooking;
}

export async function bulkDeleteKits({
  kitIds,
  organizationId,
  userId,
  currentSearchParams,
}: {
  kitIds: Kit["id"][];
  organizationId: Kit["organizationId"];
  userId: User["id"];
  currentSearchParams?: string | null;
}) {
  try {
    /**
     * If we are selecting all kits in the list then we have to consider filters too
     */
    const where: Prisma.KitWhereInput = kitIds.includes(ALL_SELECTED_KEY)
      ? getKitsWhereInput({ organizationId, currentSearchParams })
      : { id: { in: kitIds }, organizationId };

    /** We have to remove the images of the kits so we have to make this query */
    const kits = await db.kit.findMany({
      where,
      select: { id: true, image: true },
    });

    return await db.$transaction(async (tx) => {
      /** Deleting all kits */
      await tx.kit.deleteMany({
        where: { id: { in: kits.map((kit) => kit.id) } },
      });

      /** Deleting images of the kits (if any) */
      const kitWithImages = kits.filter((kit) => !!kit.image);

      await Promise.all(
        kitWithImages.map((kit) => deleteKitImage({ url: kit.image! }))
      );
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while bulk deleting kits.",
      additionalData: { kitIds, organizationId, userId },
      label,
    });
  }
}

export async function bulkAssignKitCustody({
  kitIds,
  organizationId,
  custodianId,
  custodianName,
  userId,
  currentSearchParams,
}: {
  kitIds: Kit["id"][];
  organizationId: Kit["organizationId"];
  custodianId: TeamMember["id"];
  custodianName: TeamMember["name"];
  userId: User["id"];
  currentSearchParams?: string | null;
}) {
  try {
    /**
     * If we are selecting all assets in list then we have to consider filters
     */
    const where: Prisma.KitWhereInput = kitIds.includes(ALL_SELECTED_KEY)
      ? getKitsWhereInput({ organizationId, currentSearchParams })
      : { id: { in: kitIds }, organizationId };

    /**
     * We have to make notes and assign custody to all assets of a kit so we have to make this query
     */
    const [kits, user] = await Promise.all([
      db.kit.findMany({
        where,
        select: {
          id: true,
          name: true,
          status: true,
          assets: {
            select: {
              id: true,
              title: true,
              status: true,
              kit: { select: { id: true, name: true } }, // we need this so that we can create notes
            },
          },
        },
      }),
      getUserByID(userId),
    ]);

    const someKitsNotAvailable = kits.some((kit) => kit.status !== "AVAILABLE");
    if (someKitsNotAvailable) {
      throw new ShelfError({
        cause: null,
        message:
          "There are some unavailable kits. Please make sure you are selecting only available kits.",
        label,
      });
    }

    const allAssetsOfAllKits = kits.flatMap((kit) => kit.assets);

    const someAssetsUnavailable = allAssetsOfAllKits.some(
      (asset) => asset.status !== "AVAILABLE"
    );
    if (someAssetsUnavailable) {
      throw new ShelfError({
        cause: null,
        message:
          "There are some unavailable assets in some kits. Please make sure you have all available assets in kits.",
        label,
      });
    }

    /**
     * updateMany does not allow to create nested relationship rows so we have
     * to make two queries to assign custody over
     * 1. Create custodies for kit
     * 2. Update status of all kits to IN_CUSTODY
     */
    return await db.$transaction(async (tx) => {
      /** Creating custodies over kits */
      await tx.kitCustody.createMany({
        data: kits.map((kit) => ({
          custodianId,
          kitId: kit.id,
        })),
      });

      /** Updating status of all kits */
      await tx.kit.updateMany({
        where: { id: { in: kits.map((kit) => kit.id) } },
        data: { status: KitStatus.IN_CUSTODY },
      });

      /** If a kit is going to be in custody, then all it's assets should also inherit the same status */

      /** Creating custodies over assets of kits */
      await tx.custody.createMany({
        data: allAssetsOfAllKits.map((asset) => ({
          teamMemberId: custodianId,
          assetId: asset.id,
        })),
      });

      /** Updating status of all assets of kits */
      await tx.asset.updateMany({
        where: { id: { in: allAssetsOfAllKits.map((asset) => asset.id) } },
        data: { status: AssetStatus.IN_CUSTODY },
      });

      /** Creating notes for all the assets of the kit */
      await tx.note.createMany({
        data: allAssetsOfAllKits.map((asset) => ({
          content: `**${user.firstName?.trim()} ${user.lastName?.trim()}** has given **${custodianName.trim()}** custody over **${asset.title.trim()}** via Kit assignment **[${asset
            ?.kit?.name}](/kits/${asset?.kit?.id})**`,
          type: "UPDATE",
          userId,
          assetId: asset.id,
        })),
      });
    });
  } catch (cause) {
    const message =
      cause instanceof ShelfError
        ? cause.message
        : "Something went wrong while bulk checking out kits.";

    throw new ShelfError({
      cause,
      message,
      additionalData: {
        kitIds,
        organizationId,
        userId,
        custodianId,
        custodianName,
      },
      label,
    });
  }
}

export async function bulkReleaseKitCustody({
  kitIds,
  organizationId,
  userId,
  currentSearchParams,
}: {
  kitIds: Kit["id"][];
  organizationId: Kit["organizationId"];
  userId: User["id"];
  currentSearchParams?: string | null;
}) {
  try {
    /** If we are selecting all, then we have to consider filters */
    const where: Prisma.KitWhereInput = kitIds.includes(ALL_SELECTED_KEY)
      ? getKitsWhereInput({ organizationId, currentSearchParams })
      : { id: { in: kitIds }, organizationId };

    /**
     * To make notes and release assets of kits we have to make this query
     */
    const [kits, user] = await Promise.all([
      db.kit.findMany({
        where,
        select: {
          id: true,
          status: true,
          custody: { select: { id: true, custodian: true } },
          assets: {
            select: {
              id: true,
              status: true,
              title: true,
              custody: { select: { id: true } },
              kit: { select: { id: true, name: true } }, // we need this so that we can create notes
            },
          },
        },
      }),
      getUserByID(userId),
    ]);

    const custodian = kits[0].custody?.custodian;

    /** Kits will be released only if all the selected kits are IN_CUSTODY */
    const allKitsInCustody = kits.every((kit) => kit.status === "IN_CUSTODY");
    if (!allKitsInCustody) {
      throw new ShelfError({
        cause: null,
        message:
          "There are some kits which are not in custody. Please make sure you are only selecting kits in custody to release them.",
        label,
      });
    }

    const allAssetsOfAllKits = kits.flatMap((kit) => kit.assets);

    return await db.$transaction(async (tx) => {
      /** Deleting all custodies of kits */
      await tx.kitCustody.deleteMany({
        where: {
          id: {
            in: kits.map((kit) => {
              invariant(kit.custody, "Custody not found over kit.");
              return kit.custody.id;
            }),
          },
        },
      });

      /** Updating status of all kits to AVAILABLE */
      await tx.kit.updateMany({
        where: { id: { in: kits.map((kit) => kit.id) } },
        data: { status: KitStatus.AVAILABLE },
      });

      /** Deleting all custodies of all assets of kits */
      await tx.custody.deleteMany({
        where: {
          id: {
            in: allAssetsOfAllKits.map((asset) => {
              /** This cause should not happen */
              invariant(asset.custody, "Custody not found over the asset");
              return asset.custody.id;
            }),
          },
        },
      });

      /** Making all the assets of the kit AVAILABLE */
      await tx.asset.updateMany({
        where: { id: { in: allAssetsOfAllKits.map((asset) => asset.id) } },
        data: { status: AssetStatus.AVAILABLE },
      });

      /** Creating notes for all the assets */
      await tx.note.createMany({
        data: allAssetsOfAllKits.map((asset) => ({
          content: `**${user.firstName?.trim()} ${user.lastName?.trim()}** has released **${custodian?.name}'s** custody over **${asset.title.trim()}** via Kit assignment **[${asset
            ?.kit?.name}](/kits/${asset?.kit?.id})**`,
          type: "UPDATE",
          userId,
          assetId: asset.id,
        })),
      });
    });
  } catch (cause) {
    const message =
      cause instanceof ShelfError
        ? cause.message
        : "Something went wrong while bulk releasing kits.";

    throw new ShelfError({
      cause,
      message,
      additionalData: { kitIds, organizationId, userId },
      label,
    });
  }
}

export async function createKitsIfNotExists({
  data,
  userId,
  organizationId,
}: {
  data: CreateAssetFromContentImportPayload[];
  userId: User["id"];
  organizationId: Organization["id"];
}): Promise<Record<string, Kit["id"]>> {
  try {
    // first we get all the kits from the assets and make then into an object where the category is the key and the value is an empty string
    const kits = new Map(
      data.filter((asset) => asset.kit !== "").map((asset) => [asset.kit, ""])
    );

    // Handle the case where there are no teamMembers
    if (kits.has(undefined)) {
      return {};
    }

    // now we loop through the kits and check if they exist
    for (const [kit, _] of kits) {
      const existingKit = await db.kit.findFirst({
        where: {
          name: { equals: kit, mode: "insensitive" },
          organizationId,
        },
      });

      if (!existingKit) {
        // if the location doesn't exist, we create a new one
        const newKit = await db.kit.create({
          data: {
            name: (kit as string).trim(),
            createdBy: {
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
        kits.set(kit, newKit.id);
      } else {
        // if the location exists, we just update the id
        kits.set(kit, existingKit.id);
      }
    }

    return Object.fromEntries(Array.from(kits));
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating kits. Seems like some of the location data in your import file is invalid. Please check and try again.",
      additionalData: { userId, organizationId },
      label,
      /** No need to capture those. They are mostly related to malformed CSV data */
      shouldBeCaptured: false,
    });
  }
}

export async function updateKitQrCode({
  kitId,
  newQrId,
  organizationId,
}: {
  organizationId: string;
  kitId: string;
  newQrId: string;
}) {
  // Disconnect all existing QR codes
  try {
    // Disconnect all existing QR codes
    await db.kit
      .update({
        where: { id: kitId, organizationId },
        data: {
          qrCodes: {
            set: [],
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Couldn't disconnect existing codes",
          label,
          additionalData: { kitId, organizationId, newQrId },
        });
      });

    // Connect the new QR code
    return await db.kit
      .update({
        where: { id: kitId, organizationId },
        data: {
          qrCodes: {
            connect: { id: newQrId },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Couldn't connect the new QR code",
          label,
          additionalData: { kitId, organizationId, newQrId },
        });
      });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while updating asset QR code",
      label,
      additionalData: { kitId, organizationId, newQrId },
    });
  }
}

export async function getAvailableKitAssetForBooking(
  kitIds: Kit["id"][]
): Promise<string[]> {
  try {
    const selectedKits = await db.kit.findMany({
      where: { id: { in: kitIds } },
      select: { assets: { select: { id: true, status: true } } },
    });

    const allAssets = selectedKits.flatMap((kit) => kit.assets);

    return allAssets.map((asset) => asset.id);
  } catch (cause: any) {
    throw new ShelfError({
      cause: cause,
      message:
        cause?.message ||
        "Something went wrong while getting available assets.",
      label: "Assets",
    });
  }
}
