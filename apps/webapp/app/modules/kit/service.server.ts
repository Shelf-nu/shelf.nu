import type {
  Asset,
  AssetIndexSettings,
  Barcode,
  Booking,
  Kit,
  Organization,
  Qr,
  TeamMember,
  User,
  UserOrganization,
} from "@shelf/database";
import {
  AssetStatus,
  BookingStatus,
  ErrorCorrection,
  KitStatus,
  NoteType,
} from "@shelf/database";
import type { LoaderFunctionArgs } from "react-router";
import invariant from "tiny-invariant";
import { db } from "~/database/db.server";
import {
  findMany,
  findFirst,
  findFirstOrThrow,
  findUnique,
  findUniqueOrThrow,
  create,
  update,
  remove,
  count,
  updateMany,
  deleteMany,
  createMany,
} from "~/database/query-helpers.server";
import { rpc } from "~/database/transaction.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import {
  updateBarcodes,
  validateBarcodeUniqueness,
} from "~/modules/barcode/service.server";
import { ASSET_MAX_IMAGE_UPLOAD_SIZE } from "~/utils/constants";
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
import {
  wrapCustodianForNote,
  wrapKitsWithDataForNote,
  wrapLinkForNote,
  wrapUserLinkForNote,
} from "~/utils/markdoc-wrappers";
import { oneDayFromNow } from "~/utils/one-week-from-now";
import { createSignedUrl, parseFileFormData } from "~/utils/storage.server";
import type { UpdateKitPayload } from "./types";
import {
  GET_KIT_STATIC_INCLUDES,
  KIT_SELECT_FIELDS_FOR_LIST_ITEMS,
  KITS_INCLUDE_FIELDS,
} from "./types";
import { getKitsWhereInput } from "./utils.server";
import { resolveAssetIdsForBulkOperation } from "../asset/bulk-operations-helper.server";
import type { CreateAssetFromContentImportPayload } from "../asset/types";
import {
  getAssetsWhereInput,
  getKitLocationUpdateNoteContent,
} from "../asset/utils.server";
import { createSystemLocationNote } from "../location-note/service.server";
import {
  createBulkKitChangeNotes,
  createNote,
  createNotes,
} from "../note/service.server";
import { getQr } from "../qr/service.server";
import { getUserByID } from "../user/service.server";

const label: ErrorLabel = "Kit";

export async function createKit({
  name,
  description,
  createdById,
  organizationId,
  qrId,
  categoryId,
  locationId,
  barcodes,
}: Pick<
  Kit,
  | "name"
  | "description"
  | "createdById"
  | "organizationId"
  | "categoryId"
  | "locationId"
> & {
  qrId?: Qr["id"];
  barcodes?: Pick<Barcode, "type" | "value">[];
}) {
  try {
    /**
     * If a qr code is passed, link to that QR
     * Otherwise, create a new one
     * Here we also need to double check:
     * 1. If the qr code exists
     * 2. If the qr code belongs to the current organization
     * 3. If the qr code is not linked to an asset
     */
    const qr = qrId ? await getQr({ id: qrId }) : null;
    const reuseExistingQr =
      qr &&
      qr.organizationId === organizationId &&
      qr.assetId === null &&
      qr.kitId === null;

    const kitData: Record<string, any> = {
      id: id(),
      name,
      description,
      createdById,
      organizationId,
      categoryId: categoryId || null,
      locationId: locationId || null,
    };

    const kit = await create(db, "Kit", kitData as any);

    // Link or create QR code
    if (reuseExistingQr) {
      await update(db, "Qr", {
        where: { id: qrId! },
        data: { kitId: kit.id },
      });
    } else {
      await create(db, "Qr", {
        id: id(),
        version: 0,
        errorCorrection: ErrorCorrection["L"],
        userId: createdById,
        organizationId: organizationId as string,
        kitId: kit.id,
      } as any);
    }

    /** If barcodes are passed, create them */
    if (barcodes && barcodes.length > 0) {
      const barcodesToAdd = barcodes.filter(
        (barcode) => !!barcode.value && !!barcode.type
      );

      if (barcodesToAdd.length > 0) {
        await createMany(
          db,
          "Barcode",
          barcodesToAdd.map(({ type, value }) => ({
            type,
            value: value.toUpperCase(),
            organizationId,
            kitId: kit.id,
          })) as any[]
        );
      }
    }

    return kit;
  } catch (cause) {
    // If it's a unique constraint violation on barcode values,
    // use our detailed validation to provide specific field errors
    const supabaseError = cause as any;
    const detail = supabaseError?.details || supabaseError?.message || "";

    if (
      detail.includes("unique") ||
      detail.includes("duplicate") ||
      supabaseError?.code === "23505"
    ) {
      if (detail.includes("value") && barcodes && barcodes.length > 0) {
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
  categoryId,
  barcodes,
  locationId,
}: UpdateKitPayload) {
  try {
    const data: Record<string, any> = {
      name,
      description,
      image,
      imageExpiration,
      status,
    };

    /** If uncategorized is passed, disconnect the category */
    if (categoryId === "uncategorized") {
      data.categoryId = null;
    }

    // If category id is passed and is different than uncategorized, connect the category
    if (categoryId && categoryId !== "uncategorized") {
      data.categoryId = categoryId;
    }

    if (locationId) {
      data.locationId = locationId;
    }

    const kit = await update(db, "Kit", {
      where: { id, organizationId },
      data,
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
    if (
      cause instanceof ShelfError &&
      cause.additionalData?.[VALIDATION_ERROR]
    ) {
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
      maxFileSize: ASSET_MAX_IMAGE_UPLOAD_SIZE,
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
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while updating image for kit.",
      additionalData: { kitId, userId, field: "image" },
      label,
    });
  }
}

export async function getPaginatedAndFilterableKits<
  T extends Record<string, any> | undefined = undefined,
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
  function hasAssetsIncluded(extraInclude?: Record<string, any>): boolean {
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

    const where: Record<string, any> = { organizationId };

    if (search) {
      const searchTerm = search.toLowerCase().trim();
      where.OR = [
        // Search in kit name
        { name: { contains: searchTerm, mode: "insensitive" } },
        // TODO: Supabase PostgREST doesn't support nested relation filters like barcodes.some
        // Search in barcode values - skipped for now
      ];
    }

    if (status) {
      where.status = status;
    }

    if (teamMember) {
      // TODO: Supabase PostgREST doesn't support nested relation filters like custody.custodianId
      // For now, we filter by custodianId in a separate query or post-filter
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

    // TODO: Complex nested includes (extraInclude, KITS_INCLUDE_FIELDS) are not directly
    // supported by Supabase PostgREST select. Using a select string that covers common fields.
    const selectStr =
      "*, KitCustody(*, TeamMember(*, User(id, firstName, lastName, profilePicture, email)))";

    let [kits, totalKits, totalKitsWithoutAssets] = await Promise.all([
      findMany(db, "Kit", {
        skip,
        take,
        where,
        select: selectStr,
        orderBy: { createdAt: "desc" },
      }),
      count(db, "Kit", where),
      // TODO: Supabase doesn't support `assets: { none: {} }` filter directly
      // Using 0 as placeholder - this count may need a raw RPC
      count(db, "Kit", { organizationId }),
    ]);

    if (hideUnavailable && hasAssetsIncluded(extraInclude)) {
      kits = kits.filter(
        // @ts-ignore
        (kit: any) => Array.isArray(kit.assets) && kit?.assets?.length > 0
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

// TODO: KitWithInclude used KitGetPayload — using `any` for now
type KitWithInclude<T extends Record<string, any> | undefined> = any;

export async function getKit<T extends Record<string, any> | undefined>({
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

    // TODO: Complex nested includes (GET_KIT_STATIC_INCLUDES + extraInclude) cannot be directly
    // mapped to Supabase PostgREST select. Using a broad select string.
    const selectStr = "*";

    const whereClause: Record<string, any> = {
      OR: [
        { id, organizationId },
        ...(userOrganizations?.length
          ? [{ id, organizationId: { in: otherOrganizationIds } }]
          : []),
      ],
    };

    const kit = await findFirstOrThrow(db, "Kit", {
      where: whereClause,
      select: selectStr,
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
  extraWhere?: Record<string, any>;
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

    const where: Record<string, any> = { organizationId, kitId };

    if (search && !ignoreFilters) {
      const searchTerm = search.toLowerCase().trim();
      where.OR = [
        // Search in asset title
        { title: { contains: searchTerm, mode: "insensitive" } },
        // TODO: Supabase PostgREST doesn't support nested relation filters like barcodes.some
      ];
    }

    const finalQuery = {
      ...where,
      ...extraWhere,
    };

    // TODO: KIT_SELECT_FIELDS_FOR_LIST_ITEMS is a Prisma select object;
    // using "*" with Supabase and letting the caller shape the data
    const [items, totalItems] = await Promise.all([
      findMany(db, "Asset", {
        skip,
        take,
        where: finalQuery,
        orderBy: { [orderBy]: orderDirection },
      }),
      count(db, "Asset", finalQuery),
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
    const deleted = await remove(db, "Kit", { id, organizationId });
    return deleted[0];
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
    // TODO: Complex nested select (assets, createdBy, custody.custodian.user) not directly
    // supported by query helpers. Fetching kit and related data separately.
    const [kit, actor] = await Promise.all([
      findUniqueOrThrow(db, "Kit", {
        where: { id: kitId, organizationId },
      }),
      getUserByID(userId, {
        select: {
          firstName: true,
          lastName: true,
        } satisfies Record<string, any>,
      }),
    ]);

    // Fetch kit's assets
    const kitAssets = await findMany(db, "Asset", {
      where: { kitId },
      select: "id, title",
    });

    // Fetch kit custody with custodian info
    const kitCustody = await findFirst(db, "KitCustody", {
      where: { kitId },
      select: "*, TeamMember(*, User(*))",
    });

    const actorLink = wrapUserLinkForNote({
      id: userId,
      firstName: actor?.firstName,
      lastName: actor?.lastName,
    });
    const custodianDisplay = (kitCustody as any)?.TeamMember
      ? wrapCustodianForNote({ teamMember: (kitCustody as any).TeamMember })
      : "**Unknown Custodian**";
    const kitLink = wrapLinkForNote(
      `/kits/${kit.id}`,
      (kit as any).name.trim()
    );

    const assetIds = kitAssets.map((a: any) => a.id);

    // Use RPC for atomicity - releases custody of kit and its assets
    await rpc(db, "kit_release_custody" as any, {
      p_kit_id: kitId,
      p_asset_ids: assetIds,
    });

    // Notes can be created outside transaction (not critical for consistency)
    await createNotes({
      content: `${actorLink} released ${custodianDisplay}'s custody via kit: ${kitLink}.`,
      type: "UPDATE",
      userId,
      assetIds,
    });

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

      /** A kit is not directly associated with booking so have to make an extra query to get the booking for kit.
       * We filter for assets that have an active booking to avoid picking
       * an asset in the kit that is AVAILABLE and has no relevant booking. */
      // TODO: Supabase PostgREST doesn't support nested relation filters (bookings.some).
      // Fetching kit assets and then filtering bookings in application code.
      const kitAssets = await findMany(db, "Asset", {
        where: { kitId: kit.id },
        select: "id",
      });

      // Find bookings for these assets that are ONGOING or OVERDUE
      let kitAsset: any = null;
      for (const asset of kitAssets) {
        const bookings = await findMany(db, "Booking" as any, {
          where: {
            status: { in: ["ONGOING", "OVERDUE"] },
          },
          // TODO: need to filter by asset association; using broad query for now
        });
        if (bookings.length > 0) {
          kitAsset = { ...asset, bookings };
          break;
        }
      }

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
  custodianUser: Pick<
    User,
    "firstName" | "lastName" | "profilePicture" | "email"
  > | null;
  custodianTeamMember: TeamMember | null;
  status: BookingStatus;
  from: Booking["from"];
};

/**
 * Determines if a kit has a current booking by checking its assets.
 * A kit is considered to have a current booking when at least one of its assets is:
 * 1. Currently checked out (status === CHECKED_OUT)
 * 2. Has an ongoing or overdue booking
 *
 * This ensures the custody card only shows when assets are actually in custody,
 * not just when they have ongoing bookings but have been checked back in.
 *
 * @returns The first ongoing/overdue booking found, or undefined if none exist
 */
export function getKitCurrentBooking(kit: {
  id: string;
  assets: {
    status: AssetStatus;
    bookings: CurrentBookingType[];
  }[];
}) {
  const ongoingBookingAsset = kit.assets
    // Filter each asset's bookings to only ongoing or overdue ones
    .map((a) => ({
      ...a,
      bookings: a.bookings.filter(
        (b) =>
          b.status === BookingStatus.ONGOING ||
          b.status === BookingStatus.OVERDUE
      ),
    }))
    // Only consider assets that are actually checked out
    .filter((a) => a.status === AssetStatus.CHECKED_OUT)
    // Find the first asset that has any ongoing/overdue bookings
    .find((a) => a.bookings.length > 0);

  const ongoingBooking = ongoingBookingAsset
    ? ongoingBookingAsset.bookings[0]
    : undefined;

  return ongoingBooking;
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
    const where: Record<string, any> = kitIds.includes(ALL_SELECTED_KEY)
      ? getKitsWhereInput({ organizationId, currentSearchParams })
      : { id: { in: kitIds }, organizationId };

    /** We have to remove the images of the kits so we have to make this query */
    const kits = await findMany(db, "Kit", {
      where,
      select: "id, image",
    });

    /** Deleting all kits */
    await deleteMany(db, "Kit", { id: { in: kits.map((kit: any) => kit.id) } });

    /** Deleting images of the kits (if any) */
    const kitWithImages = kits.filter((kit: any) => !!kit.image);

    await Promise.all(
      kitWithImages.map((kit: any) => deleteKitImage({ url: kit.image! }))
    );
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
    const where: Record<string, any> = kitIds.includes(ALL_SELECTED_KEY)
      ? getKitsWhereInput({ organizationId, currentSearchParams })
      : { id: { in: kitIds }, organizationId };

    /**
     * We have to make notes and assign custody to all assets of a kit so we have to make this query
     */
    // Fetch kits with their assets
    const [kitsRaw, user, custodianTeamMember] = await Promise.all([
      findMany(db, "Kit", {
        where,
        select: "id, name, status",
      }),
      getUserByID(userId, {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        } satisfies Record<string, any>,
      }),
      findUnique(db, "TeamMember", {
        where: { id: custodianId },
        select: "id, name, User(id, firstName, lastName)",
      }),
    ]);
    const kits = kitsRaw as any[];

    // Fetch assets for each kit
    const kitIds_resolved = kits.map((k: any) => k.id);
    const allAssetsOfAllKitsRaw = await findMany(db, "Asset", {
      where: { kitId: { in: kitIds_resolved } },
      select: "id, title, status, kitId",
    });
    const allAssetsOfAllKits = allAssetsOfAllKitsRaw as any[];

    // Attach kit info to assets for notes
    const kitMap = new Map(kits.map((k: any) => [k.id, k]));
    for (const asset of allAssetsOfAllKits) {
      asset.kit = kitMap.get(asset.kitId) || null;
    }

    const someKitsNotAvailable = kits.some(
      (kit: any) => kit.status !== "AVAILABLE"
    );
    if (someKitsNotAvailable) {
      throw new ShelfError({
        cause: null,
        message:
          "There are some unavailable kits. Please make sure you are selecting only available kits.",
        label,
      });
    }

    const someAssetsUnavailable = allAssetsOfAllKits.some(
      (asset: any) => asset.status !== "AVAILABLE"
    );
    if (someAssetsUnavailable) {
      throw new ShelfError({
        cause: null,
        message:
          "There are some unavailable assets in some kits. Please make sure you have all available assets in kits.",
        label,
      });
    }

    // Use RPC for each kit to assign custody atomically
    for (const kit of kits) {
      const kitAssetIds = allAssetsOfAllKits
        .filter((a: any) => a.kitId === kit.id)
        .map((a: any) => a.id);

      await rpc(db, "kit_assign_custody" as any, {
        p_kit_id: kit.id,
        p_custodian_id: custodianId,
        p_asset_ids: kitAssetIds,
      });
    }

    /** Creating notes for all the assets of the kit */
    const actor = wrapUserLinkForNote({
      id: userId,
      firstName: user?.firstName,
      lastName: user?.lastName,
    });
    const custodianDisplay = custodianTeamMember
      ? wrapCustodianForNote({ teamMember: custodianTeamMember as any })
      : `**${custodianName.trim()}**`;

    await createMany(
      db,
      "Note",
      allAssetsOfAllKits.map((asset: any) => {
        const kitLink = asset.kit
          ? wrapLinkForNote(`/kits/${asset.kit.id}`, asset.kit.name.trim())
          : "**Unknown Kit**";
        return {
          content: `${actor} granted ${custodianDisplay} custody via kit assignment ${kitLink}.`,
          type: "UPDATE",
          userId,
          assetId: asset.id,
        };
      })
    );
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
    const where: Record<string, any> = kitIds.includes(ALL_SELECTED_KEY)
      ? getKitsWhereInput({ organizationId, currentSearchParams })
      : { id: { in: kitIds }, organizationId };

    /**
     * To make notes and release assets of kits we have to make this query
     */
    // Fetch kits and their associated data
    const [kitsRaw, user] = await Promise.all([
      findMany(db, "Kit", {
        where,
        select: "id, status",
      }),
      getUserByID(userId, {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        } satisfies Record<string, any>,
      }),
    ]);
    const kits = kitsRaw as any[];

    // Fetch custody info for first kit's custodian (for notes)
    const firstKitCustody =
      kits.length > 0
        ? await findFirst(db, "KitCustody", {
            where: { kitId: kits[0].id },
            select: "*, TeamMember(*, User(*))",
          })
        : null;
    const custodian = (firstKitCustody as any)?.TeamMember || null;

    // Fetch all assets for these kits
    const kitIdsList = kits.map((k: any) => k.id);
    const allAssetsRaw = await findMany(db, "Asset", {
      where: { kitId: { in: kitIdsList } },
      select: "id, status, title, kitId",
    });
    const allAssetsOfAllKits = allAssetsRaw as any[];

    // Attach kit info to assets for notes
    const kitMap = new Map(kits.map((k: any) => [k.id, k]));
    for (const asset of allAssetsOfAllKits) {
      asset.kit = kitMap.get(asset.kitId) || null;
    }

    /** Kits will be released only if all the selected kits are IN_CUSTODY */
    const allKitsInCustody = kits.every(
      (kit: any) => kit.status === "IN_CUSTODY"
    );
    if (!allKitsInCustody) {
      throw new ShelfError({
        cause: null,
        message:
          "There are some kits which are not in custody. Please make sure you are only selecting kits in custody to release them.",
        label,
      });
    }

    // Use RPC for each kit to release custody atomically
    for (const kit of kits) {
      const kitAssetIds = allAssetsOfAllKits
        .filter((a: any) => a.kitId === kit.id)
        .map((a: any) => a.id);

      await rpc(db, "kit_release_custody" as any, {
        p_kit_id: kit.id,
        p_asset_ids: kitAssetIds,
      });
    }

    /** Creating notes for all the assets */
    const actor = wrapUserLinkForNote({
      id: userId,
      firstName: user?.firstName,
      lastName: user?.lastName,
    });
    const custodianDisplay = custodian
      ? wrapCustodianForNote({ teamMember: custodian })
      : "**Unknown Custodian**";

    await createMany(
      db,
      "Note",
      allAssetsOfAllKits.map((asset: any) => {
        const kitLink = asset.kit
          ? wrapLinkForNote(`/kits/${asset.kit.id}`, asset.kit.name.trim())
          : "**Unknown Kit**";
        return {
          content: `${actor} released ${custodianDisplay}'s custody via kit assignment ${kitLink}.`,
          type: "UPDATE",
          userId,
          assetId: asset.id,
        };
      })
    );
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
}): Promise<Record<string, Kit>> {
  try {
    // first we get all the kits from the assets and make then into an object where the category is the key and the value is an empty string
    // Normalize kit names so whitespace-only or padded values don't create phantom keys.
    const kitNames = Array.from(
      new Set(
        data
          .map((asset) => asset.kit?.trim())
          .filter((kit): kit is string => !!kit)
      )
    );

    // Handle the case where there are no kits
    if (kitNames.length === 0) {
      return {};
    }

    // now we loop through the kits and check if they exist
    const kits = new Map<string, Kit>();
    for (const kit of kitNames) {
      const existingKit = await findFirst(db, "Kit", {
        where: {
          name: { equals: kit, mode: "insensitive" },
          organizationId,
        },
      });

      if (!existingKit) {
        // if the kit doesn't exist, we create a new one
        const newKit = await create(db, "Kit", {
          name: kit.trim(),
          createdById: userId,
          organizationId,
        } as any);
        kits.set(kit, newKit as Kit);
      } else {
        // if the kit exists, we just update the id
        kits.set(kit, existingKit as Kit);
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
  try {
    // Disconnect all existing QR codes from this kit
    try {
      await updateMany(db, "Qr", {
        where: { kitId },
        data: { kitId: null },
      });
    } catch (cause) {
      throw new ShelfError({
        cause,
        message: "Couldn't disconnect existing codes",
        label,
        additionalData: { kitId, organizationId, newQrId },
      });
    }

    // Connect the new QR code
    try {
      return await update(db, "Qr", {
        where: { id: newQrId },
        data: { kitId },
      });
    } catch (cause) {
      throw new ShelfError({
        cause,
        message: "Couldn't connect the new QR code",
        label,
        additionalData: { kitId, organizationId, newQrId },
      });
    }
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while updating kit QR code",
      label,
      additionalData: { kitId, organizationId, newQrId },
    });
  }
}

/**
 * Relinks a kit to a different QR code, unlinking any previous code.
 * Throws when the QR belongs to another org or is already linked to an asset/kit.
 */
export async function relinkKitQrCode({
  qrId,
  kitId,
  organizationId,
  userId,
}: {
  qrId: Qr["id"];
  kitId: Kit["id"];
  organizationId: Organization["id"];
  userId: User["id"];
}) {
  const [qr, kitRaw] = await Promise.all([
    getQr({ id: qrId }),
    findFirst(db, "Kit", {
      where: { id: kitId, organizationId },
    }),
  ]);
  // Fetch QR codes for this kit separately
  const kitQrCodes = await findMany(db, "Qr", {
    where: { kitId },
    select: "id",
  });
  const kit = kitRaw ? { ...kitRaw, qrCodes: kitQrCodes } : null;

  if (!kit) {
    throw new ShelfError({
      cause: null,
      message: "Kit not found.",
      label,
      additionalData: { kitId, organizationId, qrId },
    });
  }

  if (qr.organizationId && qr.organizationId !== organizationId) {
    throw new ShelfError({
      cause: null,
      title: "QR not valid.",
      message: "This QR code does not belong to your organization",
      label,
    });
  }

  if (qr.assetId) {
    throw new ShelfError({
      cause: null,
      title: "QR already linked.",
      message:
        "You cannot link to this code because its already linked to another asset. Delete the other asset to free up the code and try again.",
      label,
      shouldBeCaptured: false,
    });
  }

  if (qr.kitId && qr.kitId !== kitId) {
    throw new ShelfError({
      cause: null,
      title: "QR already linked.",
      message:
        "You cannot link to this code because its already linked to another kit. Delete the other kit to free up the code and try again.",
      label,
      shouldBeCaptured: false,
    });
  }

  const oldQrCode = (kit as any).qrCodes[0];

  await Promise.all([
    update(db, "Qr", {
      where: { id: qr.id },
      data: { organizationId, userId },
    }),
    updateKitQrCode({
      kitId,
      newQrId: qr.id,
      organizationId,
    }),
  ]);

  return {
    oldQrCodeId: oldQrCode?.id,
    newQrId: qr.id,
  };
}

export async function getAvailableKitAssetForBooking(
  kitIds: Kit["id"][]
): Promise<string[]> {
  try {
    // Fetch assets belonging to the given kits
    const allAssets = await findMany(db, "Asset", {
      where: { kitId: { in: kitIds } },
      select: "id, status",
    });

    return allAssets.map((asset: any) => asset.id);
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

export async function updateKitLocation({
  id,
  organizationId,
  currentLocationId,
  newLocationId,
  userId,
}: {
  id: Kit["id"];
  organizationId: Kit["organizationId"];
  currentLocationId: Kit["locationId"];
  newLocationId: Kit["locationId"];
  userId?: User["id"];
}) {
  try {
    // Get kit first
    const kit = await findUnique(db, "Kit", {
      where: { id, organizationId },
    });

    if (!kit) {
      throw new ShelfError({
        cause: null,
        message: "Kit not found",
        label,
      });
    }

    // Fetch kit's assets with location info
    const kitAssets = (await findMany(db, "Asset", {
      where: { kitId: id },
      select: "id, title, locationId",
    })) as any[];

    // Fetch location names for assets that have them
    const locationIds = [
      ...new Set(kitAssets.map((a: any) => a.locationId).filter(Boolean)),
    ];
    const locations =
      locationIds.length > 0
        ? await findMany(db, "Location", {
            where: { id: { in: locationIds } },
            select: "id, name",
          })
        : [];
    const locationMap = new Map(
      (locations as any[]).map((l: any) => [l.id, l])
    );

    // Attach location to assets
    const assetsWithLocation = kitAssets.map((a: any) => ({
      ...a,
      location: a.locationId ? locationMap.get(a.locationId) || null : null,
    }));

    const assetIds = kitAssets.map((asset: any) => asset.id);

    if (newLocationId) {
      // Update kit and its assets to the new location
      await update(db, "Kit", {
        where: { id },
        data: { locationId: newLocationId },
      });

      if (assetIds.length > 0) {
        await updateMany(db, "Asset", {
          where: { id: { in: assetIds } },
          data: { locationId: newLocationId },
        });
      }

      // Add notes to assets about location update via parent kit
      if (userId && assetIds.length > 0) {
        const user = await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          } satisfies Record<string, any>,
        });
        const location = await findUnique(db, "Location", {
          where: { id: newLocationId },
          select: "name, id",
        });

        // Create individual notes for each asset
        await Promise.all(
          assetsWithLocation.map((asset: any) =>
            createNote({
              content: getKitLocationUpdateNoteContent({
                currentLocation: asset.location, // Use the asset's current location
                newLocation: location,
                userId,
                firstName: user?.firstName ?? "",
                lastName: user?.lastName ?? "",
                isRemoving: false,
              }),
              type: "UPDATE",
              userId,
              assetId: asset.id,
            })
          )
        );
      }
    } else if (!newLocationId && currentLocationId) {
      // Remove location from kit and its assets
      await update(db, "Kit", {
        where: { id },
        data: { locationId: null },
      });

      if (assetIds.length > 0) {
        await updateMany(db, "Asset", {
          where: { id: { in: assetIds } },
          data: { locationId: null },
        });
      }

      // Add notes to assets about location removal via parent kit
      if (userId && assetIds.length > 0) {
        const user = await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          } satisfies Record<string, any>,
        });
        const currentLocation = await findUnique(db, "Location", {
          where: { id: currentLocationId },
          select: "name, id",
        });

        // Create individual notes for each asset
        await Promise.all(
          assetsWithLocation.map((asset: any) =>
            createNote({
              content: getKitLocationUpdateNoteContent({
                currentLocation: currentLocation,
                newLocation: null,
                userId,
                firstName: user?.firstName ?? "",
                lastName: user?.lastName ?? "",
                isRemoving: true,
              }),
              type: "UPDATE",
              userId,
              assetId: asset.id,
            })
          )
        );
      }
    }

    // Return the updated kit
    return await findUnique(db, "Kit", {
      where: { id, organizationId },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while updating kit location",
      label,
    });
  }
}

export async function bulkUpdateKitLocation({
  kitIds,
  organizationId,
  newLocationId,
  currentSearchParams,
  userId,
}: {
  kitIds: Array<Kit["id"]>;
  organizationId: Kit["organizationId"];
  newLocationId: Kit["locationId"];
  currentSearchParams?: string | null;
  userId: User["id"];
}) {
  try {
    const where: Record<string, any> = kitIds.includes(ALL_SELECTED_KEY)
      ? getKitsWhereInput({ organizationId, currentSearchParams })
      : { id: { in: kitIds }, organizationId };

    // Get kits with their assets before updating
    const kitsRaw = (await findMany(db, "Kit", {
      where,
      select: "id, name, locationId",
    })) as any[];

    // Fetch locations for kits
    const kitLocationIds = [
      ...new Set(kitsRaw.map((k: any) => k.locationId).filter(Boolean)),
    ];
    const kitLocations =
      kitLocationIds.length > 0
        ? await findMany(db, "Location", {
            where: { id: { in: kitLocationIds } },
            select: "id, name",
          })
        : [];
    const kitLocMap = new Map(
      (kitLocations as any[]).map((l: any) => [l.id, l])
    );

    // Fetch assets for these kits
    const kitIdsForAssets = kitsRaw.map((k: any) => k.id);
    const allAssetsRaw =
      kitIdsForAssets.length > 0
        ? await findMany(db, "Asset", {
            where: { kitId: { in: kitIdsForAssets } },
            select: "id, title, locationId, kitId",
          })
        : [];

    // Fetch locations for assets
    const assetLocIds = [
      ...new Set(
        (allAssetsRaw as any[]).map((a: any) => a.locationId).filter(Boolean)
      ),
    ];
    const assetLocations =
      assetLocIds.length > 0
        ? await findMany(db, "Location", {
            where: { id: { in: assetLocIds } },
            select: "id, name",
          })
        : [];
    const assetLocMap = new Map(
      (assetLocations as any[]).map((l: any) => [l.id, l])
    );

    // Build kitsWithAssets structure
    const kitsWithAssets = kitsRaw.map((k: any) => ({
      ...k,
      location: k.locationId ? kitLocMap.get(k.locationId) || null : null,
      assets: (allAssetsRaw as any[])
        .filter((a: any) => a.kitId === k.id)
        .map((a: any) => ({
          ...a,
          location: a.locationId ? assetLocMap.get(a.locationId) || null : null,
        })),
    }));

    const actualKitIds = kitsWithAssets.map((kit: any) => kit.id);
    const allAssets = kitsWithAssets.flatMap((kit: any) => kit.assets);

    if (
      newLocationId &&
      newLocationId.trim() !== "" &&
      actualKitIds.length > 0
    ) {
      // Update kits and their assets to the new location
      await updateMany(db, "Kit", {
        where: { id: { in: actualKitIds } },
        data: { locationId: newLocationId },
      });

      if (allAssets.length > 0) {
        await updateMany(db, "Asset", {
          where: { id: { in: allAssets.map((a: any) => a.id) } },
          data: { locationId: newLocationId },
        });
      }

      // Create notes for affected assets
      if (allAssets.length > 0) {
        const user = await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          } satisfies Record<string, any>,
        });
        const location = await findUnique(db, "Location", {
          where: { id: newLocationId },
          select: "name, id",
        });

        // Create individual notes for each asset
        await Promise.all(
          allAssets.map((asset: any) =>
            createNote({
              content: getKitLocationUpdateNoteContent({
                currentLocation: asset.location,
                newLocation: location,
                userId,
                firstName: user?.firstName ?? "",
                lastName: user?.lastName ?? "",
                isRemoving: false,
              }),
              type: "UPDATE",
              userId,
              assetId: asset.id,
            })
          )
        );
      }
    } else {
      // Removing location - set to null and handle cascade
      await updateMany(db, "Kit", {
        where: { id: { in: actualKitIds } },
        data: { locationId: null },
      });

      // Also remove location from assets and create notes
      if (allAssets.length > 0) {
        const user = await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          } satisfies Record<string, any>,
        });

        await updateMany(db, "Asset", {
          where: { id: { in: allAssets.map((asset: any) => asset.id) } },
          data: { locationId: null },
        });

        // Create individual notes for each asset
        await Promise.all(
          allAssets.map((asset: any) =>
            createNote({
              content: getKitLocationUpdateNoteContent({
                currentLocation: asset.location,
                newLocation: null,
                userId,
                firstName: user?.firstName ?? "",
                lastName: user?.lastName ?? "",
                isRemoving: true,
              }),
              type: "UPDATE",
              userId,
              assetId: asset.id,
            })
          )
        );
      }
    }

    // Create location activity notes
    const userForNote = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
      } satisfies Record<string, any>,
    });
    const userLink = wrapUserLinkForNote({
      id: userId,
      firstName: userForNote?.firstName,
      lastName: userForNote?.lastName,
    });

    if (newLocationId && newLocationId.trim() !== "") {
      const location = await findUnique(db, "Location", {
        where: { id: newLocationId },
        select: "id, name",
      });

      if (location) {
        const locLink = wrapLinkForNote(
          `/locations/${location.id}`,
          location.name
        );

        // Only count kits not already at the target location
        const actuallyMovedKits = kitsWithAssets.filter(
          (k) => k.locationId !== newLocationId
        );

        if (actuallyMovedKits.length > 0) {
          const kitData = actuallyMovedKits.map((k) => ({
            id: k.id,
            name: k.name,
          }));
          const kitMarkup = wrapKitsWithDataForNote(kitData, "added");
          await createSystemLocationNote({
            locationId: location.id,
            content: `${userLink} added ${kitMarkup} to ${locLink}.`,
            userId,
          });
        }

        // Removal notes on previous locations
        const byPrevLoc = new Map<
          string,
          { name: string; kits: Array<{ id: string; name: string }> }
        >();
        for (const kit of actuallyMovedKits) {
          if (!kit.locationId || kit.locationId === newLocationId) continue;
          const prevLocName = kit.location?.name ?? "Unknown location";
          const prevLocId = kit.locationId;
          const existing = byPrevLoc.get(prevLocId);
          if (existing) {
            existing.kits.push({ id: kit.id, name: kit.name });
          } else {
            byPrevLoc.set(prevLocId, {
              name: prevLocName,
              kits: [{ id: kit.id, name: kit.name }],
            });
          }
        }
        for (const [locId, { name, kits }] of byPrevLoc) {
          const prevLocLink = wrapLinkForNote(`/locations/${locId}`, name);
          const kitMarkup = wrapKitsWithDataForNote(kits, "removed");
          const movedTo = ` Moved to ${locLink}.`;
          await createSystemLocationNote({
            locationId: locId,
            content: `${userLink} removed ${kitMarkup} from ${prevLocLink}.${movedTo}`,
            userId,
          });
        }
      }
    } else {
      // Kits removed from location — create removal notes
      const byPrevLoc = new Map<
        string,
        { name: string; kits: Array<{ id: string; name: string }> }
      >();
      for (const kit of kitsWithAssets) {
        if (!kit.locationId) continue;
        const prevLocName = kit.location?.name ?? "Unknown location";
        const existing = byPrevLoc.get(kit.locationId);
        if (existing) {
          existing.kits.push({ id: kit.id, name: kit.name });
        } else {
          byPrevLoc.set(kit.locationId, {
            name: prevLocName,
            kits: [{ id: kit.id, name: kit.name }],
          });
        }
      }
      for (const [locId, { name, kits }] of byPrevLoc) {
        const prevLocLink = wrapLinkForNote(`/locations/${locId}`, name);
        const kitMarkup = wrapKitsWithDataForNote(kits, "removed");
        await createSystemLocationNote({
          locationId: locId,
          content: `${userLink} removed ${kitMarkup} from ${prevLocLink}.`,
          userId,
        });
      }
    }

    return { count: actualKitIds.length };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while updating kit location",
      label,
    });
  }
}

export async function updateKitAssets({
  kitId,
  organizationId,
  userId,
  assetIds,
  request,
  addOnly = false,
}: {
  kitId: Kit["id"];
  organizationId: Organization["id"];
  userId: User["id"];
  assetIds: Asset["id"][];
  request: Request;
  addOnly?: boolean; // If true, only add assets, don't remove existing ones
}) {
  try {
    const user = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
      } satisfies Record<string, any>,
    });
    const actor = wrapUserLinkForNote({
      id: userId,
      firstName: user?.firstName,
      lastName: user?.lastName,
    });

    // Fetch kit
    let kitRaw: any;
    try {
      kitRaw = await findUniqueOrThrow(db, "Kit", {
        where: { id: kitId, organizationId },
      });
    } catch (cause) {
      throw new ShelfError({
        cause,
        message: "Kit not found",
        additionalData: { kitId, userId, organizationId },
        status: 404,
        label: "Kit",
      });
    }

    // Fetch related data for kit
    const [kitLocation, kitAssetsRaw, kitCustody] = await Promise.all([
      kitRaw.locationId
        ? findUnique(db, "Location", {
            where: { id: kitRaw.locationId },
            select: "id, name",
          })
        : null,
      findMany(db, "Asset", {
        where: { kitId },
        select: "id, title, kitId",
      }),
      findFirst(db, "KitCustody", {
        where: { kitId },
        select:
          "*, TeamMember(id, name, User(id, email, firstName, lastName, profilePicture))",
      }),
    ]);

    // Fetch bookings for kit assets
    // TODO: Booking-Asset is a many-to-many through _AssetToBooking; PostgREST can't filter this directly.
    // Building a simplified kit object with the data we have.
    const kitAssetsList = kitAssetsRaw as any[];
    const kitAssetsWithBookings = await Promise.all(
      kitAssetsList.map(async (asset: any) => {
        // TODO: This is a simplified approach; booking data may need an RPC for proper join
        return { ...asset, kit: kitRaw, bookings: [] as any[] };
      })
    );

    const kit = {
      ...kitRaw,
      location: kitLocation,
      assets: kitAssetsWithBookings,
      custody: kitCustody
        ? { custodian: (kitCustody as any).TeamMember }
        : null,
      status: kitRaw.status,
    } as any;

    const kitCustodianDisplay = kit.custody?.custodian
      ? wrapCustodianForNote({ teamMember: kit.custody.custodian })
      : undefined;

    const removedAssets = kit.assets.filter(
      (asset: any) => !assetIds.includes(asset.id)
    );

    /**
     * If user has selected all assets, then we have to get ids of all those assets
     * with respect to the filters applied.
     * */
    const hasSelectedAll = assetIds.includes(ALL_SELECTED_KEY);
    if (hasSelectedAll) {
      const searchParams = getCurrentSearchParams(request);
      const assetsWhere = getAssetsWhereInput({
        organizationId,
        currentSearchParams: searchParams.toString(),
      });

      const allAssets = await findMany(db, "Asset", {
        where: assetsWhere,
        select: "id",
      });
      const kitAssets = kit.assets.map((asset: any) => asset.id);
      const removedAssetsIds = removedAssets.map((asset: any) => asset.id);

      /**
       * New assets that needs to be added are
       * - Previously added assets
       * - All assets with applied filters
       */
      assetIds = [
        ...new Set([
          ...allAssets.map((asset: any) => asset.id),
          ...kitAssets.filter(
            (asset: any) => !removedAssetsIds.includes(asset)
          ),
        ]),
      ];
    }

    // Get all assets that should be in the kit (based on assetIds) with organization scoping
    let allAssetsForKit: any[];
    try {
      const assetsRaw = await findMany(db, "Asset", {
        where: { id: { in: assetIds }, organizationId },
        select: "id, title, kitId, locationId",
      });
      // Fetch custody and location for these assets
      const assetIdsForCustody = (assetsRaw as any[]).map((a: any) => a.id);
      const [custodies, assetLocationIds] = await Promise.all([
        findMany(db, "Custody", {
          where: { assetId: { in: assetIdsForCustody } },
        }),
        Promise.resolve([
          ...new Set(
            (assetsRaw as any[]).map((a: any) => a.locationId).filter(Boolean)
          ),
        ]),
      ]);
      const assetLocs =
        (assetLocationIds as string[]).length > 0
          ? await findMany(db, "Location", {
              where: { id: { in: assetLocationIds as string[] } },
              select: "id, name",
            })
          : [];
      const locMap = new Map((assetLocs as any[]).map((l: any) => [l.id, l]));
      const custodyMap = new Map(
        (custodies as any[]).map((c: any) => [c.assetId, c])
      );

      allAssetsForKit = (assetsRaw as any[]).map((a: any) => ({
        ...a,
        kit: a.kitId ? { id: a.kitId } : null,
        custody: custodyMap.get(a.id) || null,
        location: a.locationId ? locMap.get(a.locationId) || null : null,
      }));
    } catch (cause) {
      throw new ShelfError({
        cause,
        message:
          "Something went wrong while fetching the assets. Please try again or contact support.",
        additionalData: { assetIds, userId, kitId },
        label: "Kit",
      });
    }

    // Identify which assets are actually new (not already in this kit)
    const newlyAddedAssets = allAssetsForKit.filter(
      (asset) =>
        !kit.assets.some((existingAsset) => existingAsset.id === asset.id)
    );

    /** An asset already in custody cannot be added to a kit */
    const isSomeAssetInCustody = newlyAddedAssets.some(
      (asset) => asset.custody && asset.kit?.id !== kit.id
    );
    if (isSomeAssetInCustody) {
      throw new ShelfError({
        cause: null,
        message:
          "Cannot add assets that are already in custody to a kit. Please release custody of assets to allow them to be added to a kit.",
        additionalData: { userId, kitId },
        label: "Kit",
        shouldBeCaptured: false,
      });
    }

    const kitBookings =
      kit.assets.find((a: any) => a.bookings.length > 0)?.bookings ?? [];

    // Update asset kit assignments using direct updates instead of connect/disconnect
    const addAssetIds = newlyAddedAssets.map((a: any) => a.id);
    const removeAssetIds =
      !addOnly && removedAssets.length > 0
        ? removedAssets.map((a: any) => a.id)
        : [];

    // Use RPC for atomic kit update with assets
    await rpc(db, "kit_update_with_assets" as any, {
      p_kit_id: kit.id,
      p_data: {},
      p_add_asset_ids: addAssetIds,
      p_remove_asset_ids: removeAssetIds,
    });

    await createBulkKitChangeNotes({
      kit,
      newlyAddedAssets,
      removedAssets: addOnly ? [] : removedAssets, // In addOnly mode, no assets are removed
      userId,
    });

    // Handle location cascade for newly added assets (after kit assignment notes)
    if (newlyAddedAssets.length > 0) {
      if (kit.location) {
        // Kit has a location, update all newly added assets to that location
        await updateMany(db, "Asset", {
          where: { id: { in: newlyAddedAssets.map((asset: any) => asset.id) } },
          data: { locationId: kit.location.id },
        });

        // Create notes for assets that had their location changed
        const user = await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          } satisfies Record<string, any>,
        });
        await Promise.all(
          newlyAddedAssets.map((asset) =>
            createNote({
              content: getKitLocationUpdateNoteContent({
                currentLocation: asset.location,
                newLocation: kit.location,
                userId,
                firstName: user?.firstName ?? "",
                lastName: user?.lastName ?? "",
                isRemoving: false,
              }),
              type: "UPDATE",
              userId,
              assetId: asset.id,
            })
          )
        );
      } else {
        // Kit has no location, remove location from newly added assets
        const assetsWithLocation = newlyAddedAssets.filter(
          (asset) => asset.location
        );

        if (assetsWithLocation.length > 0) {
          await updateMany(db, "Asset", {
            where: {
              id: { in: assetsWithLocation.map((asset: any) => asset.id) },
            },
            data: { locationId: null },
          });

          // Create notes for assets that had their location removed
          const user = await getUserByID(userId, {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            } satisfies Record<string, any>,
          });
          await Promise.all(
            assetsWithLocation.map((asset) =>
              createNote({
                content: getKitLocationUpdateNoteContent({
                  currentLocation: asset.location,
                  newLocation: null,
                  userId,
                  firstName: user?.firstName ?? "",
                  lastName: user?.lastName ?? "",
                  isRemoving: true,
                }),
                type: "UPDATE",
                userId,
                assetId: asset.id,
              })
            )
          );
        }
      }
    }

    /**
     * If a kit is in custody then the assets added to kit will also inherit the status
     */
    const assetsToInheritStatus = newlyAddedAssets.filter(
      (asset) => !asset.custody
    );

    if (
      kit.custody &&
      kit.custody.custodian.id &&
      assetsToInheritStatus.length > 0
    ) {
      // Update custody for all assets to inherit kit's custody
      const custodianId = kit.custody?.custodian.id;
      await Promise.all(
        assetsToInheritStatus.map(async (asset: any) => {
          await update(db, "Asset", {
            where: { id: asset.id },
            data: { status: AssetStatus.IN_CUSTODY },
          });
          await create(db, "Custody", {
            teamMemberId: custodianId,
            assetId: asset.id,
          } as any);
        })
      );

      // Create notes for all assets that inherited custody
      const custodianDisplay = kitCustodianDisplay ?? "**Unknown Custodian**";
      await createNotes({
        content: `${actor} granted ${custodianDisplay} custody.`,
        type: NoteType.UPDATE,
        userId,
        assetIds: assetsToInheritStatus.map((asset) => asset.id),
      });
    }

    /**
     * If a kit is in custody and some assets are removed,
     * then we have to make the removed assets Available
     * Only apply this when not in addOnly mode
     */
    if (!addOnly && removedAssets.length && kit.custody?.custodian.id) {
      const custodianDisplay = kitCustodianDisplay ?? "**Unknown Custodian**";
      const assetIds = removedAssets.map((a) => a.id);

      // Delete custody records and update asset status
      await deleteMany(db, "Custody", { assetId: { in: assetIds } });

      await updateMany(db, "Asset", {
        where: { id: { in: assetIds }, organizationId },
        data: { status: AssetStatus.AVAILABLE },
      });

      // Notes can be created outside transaction (not critical for consistency)
      await createNotes({
        content: `${actor} released ${custodianDisplay}'s custody.`,
        type: NoteType.UPDATE,
        userId,
        assetIds,
      });
    }

    /**
     * If user is adding/removing an asset to a kit which is a part of DRAFT, RESERVED, ONGOING or OVERDUE booking,
     * then we have to add or remove these assets to booking also
     */
    const bookingsToUpdate = kitBookings.filter(
      (b) =>
        b.status === "DRAFT" ||
        b.status === "RESERVED" ||
        b.status === "ONGOING" ||
        b.status === "OVERDUE"
    );

    // TODO: Booking-Asset is a many-to-many join table (_AssetToBooking).
    // PostgREST can't do connect/disconnect on join tables directly.
    // This would need a custom RPC or direct join table manipulation.
    if (bookingsToUpdate?.length) {
      // For now, this is a no-op. Booking-asset associations need an RPC.
      // await Promise.all(bookingsToUpdate.map(...));
    }

    /**
     * If the kit is part of an ONGOING booking, then we have to make all
     * the assets CHECKED_OUT
     */
    if (kit.status === KitStatus.CHECKED_OUT) {
      await updateMany(db, "Asset", {
        where: { id: { in: newlyAddedAssets.map((a: any) => a.id) } },
        data: { status: AssetStatus.CHECKED_OUT },
      });
    }

    return kit;
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);

    throw new ShelfError({
      cause,
      message: isShelfError
        ? cause.message
        : "Something went wrong while updating kit assets.",
      label,
      additionalData: { kitId, assetIds },
    });
  }
}

export async function bulkRemoveAssetsFromKits({
  assetIds,
  organizationId,
  userId,
  request,
  settings,
}: {
  assetIds: Asset["id"][];
  organizationId: Organization["id"];
  userId: User["id"];
  request: Request;
  settings: AssetIndexSettings;
}) {
  try {
    const user = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
      } satisfies Record<string, any>,
    });
    const actor = wrapUserLinkForNote({
      id: userId,
      firstName: user?.firstName,
      lastName: user?.lastName,
    });

    // Resolve IDs (works for both simple and advanced mode)
    const searchParams = getCurrentSearchParams(request);
    const resolvedIds = await resolveAssetIdsForBulkOperation({
      assetIds,
      organizationId,
      currentSearchParams: searchParams.toString(),
      settings,
    });

    const assets = await db.asset.findMany({
      where: { id: { in: resolvedIds }, organizationId },
      select: {
        id: true,
        title: true,
        kit: {
          select: { id: true, name: true, custody: { select: { id: true } } },
        },
        custody: {
          select: {
            id: true,
            custodian: {
              select: {
                name: true,
                user: {
                  select: { id: true, firstName: true, lastName: true },
                },
              },
            },
          },
        },
      },
    });

    await db.$transaction(async (tx) => {
      /**
       * If there are assets whose kits were in custody, then we have to remove the custody FIRST
       * to avoid orphaned custody records when status is set to AVAILABLE
       */
      const assetsWhoseKitsInCustody = assets.filter(
        (asset) => !!asset.kit?.custody && asset.custody
      );

      const custodyIdsToDelete = assetsWhoseKitsInCustody.map((a) => {
        invariant(a.custody, "Custody not found over asset");
        return a.custody.id;
      });

      if (custodyIdsToDelete.length > 0) {
        await tx.custody.deleteMany({
          where: { id: { in: custodyIdsToDelete } },
        });
      }

      /** Removing assets from kits - AFTER custody is deleted */
      await tx.asset.updateMany({
        where: { id: { in: assets.map((a) => a.id) } },
        data: { kitId: null, status: AssetStatus.AVAILABLE },
      });

      /** Create notes for assets released from custody */
      if (assetsWhoseKitsInCustody.length > 0) {
        await tx.note.createMany({
          data: assetsWhoseKitsInCustody.map((asset) => {
            const custodianDisplay = asset.custody?.custodian
              ? wrapCustodianForNote({
                  teamMember: asset.custody.custodian,
                })
              : "**Unknown Custodian**";
            return {
              content: `${actor} released ${custodianDisplay}'s custody.`,
              type: "UPDATE",
              userId,
              assetId: asset.id,
            };
          }),
        });
      }

      /** Create notes for assets removed from kit */
      const assetsRemovedFromKit = assets.filter((asset) => asset.kit);
      if (assetsRemovedFromKit.length > 0) {
        await tx.note.createMany({
          data: assetsRemovedFromKit.map((asset) => {
            const kitLink = wrapLinkForNote(
              `/kits/${asset.kit!.id}`,
              asset.kit!.name.trim()
            );
            return {
              content: `${actor} removed asset from ${kitLink}.`,
              type: "UPDATE",
              userId,
              assetId: asset.id,
            };
          }),
        });
      }
    });

    return true;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to bulk remove assets from kits",
      additionalData: { assetIds, organizationId, userId },
      label: "Kit",
    });
  }
}
