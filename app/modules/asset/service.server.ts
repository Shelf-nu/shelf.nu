import type {
  Category,
  Location,
  Note,
  Qr,
  Asset,
  User,
  Tag,
  Organization,
  TeamMember,
  Booking,
  Kit,
  AssetIndexSettings,
  UserOrganization,
} from "@prisma/client";
import {
  AssetStatus,
  BookingStatus,
  ErrorCorrection,
  Prisma,
} from "@prisma/client";
import { redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { LRUCache } from "lru-cache";
import type {
  SortingDirection,
  SortingOptions,
} from "~/components/list/filters/sort-by";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { createCategoriesIfNotExists } from "~/modules/category/service.server";
import {
  createCustomFieldsIfNotExists,
  getActiveCustomFields,
  upsertCustomField,
} from "~/modules/custom-field/service.server";
import type { CustomFieldDraftPayload } from "~/modules/custom-field/types";
import { createLocationsIfNotExists } from "~/modules/location/service.server";
import { getQr, parseQrCodesFromImportData } from "~/modules/qr/service.server";
import { createTagsIfNotExists } from "~/modules/tag/service.server";
import {
  createTeamMemberIfNotExists,
  getTeamMemberForCustodianFilter,
} from "~/modules/team-member/service.server";
import type { AllowedModelNames } from "~/routes/api+/model-filters";

import { LEGACY_CUID_LENGTH } from "~/utils/constants";
import {
  getFiltersFromRequest,
  setCookie,
  updateCookieWithPerPage,
  userPrefs,
} from "~/utils/cookies.server";
import {
  buildCustomFieldValue,
  extractCustomFieldValuesFromPayload,
  getDefinitionFromCsvHeader,
} from "~/utils/custom-fields";
import { dateTimeInUnix } from "~/utils/date-time-in-unix";
import type { ErrorLabel } from "~/utils/error";
import {
  ShelfError,
  isLikeShelfError,
  isNotFoundError,
  maybeUniqueConstraintViolation,
} from "~/utils/error";
import { getRedirectUrlFromRequest } from "~/utils/http";
import { getCurrentSearchParams } from "~/utils/http.server";
import { id } from "~/utils/id/id.server";
import * as importImageCacheServer from "~/utils/import.image-cache.server";
import type { CachedImage } from "~/utils/import.image-cache.server";
import { ALL_SELECTED_KEY, getParamsValues } from "~/utils/list";
import { Logger } from "~/utils/logger";
import { isValidImageUrl } from "~/utils/misc";
import { oneDayFromNow } from "~/utils/one-week-from-now";
import {
  createSignedUrl,
  parseFileFormData,
  uploadImageFromUrl,
} from "~/utils/storage.server";

import { resolveTeamMemberName } from "~/utils/user";
import { assetIndexFields } from "./fields";
import {
  assetQueryFragment,
  assetQueryJoins,
  assetReturnFragment,
  generateCustomFieldSelect,
  generateWhereClause,
  parseFilters,
  parseSortingOptions,
} from "./query.server";
import type {
  AdvancedIndexAsset,
  AdvancedIndexQueryResult,
  CreateAssetFromBackupImportPayload,
  CreateAssetFromContentImportPayload,
  ShelfAssetCustomFieldValueType,
  UpdateAssetPayload,
} from "./types";
import {
  formatAssetsRemindersDates,
  getAssetsWhereInput,
  getLocationUpdateNoteContent,
} from "./utils.server";
import type { Column } from "../asset-index-settings/helpers";
import { cancelAssetReminderScheduler } from "../asset-reminder/scheduler.server";
import { createKitsIfNotExists } from "../kit/service.server";

import { createNote } from "../note/service.server";
import { getUserByID } from "../user/service.server";

const label: ErrorLabel = "Assets";

type AssetWithInclude<T extends Prisma.AssetInclude | undefined> =
  T extends Prisma.AssetInclude
    ? Prisma.AssetGetPayload<{ include: T }>
    : Asset;

export async function getAsset<T extends Prisma.AssetInclude | undefined>({
  id,
  organizationId,
  userOrganizations,
  request,
  include,
}: Pick<Asset, "id"> & {
  organizationId: Asset["organizationId"];
  userOrganizations?: Pick<UserOrganization, "organizationId">[];
  request?: Request;
  include?: T;
}): Promise<AssetWithInclude<T>> {
  try {
    const otherOrganizationIds = userOrganizations?.map(
      (org) => org.organizationId
    );

    const asset = await db.asset.findFirstOrThrow({
      where: {
        OR: [
          { id, organizationId },
          ...(userOrganizations?.length
            ? [{ id, organizationId: { in: otherOrganizationIds } }]
            : []),
        ],
      },
      include: { ...include },
    });

    /* User is accessing the asset in the wrong organization. In that case we need special 404 handling. */
    if (
      userOrganizations?.length &&
      asset.organizationId !== organizationId &&
      otherOrganizationIds?.includes(asset.organizationId)
    ) {
      const redirectTo =
        typeof request !== "undefined"
          ? getRedirectUrlFromRequest(request)
          : undefined;

      throw new ShelfError({
        cause: null,
        title: "Asset not found",
        message: "",
        additionalData: {
          model: "asset",
          organization: userOrganizations.find(
            (org) => org.organizationId === asset.organizationId
          ),
          redirectTo,
        },
        label,
        status: 404,
      });
    }

    return asset as AssetWithInclude<T>;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Asset not found",
      message:
        "The asset you are trying to access does not exist or you do not have permission to access it.",
      additionalData: {
        id,
        organizationId,
        ...(isLikeShelfError(cause) ? cause.additionalData : {}),
      },
      label,
      shouldBeCaptured: !isNotFoundError(cause),
    });
  }
}

/** This is used by both  getAssetsFromView & getAssets
 * Those are the statuses that are considered unavailable for booking assets
 */
const unavailableBookingStatuses = [
  BookingStatus.RESERVED,
  BookingStatus.ONGOING,
  BookingStatus.OVERDUE,
];

/**
 * Fetches assets directly from the asset table with enhanced search capabilities
 * @param params Search and filtering parameters for asset queries
 * @returns Assets and total count matching the criteria
 */
async function getAssets(params: {
  organizationId: Organization["id"];
  page: number;
  orderBy: SortingOptions;
  orderDirection: SortingDirection;
  perPage?: number;
  search?: string | null;
  categoriesIds?: Category["id"][] | null;
  locationIds?: Location["id"][] | null;
  tagsIds?: Tag["id"][] | null;
  status?: Asset["status"] | null;
  hideUnavailable?: Asset["availableToBook"];
  bookingFrom?: Booking["from"];
  bookingTo?: Booking["to"];
  unhideAssetsBookigIds?: Booking["id"][];
  teamMemberIds?: TeamMember["id"][] | null;
  extraInclude?: Prisma.AssetInclude;
}) {
  let {
    organizationId,
    orderBy,
    orderDirection,
    page = 1,
    perPage = 8,
    search,
    categoriesIds,
    locationIds,
    tagsIds,
    status,
    bookingFrom,
    bookingTo,
    hideUnavailable,
    unhideAssetsBookigIds,
    teamMemberIds,
    extraInclude,
  } = params;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 100 ? perPage : 20;

    let where: Prisma.AssetWhereInput = { organizationId };

    if (search) {
      const searchTerms = search
        .toLowerCase()
        .trim()
        .split(",")
        .map((term) => term.trim())
        .filter(Boolean);

      where.OR = searchTerms.map((term) => ({
        OR: [
          // Search in asset fields
          { title: { contains: term, mode: "insensitive" } },
          { description: { contains: term, mode: "insensitive" } },
          // Search in related category
          { category: { name: { contains: term, mode: "insensitive" } } },
          // Search in related location
          { location: { name: { contains: term, mode: "insensitive" } } },
          // Search in related tags
          { tags: { some: { name: { contains: term, mode: "insensitive" } } } },
          // Search in custodian names
          {
            custody: {
              custodian: {
                OR: [
                  { name: { contains: term, mode: "insensitive" } },
                  {
                    user: {
                      OR: [
                        { firstName: { contains: term, mode: "insensitive" } },
                        { lastName: { contains: term, mode: "insensitive" } },
                      ],
                    },
                  },
                ],
              },
            },
          },
        ],
      }));
    }

    if (status) {
      where.status = status;
    }

    if (categoriesIds?.length) {
      if (categoriesIds.includes("uncategorized")) {
        where.OR = [
          ...(where.OR ?? []),
          { categoryId: { in: categoriesIds } },
          { categoryId: null },
        ];
      } else {
        where.categoryId = { in: categoriesIds };
      }
    }

    if (hideUnavailable) {
      //not disabled for booking
      where.availableToBook = true;
      //not assigned to team meber
      where.custody = null;
      if (bookingFrom && bookingTo) {
        //reserved during that time
        where.bookings = {
          none: {
            ...(unhideAssetsBookigIds?.length && {
              id: { notIn: unhideAssetsBookigIds },
            }),
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
        };
      }
    }
    if (hideUnavailable === true && (!bookingFrom || !bookingTo)) {
      throw new ShelfError({
        cause: null,
        message: "booking dates are needed to hide unavailable assets",
        additionalData: {
          hideUnavailable,
          bookingFrom,
          bookingTo,
        },
        label,
      });
    }
    if (bookingFrom && bookingTo) {
      where.availableToBook = true;
    }

    if (tagsIds && tagsIds.length) {
      // Check if 'untagged' is part of the selected tag IDs
      if (tagsIds.includes("untagged")) {
        // Remove 'untagged' from the list of tags
        tagsIds = tagsIds.filter((id) => id !== "untagged");

        // Filter for assets that are untagged only
        where.OR = [
          ...(where.OR || []), // Preserve existing AND conditions if any
          { tags: { none: {} } }, // Include assets with no tags
        ];
      }

      // If there are other tags specified, apply AND condition
      if (tagsIds.length > 0) {
        where.OR = [
          ...(where.OR || []), // Preserve existing AND conditions if any
          { tags: { some: { id: { in: tagsIds } } } }, // Filter by remaining tags
        ];
      }
    }

    if (locationIds && locationIds.length > 0) {
      if (locationIds.includes("without-location")) {
        where.OR = [
          ...(where.OR ?? []),
          { locationId: { in: locationIds } },
          { locationId: null },
        ];
      } else {
        where.location = {
          id: { in: locationIds },
        };
      }
    }

    /**
     * User should only see the assets without kits for hideUnavailable true
     */
    if (hideUnavailable === true) {
      where.kit = null;
    }

    if (teamMemberIds && teamMemberIds.length) {
      where.OR = [
        ...(where.OR ?? []),
        {
          custody: { teamMemberId: { in: teamMemberIds } },
        },
        { custody: { custodian: { userId: { in: teamMemberIds } } } },
        {
          bookings: { some: { custodianTeamMemberId: { in: teamMemberIds } } },
        },
        { bookings: { some: { custodianUserId: { in: teamMemberIds } } } },
        ...(teamMemberIds.includes("without-custody")
          ? [{ custody: null }]
          : []),
      ];
    }

    const [assets, totalAssets] = await Promise.all([
      db.asset.findMany({
        skip,
        take,
        where,
        include: {
          ...assetIndexFields({
            bookingFrom,
            bookingTo,
            unavailableBookingStatuses,
          }),
          ...extraInclude,
        },
        orderBy: { [orderBy]: orderDirection },
      }),
      db.asset.count({ where }),
    ]);

    return { assets, totalAssets };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching assets",
      additionalData: { ...params },
      label,
    });
  }
}

/**
 * Fetches filtered and paginated assets for advanced asset index view.
 * @param request - The incoming request
 * @param organizationId - Organization ID to filter assets by
 * @param filters - String of filter parameters
 * @param settings - Asset index settings containing column configuration
 * @param takeAll - When true, returns all matching assets without pagination
 * @param assetIds - Optional array of specific asset IDs to filter by
 * @returns Object containing assets data, pagination info, and search parameters
 */
export async function getAdvancedPaginatedAndFilterableAssets({
  request,
  organizationId,
  settings,
  filters = "",
  takeAll = false,
  assetIds,
}: {
  request: LoaderFunctionArgs["request"];
  organizationId: Organization["id"];
  settings: AssetIndexSettings;
  filters?: string;
  takeAll?: boolean;
  assetIds?: string[];
}) {
  const currentFilterParams = new URLSearchParams(filters || "");
  const searchParams = filters
    ? currentFilterParams
    : getCurrentSearchParams(request);
  const paramsValues = getParamsValues(searchParams);
  const { page, perPageParam, search } = paramsValues;
  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = Math.min(Math.max(perPage, 1), 100);
    const parsedFilters = parseFilters(filters, settings.columns as Column[]);

    const whereClause = generateWhereClause(
      organizationId,
      search,
      parsedFilters,
      assetIds
    );
    const { orderByClause, customFieldSortings } = parseSortingOptions(
      searchParams.getAll("sortBy")
    );
    const customFieldSelect = generateCustomFieldSelect(customFieldSortings);
    // Modify query to conditionally include LIMIT/OFFSET
    const paginationClause = takeAll
      ? Prisma.empty
      : Prisma.sql`LIMIT ${take} OFFSET ${skip}`;

    const query = Prisma.sql`
      WITH asset_query AS (
        ${assetQueryFragment}
        ${customFieldSelect}
        ${assetQueryJoins}
        ${whereClause}
        GROUP BY a.id, k.id, k.name, c.id, c.name, c.color, l.name, cu.id, tm.name, u.id, u."firstName", u."lastName", u."profilePicture", u.email, b.id, bu.id, bu."firstName", bu."lastName", bu."profilePicture", bu.email, btm.id, btm.name
      ), 
      sorted_asset_query AS (
        SELECT * FROM asset_query
        ${Prisma.raw(orderByClause)}
        ${paginationClause}
      ),
      count_query AS (
        SELECT COUNT(*)::integer AS total_count
        FROM asset_query
      )
      SELECT 
        (SELECT total_count FROM count_query) AS total_count,
        ${assetReturnFragment}
      FROM sorted_asset_query aq;
    `;

    const result = await db.$queryRaw<AdvancedIndexQueryResult>(query);
    const totalAssets = result[0].total_count;
    const assets: AdvancedIndexAsset[] = result[0].assets;
    const totalPages = Math.ceil(totalAssets / take);

    return {
      search,
      totalAssets,
      perPage: take,
      page,
      assets: formatAssetsRemindersDates({ assets, request }),
      totalPages,
      cookie,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to fetch paginated and filterable assets",
      additionalData: {
        organizationId,
        paramsValues,
      },
      label,
    });
  }
}

export async function createAsset({
  title,
  description,
  userId,
  kitId,
  categoryId,
  locationId,
  qrId,
  tags,
  custodian,
  customFieldsValues,
  organizationId,
  valuation,
  availableToBook = true,
  mainImage,
  mainImageExpiration,
  id: assetId, // Add support for passing an ID
}: Pick<
  Asset,
  "description" | "title" | "categoryId" | "userId" | "valuation"
> & {
  kitId?: Kit["id"];
  qrId?: Qr["id"];
  locationId?: Location["id"];
  tags?: { set: { id: string }[] };
  custodian?: TeamMember["id"];
  customFieldsValues?: ShelfAssetCustomFieldValueType[];
  organizationId: Organization["id"];
  availableToBook?: Asset["availableToBook"];
  id?: Asset["id"]; // Make ID optional
  mainImage?: Asset["mainImage"];
  mainImageExpiration?: Asset["mainImageExpiration"];
}) {
  try {
    /** User connection data */
    const user = {
      connect: {
        id: userId,
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
     * 3. If the qr code is not linked to an asset or a kit
     */

    const qr = qrId ? await getQr({ id: qrId }) : null;
    const qrCodes =
      qr &&
      (qr.organizationId === organizationId || !qr.organizationId) &&
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

    /** Data object we send via prisma to create Asset */
    const data: Prisma.AssetCreateInput = {
      id: assetId, // Use provided ID if available
      title,
      description,
      user,
      qrCodes,
      valuation,
      organization,
      availableToBook,
      mainImage,
      mainImageExpiration,
    };

    /** If a categoryId is passed, link the category to the asset. */
    if (kitId && kitId !== "uncategorized") {
      Object.assign(data, {
        kit: {
          connect: {
            id: kitId,
          },
        },
      });
    }

    /** If a categoryId is passed, link the category to the asset. */
    if (categoryId && categoryId !== "uncategorized") {
      Object.assign(data, {
        category: {
          connect: {
            id: categoryId,
          },
        },
      });
    }

    /** If a locationId is passed, link the location to the asset. */
    if (locationId) {
      Object.assign(data, {
        location: {
          connect: {
            id: locationId,
          },
        },
      });
    }

    /** If a tags is passed, link the category to the asset. */
    if (tags && tags?.set?.length > 0) {
      Object.assign(data, {
        tags: {
          connect: tags?.set,
        },
      });
    }

    /** If a custodian is passed, create a Custody relation with that asset
     * `custodian` represents the id of a {@link TeamMember}. */
    if (custodian) {
      Object.assign(data, {
        custody: {
          create: {
            custodian: {
              connect: {
                id: custodian,
              },
            },
          },
        },
        status: AssetStatus.IN_CUSTODY,
      });
    }

    /** If custom fields are passed, create them */
    if (customFieldsValues && customFieldsValues.length > 0) {
      const customFieldValuesToAdd = customFieldsValues.filter(
        (cf) => !!cf.value
      );

      Object.assign(data, {
        /** Custom fields here refers to the values, check the Schema for more info */
        customFields: {
          create: customFieldValuesToAdd?.map(
            ({ id, value }) =>
              id &&
              value && {
                value,
                customFieldId: id,
              }
          ),
        },
      });
    }

    return await db.asset.create({
      data,
      include: {
        location: true,
        user: true,
        custody: true,
      },
    });
  } catch (cause) {
    throw maybeUniqueConstraintViolation(cause, "Asset", {
      additionalData: { userId, organizationId },
    });
  }
}

export async function updateAsset({
  title,
  description,
  mainImage,
  mainImageExpiration,
  categoryId,
  tags,
  id,
  newLocationId,
  currentLocationId,
  userId,
  valuation,
  customFieldsValues: customFieldsValuesFromForm,
  organizationId,
}: UpdateAssetPayload) {
  try {
    const isChangingLocation = newLocationId !== currentLocationId;
    const data: Prisma.AssetUpdateInput = {
      title,
      description,
      valuation,
      mainImage,
      mainImageExpiration,
    };

    /** If uncategorized is passed, disconnect the category */
    if (categoryId === "uncategorized") {
      Object.assign(data, {
        category: {
          disconnect: true,
        },
      });
    }

    // If category id is passed and is different than uncategorized, connect the category
    if (categoryId && categoryId !== "uncategorized") {
      Object.assign(data, {
        category: {
          connect: {
            id: categoryId,
          },
        },
      });
    }

    /** Connect the new location id */
    if (newLocationId) {
      Object.assign(data, {
        location: {
          connect: {
            id: newLocationId,
          },
        },
      });
    }

    /** disconnecting location relation if a user clears locations */
    if (currentLocationId && !newLocationId) {
      Object.assign(data, {
        location: {
          disconnect: true,
        },
      });
    }

    /** If a tags is passed, link the category to the asset. */
    if (tags && tags?.set) {
      Object.assign(data, {
        tags,
      });
    }

    /** If custom fields are passed, create/update them */
    if (customFieldsValuesFromForm && customFieldsValuesFromForm.length > 0) {
      /** We get the current values. We need this in order to co-relate the correct fields to update as we dont have the id's of the values */
      const currentCustomFieldsValues = await db.assetCustomFieldValue.findMany(
        {
          where: {
            assetId: id,
          },
          select: {
            id: true,
            customFieldId: true,
          },
        }
      );

      const customFieldValuesToAdd = customFieldsValuesFromForm.filter(
        (cf) => !!cf.value
      );

      const customFieldValuesToRemove = customFieldsValuesFromForm.filter(
        (cf) => !cf.value
      );

      Object.assign(data, {
        customFields: {
          upsert: customFieldValuesToAdd?.map(({ id, value }) => ({
            where: {
              id:
                currentCustomFieldsValues.find(
                  (ccfv) => ccfv.customFieldId === id
                )?.id || "",
            },
            update: { value },
            create: {
              value,
              customFieldId: id,
            },
          })),
          deleteMany: customFieldValuesToRemove.map((cf) => ({
            customFieldId: cf.id,
          })),
        },
      });
    }

    const asset = await db.asset.update({
      where: { id, organizationId },
      data,
      include: { location: true, tags: true },
    });

    /** If the location id was passed, we create a note for the move */
    if (isChangingLocation) {
      /**
       * Create a note for the move
       * Here we actually need to query the locations so we can print their names
       * */

      const user = await db.user.findFirst({
        where: {
          id: userId,
        },
        select: {
          firstName: true,
          lastName: true,
        },
      });

      const currentLocation = currentLocationId
        ? await db.location.findFirst({
            where: {
              id: currentLocationId,
            },
          })
        : null;

      const newLocation = newLocationId
        ? await db.location.findFirst({
            where: {
              id: newLocationId,
            },
          })
        : null;

      await createLocationChangeNote({
        currentLocation,
        newLocation,
        firstName: user?.firstName || "",
        lastName: user?.lastName || "",
        assetName: asset?.title,
        assetId: asset.id,
        userId,
        isRemoving: newLocationId === null,
      });
    }

    return asset;
  } catch (cause) {
    throw maybeUniqueConstraintViolation(cause, "Asset", {
      additionalData: { userId, id, organizationId },
    });
  }
}

export async function deleteAsset({
  id,
  organizationId,
}: Pick<Asset, "id"> & { organizationId: Organization["id"] }) {
  try {
    const deletedAsset = await db.asset.delete({
      where: { id, organizationId },
      select: {
        reminders: {
          select: { alertDateTime: true, activeSchedulerReference: true },
        },
      },
    });

    await Promise.all(deletedAsset.reminders.map(cancelAssetReminderScheduler));
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while deleting asset",
      additionalData: { id, organizationId },
      label,
    });
  }
}

export async function updateAssetMainImage({
  request,
  assetId,
  userId,
  organizationId,
}: {
  request: Request;
  assetId: string;
  userId: User["id"];
  organizationId: Organization["id"];
}) {
  try {
    const fileData = await parseFileFormData({
      request,
      bucketName: "assets",
      newFileName: `${userId}/${assetId}/main-image-${dateTimeInUnix(
        Date.now()
      )}`,
      resizeOptions: {
        width: 1200,
        withoutEnlargement: true,
      },
    });

    const image = fileData.get("mainImage") as string;

    if (!image) {
      return;
    }

    const signedUrl = await createSignedUrl({ filename: image });

    await updateAsset({
      id: assetId,
      mainImage: signedUrl,
      mainImageExpiration: oneDayFromNow(),
      userId,
      organizationId,
    });
    await deleteOtherImages({ userId, assetId, data: { path: image } });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while updating asset main image",
      additionalData: { assetId, userId },
      label,
    });
  }
}

function extractMainImageName(path: string): string | null {
  const match = path.match(/main-image-[\w-]+\.\w+/);
  if (match) {
    return match[0];
  } else {
    // Handle case without file extension
    const matchNoExt = path.match(/main-image-[\w-]+/);
    return matchNoExt ? matchNoExt[0] : null;
  }
}

export async function deleteOtherImages({
  userId,
  assetId,
  data,
}: {
  userId: string;
  assetId: string;
  data: { path: string };
}): Promise<void> {
  try {
    if (!data?.path) {
      // asset image stroage failure. do nothing
      return;
    }
    const currentImage = extractMainImageName(data.path);
    if (!currentImage) {
      //do nothing
      return;
    }
    const { data: deletedImagesData, error: deletedImagesError } =
      await getSupabaseAdmin()
        .storage.from("assets")
        .list(`${userId}/${assetId}`);

    if (deletedImagesError) {
      throw new Error(`Error fetching images: ${deletedImagesError.message}`);
    }

    // Extract the image names and filter out the one to keep
    const imagesToDelete = (
      deletedImagesData?.map((image) => image.name) || []
    ).filter((image) => image !== currentImage);

    // Delete the images
    await Promise.all(
      imagesToDelete.map((image) =>
        getSupabaseAdmin()
          .storage.from("assets")
          .remove([`${userId}/${assetId}/${image}`])
      )
    );
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        title: "Oops, deletion of other asset images failed",
        message: "Something went wrong while deleting other asset images",
        additionalData: { assetId, userId },
        label,
      })
    );
  }
}

async function uploadDuplicateAssetMainImage(
  mainImageUrl: string,
  assetId: string,
  userId: string
) {
  try {
    /**
     * Getting the blob from asset mainImage signed url so
     * that we can upload it into duplicated assets as well
     * */
    const imageFile = await fetch(mainImageUrl);
    const imageFileBlob = await imageFile.blob();

    /** Uploading the Blob to supabase */
    const { data, error } = await getSupabaseAdmin()
      .storage.from("assets")
      .upload(
        `${userId}/${assetId}/main-image-${dateTimeInUnix(Date.now())}`,
        imageFileBlob,
        { contentType: imageFileBlob.type, upsert: true }
      );

    if (error) {
      throw error;
    }
    /** Getting the signed url from supabase to we can view image  */
    await deleteOtherImages({ userId, assetId, data });
    return await createSignedUrl({ filename: data.path });
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Oops, duplicating failed",
      message: "Something went wrong while uploading the image",
      additionalData: { mainImageUrl, assetId, userId },
      label,
    });
  }
}

export function createCustomFieldsPayloadFromAsset(
  asset: Prisma.AssetGetPayload<{
    include: {
      custody: { include: { custodian: true } };
      tags: true;
      customFields: true;
    };
  }>
) {
  if (!asset?.customFields || asset?.customFields?.length === 0) {
    return {};
  }

  return (
    asset.customFields?.reduce(
      (obj, { customFieldId, value }) => {
        const rawValue = (value as { raw: string })?.raw ?? value ?? "";
        return { ...obj, [`cf-${customFieldId}`]: rawValue };
      },
      {} as Record<string, any>
    ) || {}
  );
}

export async function duplicateAsset({
  asset,
  userId,
  amountOfDuplicates,
  organizationId,
}: {
  asset: Prisma.AssetGetPayload<{
    include: {
      custody: { include: { custodian: true } };
      tags: true;
      customFields: true;
    };
  }>;
  userId: string;
  amountOfDuplicates: number;
  organizationId: string;
}) {
  try {
    const duplicatedAssets: Awaited<ReturnType<typeof createAsset>>[] = [];

    //irrespective category it has to copy all the custom fields;
    const customFields = await getActiveCustomFields({
      organizationId,
      includeAllCategories: true,
    });

    const payload = {
      title: `${asset.title}`,
      organizationId,
      description: asset.description,
      userId,
      categoryId: asset.categoryId,
      locationId: asset.locationId ?? undefined,
      tags: { set: asset.tags.map((tag) => ({ id: tag.id })) },
      valuation: asset.valuation,
    };

    const customFieldValues = createCustomFieldsPayloadFromAsset(asset);

    const extractedCustomFieldValues = extractCustomFieldValuesFromPayload({
      payload: { ...payload, ...customFieldValues },
      customFieldDef: customFields,
      isDuplicate: true,
    });
    for (const i of [...Array(amountOfDuplicates)].keys()) {
      const duplicatedAsset = await createAsset({
        ...payload,
        title: `${asset.title} (copy ${
          amountOfDuplicates > 1 ? i : ""
        } ${Date.now()})`,
        customFieldsValues: extractedCustomFieldValues,
      });

      if (asset.mainImage) {
        const imagePath = await uploadDuplicateAssetMainImage(
          asset.mainImage,
          duplicatedAsset.id,
          userId
        );

        if (typeof imagePath === "string") {
          await db.asset.update({
            where: { id: duplicatedAsset.id },
            data: {
              mainImage: imagePath,
              mainImageExpiration: oneDayFromNow(),
            },
          });
        }
      }

      duplicatedAssets.push(duplicatedAsset);
    }

    return duplicatedAssets;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while duplicating the asset",
      additionalData: { asset, userId, amountOfDuplicates, organizationId },
      label,
    });
  }
}

export async function getAllEntriesForCreateAndEdit({
  organizationId,
  request,
  defaults,
}: {
  organizationId: Organization["id"];
  request: LoaderFunctionArgs["request"];
  defaults?: {
    category?: string | string[] | null;
    tag?: string | null;
    location?: string | null;
  };
}) {
  const searchParams = getCurrentSearchParams(request);
  const categorySelected =
    searchParams.get("category") ?? defaults?.category ?? "";
  const locationSelected =
    searchParams.get("location") ?? defaults?.location ?? "";
  const getAllEntries = searchParams.getAll("getAll") as AllowedModelNames[];

  try {
    const [
      categoryExcludedSelected,
      selectedCategories,
      totalCategories,
      tags,
      locationExcludedSelected,
      selectedLocation,
      totalLocations,
    ] = await Promise.all([
      /** Get the categories */
      db.category.findMany({
        where: {
          organizationId,
          id: Array.isArray(categorySelected)
            ? { notIn: categorySelected }
            : { not: categorySelected },
        },
        take: getAllEntries.includes("category") ? undefined : 12,
      }),
      db.category.findMany({
        where: {
          organizationId,
          id: Array.isArray(categorySelected)
            ? { in: categorySelected }
            : categorySelected,
        },
      }),
      db.category.count({ where: { organizationId } }),

      /** Get the tags */
      db.tag.findMany({ where: { organizationId } }),

      /** Get the locations */
      db.location.findMany({
        where: { organizationId, id: { not: locationSelected } },
        take: getAllEntries.includes("location") ? undefined : 12,
      }),
      db.location.findMany({ where: { organizationId, id: locationSelected } }),
      db.location.count({ where: { organizationId } }),
    ]);

    return {
      categories: [...selectedCategories, ...categoryExcludedSelected],
      totalCategories,
      tags,
      locations: [...selectedLocation, ...locationExcludedSelected],
      totalLocations,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Fail to get all entries for create and edit",
      additionalData: {
        categorySelected,
        locationSelected,
        defaults,
        organizationId,
        getAllEntries,
      },
      label,
    });
  }
}

export async function getPaginatedAndFilterableAssets({
  request,
  organizationId,
  extraInclude,
  excludeCategoriesQuery = false,
  excludeTagsQuery = false,
  excludeLocationQuery = false,
  filters = "",
  isSelfService,
  userId,
}: {
  request: LoaderFunctionArgs["request"];
  organizationId: Organization["id"];
  kitId?: Prisma.AssetWhereInput["kitId"];
  extraInclude?: Prisma.AssetInclude;
  excludeCategoriesQuery?: boolean;
  excludeTagsQuery?: boolean;
  excludeLocationQuery?: boolean;
  filters?: string;

  isSelfService?: boolean;
  userId?: string;
}) {
  const currentFilterParams = new URLSearchParams(filters || "");
  const searchParams = filters
    ? currentFilterParams
    : getCurrentSearchParams(request);

  const paramsValues = getParamsValues(searchParams);
  const status =
    searchParams.get("status") === "ALL" // If the value is "ALL", we just remove the param
      ? null
      : (searchParams.get("status") as AssetStatus | null);
  const getAllEntries = searchParams.getAll("getAll") as AllowedModelNames[];
  const {
    page,
    perPageParam,
    orderBy,
    orderDirection,
    search,
    categoriesIds,
    tagsIds,
    bookingFrom,
    bookingTo,
    hideUnavailable,
    unhideAssetsBookigIds,
    locationIds,
    teamMemberIds,
  } = paramsValues;

  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  try {
    const [
      categoryExcludedSelected,
      selectedCategories,
      totalCategories,
      tagsExcludedSelected,
      selectedTags,
      totalTags,
      locationExcludedSelected,
      selectedLocations,
      totalLocations,
      teamMembersData,
    ] = await Promise.all([
      db.category.findMany({
        where: { organizationId, id: { notIn: categoriesIds } },
        take: getAllEntries.includes("category") ? undefined : 12,
      }),
      db.category.findMany({
        where: { organizationId, id: { in: categoriesIds } },
      }),
      db.category.count({ where: { organizationId } }),
      db.tag.findMany({
        where: { organizationId, id: { notIn: tagsIds } },
        take: getAllEntries.includes("tag") ? undefined : 12,
      }),
      db.tag.findMany({
        where: { organizationId, id: { in: tagsIds } },
      }),
      db.tag.count({ where: { organizationId } }),
      // locations
      db.location.findMany({
        where: { organizationId, id: { notIn: locationIds } },
        take: getAllEntries.includes("location") ? undefined : 12,
      }),
      db.location.findMany({
        where: { organizationId, id: { in: locationIds } },
      }),
      db.location.count({ where: { organizationId } }),
      // team members/custodian
      getTeamMemberForCustodianFilter({
        organizationId,
        selectedTeamMembers: teamMemberIds,
        getAll: getAllEntries.includes("teamMember"),
        isSelfService,
        userId,
      }),
    ]);

    const { assets, totalAssets } = await getAssets({
      organizationId,
      page,
      perPage,
      orderBy,
      orderDirection,
      search,
      categoriesIds,
      tagsIds,
      status,
      bookingFrom,
      bookingTo,
      hideUnavailable,
      unhideAssetsBookigIds,
      locationIds,
      teamMemberIds,
      extraInclude,
    });

    const totalPages = Math.ceil(totalAssets / perPage);

    return {
      page,
      perPage,
      search,
      totalAssets,
      totalCategories,
      totalTags,
      categories: excludeCategoriesQuery
        ? []
        : [...selectedCategories, ...categoryExcludedSelected],
      tags: excludeTagsQuery ? [] : [...selectedTags, ...tagsExcludedSelected],
      assets,
      totalPages,
      cookie,
      locations: excludeLocationQuery
        ? []
        : [...selectedLocations, ...locationExcludedSelected],
      totalLocations,
      ...teamMembersData,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Fail to fetch paginated and filterable assets",
      additionalData: {
        organizationId,
        excludeCategoriesQuery,
        excludeTagsQuery,
        paramsValues,
        getAllEntries,
      },
      label,
    });
  }
}

export async function createLocationChangeNote({
  currentLocation,
  newLocation,
  firstName,
  lastName,
  assetName,
  assetId,
  userId,
  isRemoving,
}: {
  currentLocation: Pick<Location, "id" | "name"> | null;
  newLocation: Location | null;
  firstName: string;
  lastName: string;
  assetName: Asset["title"];
  assetId: Asset["id"];
  userId: User["id"];
  isRemoving: boolean;
}) {
  try {
    const message = getLocationUpdateNoteContent({
      currentLocation,
      newLocation,
      firstName,
      lastName,
      assetName,
      isRemoving,
    });

    await createNote({
      content: message,
      type: "UPDATE",
      userId,
      assetId,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating a location change note. Please try again or contact support",
      additionalData: { userId, assetId },
      label,
    });
  }
}

export async function createBulkLocationChangeNotes({
  modifiedAssets,
  assetIds,
  removedAssetIds,
  userId,
  location,
}: {
  modifiedAssets: Prisma.AssetGetPayload<{
    select: {
      title: true;
      id: true;
      location: {
        select: {
          name: true;
          id: true;
        };
      };
      user: {
        select: {
          firstName: true;
          lastName: true;
          id: true;
        };
      };
    };
  }>[];
  assetIds: Asset["id"][];
  removedAssetIds: Asset["id"][];
  userId: User["id"];
  location: Location;
}) {
  try {
    const user = await db.user
      .findFirstOrThrow({
        where: {
          id: userId,
        },
        select: {
          firstName: true,
          lastName: true,
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "User not found",
          additionalData: { userId },
          label,
        });
      });

    // Iterate over the modified assets
    for (const asset of modifiedAssets) {
      const isRemoving = removedAssetIds.includes(asset.id);
      const isNew = assetIds.includes(asset.id);
      const newLocation = isRemoving ? null : location;
      const currentLocation = asset.location
        ? { name: asset.location.name, id: asset.location.id }
        : null;

      if (isNew || isRemoving) {
        await createLocationChangeNote({
          currentLocation,
          newLocation,
          firstName: user.firstName || "",
          lastName: user.lastName || "",
          assetName: asset.title,
          assetId: asset.id,
          userId,
          isRemoving,
        });
      }
    }
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while creating bulk location change notes",
      additionalData: { userId, assetIds, removedAssetIds },
      label,
    });
  }
}

/** Fetches assets with the data needed for exporting to CSV */
export async function fetchAssetsForExport({
  organizationId,
}: {
  organizationId: Organization["id"];
}) {
  try {
    return await db.asset.findMany({
      where: {
        organizationId,
      },
      include: {
        category: true,
        location: true,
        notes: true,
        custody: {
          include: {
            custodian: true,
          },
        },
        tags: true,
        customFields: {
          include: {
            customField: true,
          },
        },
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching assets for export",
      additionalData: { organizationId },
      label,
    });
  }
}

/**
 * Creates assets from imported content, handling image URLs if provided
 * Pre-generates IDs for consistent asset and image file naming
 */
export async function createAssetsFromContentImport({
  data,
  userId,
  organizationId,
}: {
  data: CreateAssetFromContentImportPayload[];
  userId: User["id"];
  organizationId: Organization["id"];
}) {
  try {
    // Create cache instance for this import operation
    const imageCache = new LRUCache<string, CachedImage>({
      maxSize: importImageCacheServer.MAX_CACHE_SIZE,
      sizeCalculation: (value) => value.size,
    });

    const qrCodesPerAsset = await parseQrCodesFromImportData({
      data,
      organizationId,
      userId,
    });

    // Create all required related entities
    const [kits, categories, locations, teamMembers, tags, { customFields }] =
      await Promise.all([
        createKitsIfNotExists({
          data,
          userId,
          organizationId,
        }),
        createCategoriesIfNotExists({
          data,
          userId,
          organizationId,
        }),
        createLocationsIfNotExists({
          data,
          userId,
          organizationId,
        }),
        createTeamMemberIfNotExists({
          data,
          organizationId,
        }),
        createTagsIfNotExists({
          data,
          userId,
          organizationId,
        }),
        createCustomFieldsIfNotExists({
          data,
          organizationId,
          userId,
        }),
      ]);

    // Process assets sequentially to handle image uploads
    for (let asset of data) {
      // Generate asset ID upfront
      const assetId = id(LEGACY_CUID_LENGTH); // This generates our standard CUID format. We use legacy length(25 chars) so it fits with the length of IDS generated by prisma

      const customFieldsValues: ShelfAssetCustomFieldValueType[] =
        Object.entries(asset).reduce((res, [key, val]) => {
          if (key.startsWith("cf:") && val) {
            const { name } = getDefinitionFromCsvHeader(key);
            if (customFields[name].id) {
              res.push({
                id: customFields[name].id,
                value: buildCustomFieldValue(
                  { raw: asset[key] },
                  customFields[name]
                ),
              } as ShelfAssetCustomFieldValueType);
            }
          }
          return res;
        }, [] as ShelfAssetCustomFieldValueType[]);

      // Handle image URL if provided
      let mainImage: string | undefined;
      let mainImageExpiration: Date | undefined;

      if (asset.imageUrl) {
        try {
          if (!isValidImageUrl(asset.imageUrl)) {
            throw new ShelfError({
              cause: null,
              message: "Invalid image format. Please use .png, .jpg, or .jpeg",
              additionalData: { url: asset.imageUrl },
              label: "Assets",
              shouldBeCaptured: false,
            });
          }
          const filename = `${userId}/${assetId}/main-image-${dateTimeInUnix(
            Date.now()
          )}`;

          const path = await uploadImageFromUrl(
            asset.imageUrl,
            {
              filename,
              contentType: "image/jpeg",
              bucketName: "assets",
              resizeOptions: {
                width: 1200,
                withoutEnlargement: true,
              },
            },
            imageCache
          );

          if (path) {
            mainImage = await createSignedUrl({ filename: path });
            mainImageExpiration = oneDayFromNow();
          }
        } catch (cause) {
          const isShelfError = isLikeShelfError(cause);

          throw new ShelfError({
            cause,
            message: isShelfError
              ? `${cause?.message} for asset: ${asset.title}`
              : `Failed to upload image for asset ${asset.title}`,
            additionalData: { imageUrl: asset.imageUrl, assetId },
            label: "Assets",
          });
        }
      }

      await createAsset({
        id: assetId, // Pass the pre-generated ID
        qrId: qrCodesPerAsset.find((item) => item?.title === asset.title)?.qrId,
        organizationId,
        title: asset.title,
        description: asset.description || "",
        userId,
        kitId: asset.kit ? kits?.[asset.kit] : undefined,
        categoryId: asset.category ? categories?.[asset.category] : null,
        locationId: asset.location ? locations?.[asset.location] : undefined,
        custodian: asset.custodian ? teamMembers?.[asset.custodian] : undefined,
        tags:
          asset?.tags?.length > 0
            ? {
                set: asset.tags
                  .filter((t) => tags[t])
                  .map((t) => ({ id: tags[t] })),
              }
            : undefined,
        valuation: asset.valuation ? +asset.valuation : null,
        customFieldsValues,
        availableToBook: asset?.bookable !== "no",
        mainImage: mainImage || null,
        mainImageExpiration: mainImageExpiration || null,
      });
    }
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);
    throw new ShelfError({
      cause,
      message: isShelfError
        ? cause?.message
        : "Something went wrong while creating assets from content import",
      additionalData: {
        userId,
        organizationId,
        ...(isShelfError && cause.additionalData),
      },
      label,
    });
  }
}

export async function createAssetsFromBackupImport({
  data,
  userId,
  organizationId,
}: {
  data: CreateAssetFromBackupImportPayload[];
  userId: User["id"];
  organizationId: Organization["id"];
}) {
  try {
    //TODO use concurrency control or it will overload the server
    await Promise.all(
      data.map(async (asset) => {
        /** Base data from asset */
        const d = {
          data: {
            title: asset.title,
            description: asset.description || null,
            mainImage: asset.mainImage || null,
            mainImageExpiration: oneDayFromNow(),
            userId,
            organizationId,
            status: asset.status,
            createdAt: new Date(asset.createdAt),
            updatedAt: new Date(asset.updatedAt),
            qrCodes: {
              create: [
                {
                  id: id(),
                  version: 0,
                  errorCorrection: ErrorCorrection["L"],
                  userId,
                  organizationId,
                },
              ],
            },
            valuation: asset.valuation ? +asset.valuation : null,
          },
        };

        /** Category */
        if (asset.category && Object.keys(asset?.category).length > 0) {
          const category = asset.category as Category;

          const existingCat = await db.category.findFirst({
            where: {
              organizationId,
              name: category.name,
            },
          });

          /** If it doesn't exist, create a new one */
          if (!existingCat) {
            const newCat = await db.category.create({
              data: {
                organizationId,
                name: category.name,
                description: category.description || "",
                color: category.color,
                userId,
                createdAt: new Date(category.createdAt),
                updatedAt: new Date(category.updatedAt),
              },
            });
            /** Add it to the data for creating the asset */
            Object.assign(d.data, {
              categoryId: newCat.id,
            });
          } else {
            /** Add it to the data for creating the asset */
            Object.assign(d.data, {
              categoryId: existingCat.id,
            });
          }
        }

        /** Location */
        if (asset.location && Object.keys(asset?.location).length > 0) {
          const location = asset.location as Location;

          const existingLoc = await db.location.findFirst({
            where: {
              organizationId,
              name: location.name,
            },
          });

          /** If it doesn't exist, create a new one */
          if (!existingLoc) {
            const newLoc = await db.location.create({
              data: {
                name: location.name,
                description: location.description || "",
                address: location.address || "",
                organizationId,
                userId,
                createdAt: new Date(location.createdAt),
                updatedAt: new Date(location.updatedAt),
              },
            });
            /** Add it to the data for creating the asset */
            Object.assign(d.data, {
              locationId: newLoc.id,
            });
          } else {
            /** Add it to the data for creating the asset */
            Object.assign(d.data, {
              locationId: existingLoc.id,
            });
          }
        }

        /** Custody */
        if (asset.custody && Object.keys(asset?.custody).length > 0) {
          const { custodian } = asset.custody;

          const existingCustodian = await db.teamMember.findFirst({
            where: {
              deletedAt: null,
              organizationId,
              name: custodian.name,
            },
          });

          if (!existingCustodian) {
            const newCustodian = await db.teamMember.create({
              data: {
                name: custodian.name,
                organizationId,
                createdAt: new Date(custodian.createdAt),
                updatedAt: new Date(custodian.updatedAt),
              },
            });

            Object.assign(d.data, {
              custody: {
                create: {
                  teamMemberId: newCustodian.id,
                },
              },
            });
          } else {
            Object.assign(d.data, {
              custody: {
                create: {
                  teamMemberId: existingCustodian.id,
                },
              },
            });
          }
        }

        /** Tags */
        if (asset.tags && asset.tags.length > 0) {
          const tagsNames = asset.tags.map((t) => t.name);
          // now we loop through the categories and check if they exist
          let tags: Record<string, string> = {};
          for (const tag of tagsNames) {
            const existingTag = await db.tag.findFirst({
              where: {
                name: tag,
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

          Object.assign(d.data, {
            tags:
              asset.tags.length > 0
                ? {
                    connect: asset.tags.map((tag) => ({ id: tags[tag.name] })),
                  }
                : undefined,
          });
        }

        /** Custom fields */
        if (asset.customFields && asset.customFields.length > 0) {
          const customFieldDef = asset.customFields.reduce(
            (res, { value, customField }) => {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { id, createdAt, updatedAt, ...rest } = customField;
              const options = value?.valueOption?.length
                ? [value?.valueOption]
                : undefined;
              res.push({ ...rest, options, userId, organizationId });
              return res;
            },
            [] as Array<CustomFieldDraftPayload>
          );

          const cfIds = await upsertCustomField(customFieldDef);

          Object.assign(d.data, {
            customFields: {
              create: asset.customFields.map((cf) => ({
                value: cf.value,
                // @ts-ignore
                customFieldId: cfIds[cf.customField.name].id,
              })),
            },
          });
        }

        /** Create the Asset */
        const { id: assetId } = await db.asset.create(d);

        /** Create notes */
        if (asset?.notes?.length > 0) {
          await db.note.createMany({
            data: asset.notes.map((note: Note) => ({
              content: note.content,
              type: note.type,
              assetId,
              userId,
              createdAt: new Date(note.createdAt),
              updatedAt: new Date(note.updatedAt),
            })),
          });
        }
      })
    );
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while creating assets from backup import",
      additionalData: { userId, organizationId },
      label,
    });
  }
}

export async function updateAssetBookingAvailability({
  id,
  availableToBook,
  organizationId,
}: Pick<Asset, "id" | "availableToBook" | "organizationId">) {
  try {
    return await db.asset.update({
      where: { id, organizationId },
      data: { availableToBook },
    });
  } catch (cause) {
    throw maybeUniqueConstraintViolation(cause, "Asset", {
      additionalData: { id },
    });
  }
}

export async function updateAssetsWithBookingCustodians<T extends Asset>(
  assets: T[]
) {
  try {
    /** When assets are checked out, we want to make an extra query to get the custodian for those assets. */
    const checkedOutAssetsIds = assets
      .filter((a) => a.status === "CHECKED_OUT")
      .map((a) => a.id);

    if (checkedOutAssetsIds.length > 0) {
      /** We query again the assets that are checked-out so we can get the user via the booking*/

      const assetsWithCustodians = await db.asset.findMany({
        where: {
          id: {
            in: checkedOutAssetsIds,
          },
        },
        select: {
          id: true,
          bookings: {
            where: {
              status: {
                in: ["ONGOING", "OVERDUE"],
              },
            },
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

      /**
       * We take the first booking of the array and extract the user from it and add it to the asset
       */
      assets = assets.map((a) => {
        const assetWithUser = assetsWithCustodians.find(
          (awu) => awu.id === a.id
        );
        const booking = assetWithUser?.bookings[0];
        const custodianUser = booking?.custodianUser;
        const custodianTeamMember = booking?.custodianTeamMember;

        if (checkedOutAssetsIds.includes(a.id)) {
          /** If there is a custodian user, use its data to display the name */
          if (custodianUser) {
            return {
              ...a,
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
            };
          }

          /** If there is a custodian teamMember, use its name */
          if (custodianTeamMember) {
            return {
              ...a,
              custody: {
                custodian: {
                  name: custodianTeamMember.name,
                },
              },
            };
          }

          /** This should not happen as there shouldn't be a case when asset is CHECKED_OUT but has no custodian */
          Logger.error(
            new ShelfError({
              cause: null,
              message: "Couldn't find custodian for asset",
              additionalData: { asset: a },
              label,
            })
          );
        }

        return a;
      });
    }
    return assets;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Fail to update assets with booking custodians",
      additionalData: { assets },
      label,
    });
  }
}

export async function updateAssetQrCode({
  assetId,
  newQrId,
  organizationId,
}: {
  organizationId: string;
  assetId: string;
  newQrId: string;
}) {
  // Disconnect all existing QR codes
  try {
    // Disconnect all existing QR codes
    await db.asset
      .update({
        where: { id: assetId, organizationId },
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
          additionalData: { assetId, organizationId, newQrId },
        });
      });

    // Connect the new QR code
    return await db.asset
      .update({
        where: { id: assetId, organizationId },
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
          additionalData: { assetId, organizationId, newQrId },
        });
      });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while updating asset QR code",
      label,
      additionalData: { assetId, organizationId, newQrId },
    });
  }
}

export async function bulkDeleteAssets({
  assetIds,
  organizationId,
  userId,
  currentSearchParams,
}: {
  assetIds: Asset["id"][];
  organizationId: Asset["organizationId"];
  userId: User["id"];
  currentSearchParams?: string | null;
}) {
  try {
    /**
     * If we are selecting all assets in list then we have to consider other filters too
     */
    const where: Prisma.AssetWhereInput = assetIds.includes(ALL_SELECTED_KEY)
      ? getAssetsWhereInput({ organizationId, currentSearchParams })
      : { id: { in: assetIds }, organizationId };

    /**
     * We have to remove the images of assets so we have to make this query first
     */
    const assets = await db.asset.findMany({
      where,
      select: { id: true, mainImage: true },
    });

    try {
      await db.asset.deleteMany({
        where: { id: { in: assets.map((asset) => asset.id) } },
      });

      /** Deleting images of the assets (if any) */
      const assetsWithImages = assets.filter((asset) => !!asset.mainImage);
      await Promise.all(
        assetsWithImages.map((asset) =>
          deleteOtherImages({
            userId,
            assetId: asset.id,
            data: { path: `main-image-${asset.id}.jpg` },
          })
        )
      );
    } catch (cause) {
      throw new ShelfError({
        cause,
        message:
          "Something went wrong while deleting assets. The transaction was failed.",
        label: "Assets",
      });
    }
  } catch (cause) {
    const message =
      cause instanceof ShelfError
        ? cause.message
        : "Something went wrong while bulk deleting assets";

    throw new ShelfError({
      cause,
      message,
      additionalData: { assetIds, organizationId },
      label,
    });
  }
}

export async function bulkCheckOutAssets({
  userId,
  assetIds,
  custodianId,
  custodianName,
  organizationId,
  currentSearchParams,
}: {
  userId: User["id"];
  assetIds: Asset["id"][];
  custodianId: TeamMember["id"];
  custodianName: TeamMember["name"];
  organizationId: Asset["organizationId"];
  currentSearchParams?: string | null;
}) {
  try {
    /**
     * If we are selecting all assets in list then we have to consider other filters too
     */
    const where: Prisma.AssetWhereInput = assetIds.includes(ALL_SELECTED_KEY)
      ? getAssetsWhereInput({ organizationId, currentSearchParams })
      : { id: { in: assetIds }, organizationId };

    /**
     * In order to make notes for the assets we have to make this query to get info about assets
     */
    const [assets, user] = await Promise.all([
      db.asset.findMany({
        where,
        select: { id: true, title: true, status: true },
      }),
      getUserByID(userId),
    ]);

    const assetsNotAvailable = assets.some(
      (asset) => asset.status !== "AVAILABLE"
    );

    if (assetsNotAvailable) {
      throw new ShelfError({
        cause: null,
        message:
          "There are some unavailable assets. Please make sure you are selecting only available assets.",
        label: "Assets",
        shouldBeCaptured: false,
      });
    }

    /**
     * updateMany does not allow to create nested relationship rows
     * so we have to make two queries to bulk assign custody of assets
     * 1. Create custodies for all assets
     * 2. Update status of all assets to IN_CUSTODY
     */
    await db.$transaction(async (tx) => {
      /** Creating custodies over assets */
      await tx.custody.createMany({
        data: assets.map((asset) => ({
          assetId: asset.id,
          teamMemberId: custodianId,
        })),
      });

      /** Updating status of assets to IN_CUSTODY */
      await tx.asset.updateMany({
        where: { id: { in: assets.map((asset) => asset.id) } },
        data: { status: AssetStatus.IN_CUSTODY },
      });

      /** Creating notes for the assets */
      await tx.note.createMany({
        data: assets.map((asset) => ({
          content: `**${user.firstName?.trim()} ${user.lastName?.trim()}** has given **${custodianName.trim()}** custody over **${asset.title.trim()}**`,
          type: "UPDATE",
          userId,
          assetId: asset.id,
        })),
      });
    });

    return true;
  } catch (cause) {
    const message =
      cause instanceof ShelfError
        ? cause.message
        : "Something went wrong while bulk checking out assets.";

    throw new ShelfError({
      cause,
      message,
      additionalData: { assetIds, custodianId },
      label,
    });
  }
}

export async function bulkCheckInAssets({
  userId,
  assetIds,
  organizationId,
  currentSearchParams,
}: {
  userId: User["id"];
  assetIds: Asset["id"][];
  organizationId: Asset["organizationId"];
  currentSearchParams?: string | null;
}) {
  try {
    /**
     * If we are selecting all assets in list then we have to consider other filters too
     */
    const where: Prisma.AssetWhereInput = assetIds.includes(ALL_SELECTED_KEY)
      ? getAssetsWhereInput({ organizationId, currentSearchParams })
      : { id: { in: assetIds }, organizationId };

    /**
     * In order to make notes for the assets we have to make this query to get info about assets
     */
    const [assets, user] = await Promise.all([
      db.asset.findMany({
        where,
        select: {
          id: true,
          title: true,
          custody: {
            select: { id: true, custodian: { include: { user: true } } },
          },
        },
      }),
      getUserByID(userId),
    ]);

    const hasAssetsWithoutCustody = assets.some((asset) => !asset.custody);

    if (hasAssetsWithoutCustody) {
      throw new ShelfError({
        cause: null,
        message:
          "There are some assets without custody. Please make sure you are selecting assets with custody.",
        label: "Assets",
        shouldBeCaptured: false,
      });
    }

    /**
     * updateMany does not allow to update nested relationship rows
     * so we have to make two queries to bulk release custody of assets
     * 1. Delete all custodies for all assets
     * 2. Update status of all assets to AVAILABLE
     */
    await db.$transaction(async (tx) => {
      /** Deleting custodies over assets */
      await tx.custody.deleteMany({
        where: {
          id: {
            in: assets.map((asset) => {
              /** This case should not happen but in case */
              if (!asset.custody) {
                throw new ShelfError({
                  cause: null,
                  label: "Assets",
                  message: "Could not find custody over asset.",
                });
              }

              return asset.custody.id;
            }),
          },
        },
      });

      /** Updating status of assets to AVAILABLE */
      await tx.asset.updateMany({
        where: { id: { in: assets.map((asset) => asset.id) } },
        data: { status: AssetStatus.AVAILABLE },
      });

      /** Creating notes for the assets */
      await tx.note.createMany({
        data: assets.map((asset) => ({
          content: `**${user.firstName?.trim()} ${
            user.lastName
          }** has released **${resolveTeamMemberName(
            asset.custody!.custodian
          )}'s** custody over **${asset.title?.trim()}**`,
          type: "UPDATE",
          userId,
          assetId: asset.id,
        })),
      });
    });

    return true;
  } catch (cause) {
    const message =
      cause instanceof ShelfError
        ? cause.message
        : "Something went wrong while bulk checking in assSets.";

    throw new ShelfError({
      cause,
      message,
      additionalData: { assetIds, userId },
      label,
    });
  }
}

export async function bulkUpdateAssetLocation({
  userId,
  assetIds,
  organizationId,
  newLocationId,
  currentSearchParams,
}: {
  userId: User["id"];
  assetIds: Asset["id"][];
  organizationId: Asset["organizationId"];
  newLocationId?: Location["id"] | null;
  currentSearchParams?: string | null;
}) {
  try {
    /**
     * If we are selecting all assets in list then we have to consider other filters too
     */
    const where: Prisma.AssetWhereInput = assetIds.includes(ALL_SELECTED_KEY)
      ? getAssetsWhereInput({ organizationId, currentSearchParams })
      : { id: { in: assetIds }, organizationId };

    /** We have to create notes for all the assets so we have make this query */
    const [assets, user] = await Promise.all([
      db.asset.findMany({
        where,
        select: { id: true, title: true, location: true },
      }),
      getUserByID(userId),
    ]);

    const newLocation = newLocationId
      ? await db.location.findFirst({
          where: { id: newLocationId, organizationId },
        })
      : null;

    await db.$transaction(async (tx) => {
      /** Updating location of assets to newLocation */
      await tx.asset.updateMany({
        where: { id: { in: assets.map((asset) => asset.id) } },
        data: { locationId: newLocation?.id ? newLocation.id : null },
      });

      /** Creating notes for the assets */
      await tx.note.createMany({
        data: assets.map((asset) => {
          const isRemoving = !newLocationId;

          const content = getLocationUpdateNoteContent({
            currentLocation: asset.location,
            newLocation,
            firstName: user?.firstName ?? "",
            lastName: user?.lastName ?? "",
            assetName: asset.title,
            isRemoving,
          });

          return {
            content,
            type: "UPDATE",
            userId,
            assetId: asset.id,
          };
        }),
      });
    });

    return true;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while bulk updating location.",
      additionalData: { userId, assetIds, newLocationId },
      label,
    });
  }
}

export async function bulkUpdateAssetCategory({
  userId,
  assetIds,
  organizationId,
  categoryId,
  currentSearchParams,
}: {
  userId: string;
  assetIds: Asset["id"][];
  organizationId: Asset["organizationId"];
  categoryId: Asset["categoryId"];
  currentSearchParams?: string | null;
}) {
  try {
    /**
     * If we are selecting all assets in list then we have to consider other filters too
     */
    const where: Prisma.AssetWhereInput = assetIds.includes(ALL_SELECTED_KEY)
      ? getAssetsWhereInput({ organizationId, currentSearchParams })
      : { id: { in: assetIds }, organizationId };

    await db.asset.updateMany({
      where,
      data: {
        /** If nothing is selected then we have to remove the relation and set category to null */
        categoryId: !categoryId ? null : categoryId,
      },
    });

    return true;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while bulk updating category.",
      additionalData: { userId, assetIds, organizationId, categoryId },
      label,
    });
  }
}

export async function bulkAssignAssetTags({
  userId,
  assetIds,
  organizationId,
  tagsIds,
  currentSearchParams,
  remove,
}: {
  userId: string;
  assetIds: Asset["id"][];
  organizationId: Asset["organizationId"];
  tagsIds: string[];
  currentSearchParams?: string | null;
  remove: boolean;
}) {
  try {
    const shouldUpdateAll = assetIds.includes(ALL_SELECTED_KEY);
    let _assetIds = assetIds;

    if (shouldUpdateAll) {
      const allOrgAssetIds = await db.asset.findMany({
        where: getAssetsWhereInput({ organizationId, currentSearchParams }),
        select: { id: true },
      });
      _assetIds = allOrgAssetIds.map((a) => a.id);
    }

    const updatePromises = _assetIds.map((id) =>
      db.asset.update({
        where: { id, organizationId },
        data: {
          tags: {
            [remove ? "disconnect" : "connect"]: tagsIds.map((id) => ({ id })), // IDs of tags you want to connect
          },
        },
      })
    );

    await Promise.all(updatePromises);

    return true;
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);

    throw new ShelfError({
      cause,
      message: isShelfError
        ? cause.message
        : "Something went wrong while bulk updating tags.",
      additionalData: { userId, assetIds, organizationId, tagsIds },
      label,
    });
  }
}

export async function bulkMarkAvailability({
  organizationId,
  assetIds,
  type,
  currentSearchParams,
}: {
  organizationId: Asset["organizationId"];
  assetIds: Asset["id"][];
  type: "available" | "unavailable";
  currentSearchParams?: string | null;
}) {
  try {
    /* If we are selecting all assets in list then we have to consider other filters too */
    const where: Prisma.AssetWhereInput = assetIds.includes(ALL_SELECTED_KEY)
      ? getAssetsWhereInput({ organizationId, currentSearchParams })
      : { id: { in: assetIds }, organizationId };

    await db.asset.updateMany({
      where: {
        ...where,
        availableToBook: type === "unavailable",
      },
      data: { availableToBook: type === "available" },
    });

    return true;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while marking assets as available.",
      additionalData: { assetIds, organizationId },
      label,
    });
  }
}

export async function relinkQrCode({
  qrId,
  assetId,
  organizationId,
  userId,
}: {
  qrId: Qr["id"];
  userId: User["id"];
  assetId: Asset["id"];
  organizationId: Organization["id"];
}) {
  const [qr, user, asset] = await Promise.all([
    getQr({ id: qrId }),
    getUserByID(userId),
    db.asset.findFirst({
      where: { id: assetId, organizationId },
      select: { qrCodes: { select: { id: true } } },
    }),
  ]);

  /** User cannot link qr code of other organization */
  if (qr.organizationId && qr.organizationId !== organizationId) {
    throw new ShelfError({
      cause: null,
      title: "QR not valid.",
      message: "This QR code does not belong to your organization",
      label: "QR",
    });
  }

  if (qr.assetId && qr.assetId !== assetId) {
    throw new ShelfError({
      cause: null,
      title: "QR already linked.",
      message:
        "You cannot link to this code because its already linked to another asset. Delete the other asset to free up the code and try again.",
      label: "QR",
      shouldBeCaptured: false,
    });
  }

  const oldQrCode = asset?.qrCodes[0];

  await Promise.all([
    db.qr.update({
      where: { id: qr.id },
      data: { organizationId, userId },
    }),
    db.asset.update({
      where: { id: assetId, organizationId },
      data: {
        qrCodes: {
          set: [],
          connect: { id: qr.id },
        },
      },
    }),
    createNote({
      assetId,
      userId,
      type: "UPDATE",
      content: `**${user.firstName?.trim()}** has changed QR code ${
        oldQrCode ? `from **${oldQrCode.id}**` : ""
      } to **${qrId}**`,
    }),
  ]);
}

export async function getAssetsTabLoaderData({
  userId,
  request,
  organizationId,
}: {
  userId: User["id"];
  request: Request;
  organizationId: Organization["id"];
}) {
  try {
    const { filters, redirectNeeded } = await getFiltersFromRequest(
      request,
      organizationId
    );

    if (filters && redirectNeeded) {
      const cookieParams = new URLSearchParams(filters);
      return redirect(`/assets?${cookieParams.toString()}`);
    }

    const filtersSearchParams = new URLSearchParams(filters);
    filtersSearchParams.set("teamMember", userId);

    const {
      search,
      totalAssets,
      perPage,
      page,
      categories,
      tags,
      assets,
      totalPages,
      cookie,
      totalCategories,
      totalTags,
      locations,
      totalLocations,
    } = await getPaginatedAndFilterableAssets({
      request,
      organizationId,
      filters: filtersSearchParams.toString(),
    });

    const modelName = {
      singular: "asset",
      plural: "assets",
    };

    const userPrefsCookie = await userPrefs.serialize(cookie);
    const headers = [setCookie(userPrefsCookie)];

    return {
      search,
      totalItems: totalAssets,
      perPage,
      page,
      categories,
      tags,
      items: assets,
      totalPages,
      cookie,
      totalCategories,
      totalTags,
      locations,
      totalLocations,
      modelName,
      headers,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: "Something went wrong while fetching assets",
    });
  }
}
