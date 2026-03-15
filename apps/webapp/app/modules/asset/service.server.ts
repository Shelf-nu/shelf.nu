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
  BarcodeType,
} from "@shelf/database";
import {
  AssetStatus,
  BookingStatus,
  ErrorCorrection,
  KitStatus,
  TagUseFor,
} from "@shelf/database";
import {
  findMany,
  findFirst,
  findFirstOrThrow,
  findUnique,
  findUniqueOrThrow,
  create,
  update,
  remove as removeRecord,
  count,
  createMany,
  updateMany,
  deleteMany,
} from "~/database/query-helpers.server";
import { sql, raw, empty, queryRaw } from "~/database/sql.server";
import { LRUCache } from "lru-cache";
import type { LoaderFunctionArgs } from "react-router";
import { extractStoragePath } from "~/components/assets/asset-image/utils";
import type {
  SortingDirection,
  SortingOptions,
} from "~/components/list/filters/sort-by";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import {
  updateBarcodes,
  validateBarcodeUniqueness,
  parseBarcodesFromImportData,
} from "~/modules/barcode/service.server";
import { normalizeBarcodeValue } from "~/modules/barcode/validation";
import { createCategoriesIfNotExists } from "~/modules/category/service.server";
import {
  createCustomFieldsIfNotExists,
  getActiveCustomFields,
  upsertCustomField,
} from "~/modules/custom-field/service.server";
import type { CustomFieldDraftPayload } from "~/modules/custom-field/types";
import {
  createLocationChangeNote,
  createLocationsIfNotExists,
} from "~/modules/location/service.server";
import { createLoadUserForNotes } from "~/modules/note/load-user-for-notes.server";
import { getQr, parseQrCodesFromImportData } from "~/modules/qr/service.server";
import { createTagsIfNotExists } from "~/modules/tag/service.server";
import {
  createTeamMemberIfNotExists,
  getTeamMemberForCustodianFilter,
} from "~/modules/team-member/service.server";
import type { AllowedModelNames } from "~/routes/api+/model-filters";
import { getLocale } from "~/utils/client-hints";
import {
  ASSET_MAX_IMAGE_UPLOAD_SIZE,
  LEGACY_CUID_LENGTH,
} from "~/utils/constants";
import {
  getFiltersFromRequest,
  setCookie,
  updateCookieWithPerPage,
  userPrefs,
} from "~/utils/cookies.server";
import {
  buildCustomFieldValue,
  extractCustomFieldValuesFromPayload,
  formatInvalidNumericCustomFieldMessage,
  getDefinitionFromCsvHeader,
} from "~/utils/custom-fields";
import { dateTimeInUnix } from "~/utils/date-time-in-unix";
import type { ErrorLabel } from "~/utils/error";
import {
  ShelfError,
  isLikeShelfError,
  isNotFoundError,
  maybeUniqueConstraintViolation,
  VALIDATION_ERROR,
} from "~/utils/error";
import { getRedirectUrlFromRequest } from "~/utils/http";
import { getCurrentSearchParams } from "~/utils/http.server";
import { id } from "~/utils/id/id.server";
import { detectImageFormat } from "~/utils/image-format.server";
import * as importImageCacheServer from "~/utils/import.image-cache.server";
import type { CachedImage } from "~/utils/import.image-cache.server";
import { getParamsValues } from "~/utils/list";
import { Logger } from "~/utils/logger";
import {
  wrapUserLinkForNote,
  wrapCustodianForNote,
  wrapAssetsWithDataForNote,
  wrapLinkForNote,
} from "~/utils/markdoc-wrappers";
import { isValidImageUrl } from "~/utils/misc";
import { oneDayFromNow } from "~/utils/one-week-from-now";
import {
  createSignedUrl,
  parseFileFormData,
  uploadImageFromUrl,
} from "~/utils/storage.server";
import { resolveTeamMemberName } from "~/utils/user";
import { resolveAssetIdsForBulkOperation } from "./bulk-operations-helper.server";
import { assetIndexFields } from "./fields";
import {
  CUSTOM_FIELD_SEARCH_PATHS,
  assetQueryFragment,
  assetQueryJoins,
  assetReturnFragment,
  generateCustomFieldSelect,
  generateWhereClause,
  parseFiltersWithHierarchy,
  parseSortingOptions,
} from "./query.server";
import { getNextSequentialId } from "./sequential-id.server";
import type {
  AdvancedIndexAsset,
  AdvancedIndexQueryResult,
  CreateAssetFromBackupImportPayload,
  CreateAssetFromContentImportPayload,
  ShelfAssetCustomFieldValueType,
  UpdateAssetPayload,
} from "./types";
import {
  getLocationUpdateNoteContent,
  getCustomFieldUpdateNoteContent,
  detectPotentialChanges,
  detectCustomFieldChanges,
  type CustomFieldChangeInfo,
} from "./utils.server";
import type { Column } from "../asset-index-settings/helpers";
import { cancelAssetReminderScheduler } from "../asset-reminder/scheduler.server";
import { createKitsIfNotExists } from "../kit/service.server";
import { createSystemLocationNote } from "../location-note/service.server";
import {
  createAssetCategoryChangeNote,
  createAssetDescriptionChangeNote,
  createAssetNameChangeNote,
  createAssetValuationChangeNote,
  createNote,
  createTagChangeNoteIfNeeded,
  type TagSummary,
} from "../note/service.server";
import { getUserByID } from "../user/service.server";

const label: ErrorLabel = "Assets";

const ASSET_BEFORE_UPDATE_SELECT =
  "title, description, valuation, category:Category(id, name, color), organization:Organization(currency), tags:Tag(id, name)";

/**
 * Fetches the snapshot of fields required to build change notes before an update.
 */
async function fetchAssetBeforeUpdate({
  id,
  organizationId,
  shouldFetch,
}: {
  id: Asset["id"];
  organizationId: Asset["organizationId"];
  shouldFetch: boolean;
}): Promise<any | null> {
  if (!shouldFetch) {
    return null;
  }

  return findUnique(db, "Asset", {
    where: { id, organizationId },
    select: ASSET_BEFORE_UPDATE_SELECT,
  });
}

/**
 * Sets kit custody for imported assets after all assets have been created
 */
async function setKitCustodyAfterAssetImport({
  data,
  kits,
  teamMembers,
}: {
  data: CreateAssetFromContentImportPayload[];
  kits: Record<string, Kit>;
  teamMembers: Record<string, TeamMember>;
}) {
  // Normalize kit/custodian names so padded CSV values still map to created records.
  const assetsWithKitAndCustodian = data
    .map((asset) => ({
      kit: asset.kit?.trim(),
      custodian: asset.custodian?.trim(),
    }))
    .filter((asset) => asset.kit && asset.custodian);

  if (assetsWithKitAndCustodian.length === 0) {
    return; // Nothing to do
  }

  // Group by kit name and get the custodian for each kit
  const kitToCustodianMap = new Map<string, string>();
  for (const asset of assetsWithKitAndCustodian) {
    const kitName = asset.kit!;
    const custodianName = asset.custodian!;
    if (!kitToCustodianMap.has(kitName)) {
      kitToCustodianMap.set(kitName, custodianName);
    }
  }

  // Update kit custody - one update per kit instead of per asset for performance
  for (const [kitName, custodianName] of kitToCustodianMap) {
    const kit = kits[kitName];
    const teamMember = teamMembers[custodianName];

    if (kit && teamMember) {
      // Update kit status
      await update(db, "Kit", {
        where: { id: kit.id },
        data: { status: KitStatus.IN_CUSTODY },
      });
      // Create custody record for the kit
      // TODO: convert Prisma nested create to separate Supabase insert
      await create(db, "KitCustody", {
        kitId: kit.id,
        custodianId: teamMember.id,
      } as any);
    }
  }
}

/**
 * Validates custody conflicts for kits during import.
 * This includes:
 * - Assets with custody being imported into kits that exist but are not in custody,
 * - Existing kits with different custodians,
 * - Multiple custodians assigned to the same kit within the same import.
 */
async function validateKitCustodyConflicts({
  data,
  organizationId,
}: {
  data: CreateAssetFromContentImportPayload[];
  organizationId: Organization["id"];
}) {
  // Extract assets that have both a kit and a custodian
  // Normalize kit/custodian names so padded CSV values don't bypass conflict checks.
  const conflictCandidates = data
    .map((asset) => ({
      title: asset.title,
      kit: asset.kit?.trim(),
      custodian: asset.custodian?.trim(),
    }))
    .filter((asset) => asset.kit && asset.custodian);

  if (conflictCandidates.length === 0) {
    return; // No conflicts possible
  }

  // Get unique kit names that might have conflicts
  const kitNames = [
    ...new Set(conflictCandidates.map((asset) => asset.kit)),
  ].filter(Boolean) as string[];

  // Fetch existing kits and their custody status
  // TODO: convert Prisma include to Supabase join for custody/custodian/assets
  const existingKits: any[] = await findMany(db, "Kit", {
    where: {
      name: { in: kitNames },
      organizationId,
    },
    select:
      "id, name, custody:KitCustody(id, custodian:TeamMember(name)), assets:Asset(id)",
  });

  // Find conflicts: existing kits without custody that would receive assets with custody
  const conflicts: Array<{
    asset: string;
    custodian: string;
    kit: string;
    issue: string;
  }> = [];
  const existingKitsMap = new Map(existingKits.map((kit) => [kit.name, kit]));

  // Check for conflicts within the import data itself - assets going to same kit with different custodians
  const kitToCustodiansMap = new Map<string, Set<string>>();
  for (const asset of conflictCandidates) {
    if (!kitToCustodiansMap.has(asset.kit!)) {
      kitToCustodiansMap.set(asset.kit!, new Set());
    }
    kitToCustodiansMap.get(asset.kit!)!.add(asset.custodian!);
  }

  // Add conflicts for kits with multiple custodians in the same import
  for (const [kitName, custodians] of kitToCustodiansMap) {
    if (custodians.size > 1) {
      const custodiansArray = Array.from(custodians);
      const assetsForThisKit = conflictCandidates.filter(
        (asset) => asset.kit === kitName
      );

      for (const asset of assetsForThisKit) {
        conflicts.push({
          asset: asset.title,
          custodian: asset.custodian!,
          kit: asset.kit!,
          issue: `Kit has assets with multiple custodians: ${custodiansArray.join(
            ", "
          )}`,
        });
      }
    }
  }

  for (const asset of conflictCandidates) {
    const existingKit = existingKitsMap.get(asset.kit!);

    if (existingKit) {
      if (!existingKit.custody && existingKit.assets.length > 0) {
        conflicts.push({
          asset: asset.title,
          custodian: asset.custodian!,
          kit: asset.kit!,
          issue: `Kit exists without custody but has ${
            existingKit.assets.length
          } existing asset${existingKit.assets.length === 1 ? "" : "s"}`,
        });
      } else if (existingKit.custody) {
        conflicts.push({
          asset: asset.title,
          custodian: asset.custodian!,
          kit: asset.kit!,
          issue: `Kit already has a custodian (${existingKit.custody.custodian.name}). Importing custody for kits that already have a custodian is not allowed`,
        });
      }
    }
  }

  if (conflicts.length > 0) {
    throw new ShelfError({
      cause: null,
      message: `We found custody conflicts with existing kits. Assets with custody cannot be imported into existing kits that are not in custody.`,
      additionalData: {
        kitCustodyConflicts: conflicts,
      },
      label: "Assets",
      status: 400,
      shouldBeCaptured: false,
    });
  }
}

// TODO: Prisma.AssetInclude / AssetGetPayload replaced with `any` during Supabase migration
type AssetWithInclude<T extends Record<string, any> | undefined> = any;

export async function getAsset<T extends Record<string, any> | undefined>({
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

    // TODO: convert Prisma include to Supabase join — for now using select *
    const asset = await findFirstOrThrow(db, "Asset", {
      where: {
        OR: [
          { id, organizationId },
          ...(userOrganizations?.length
            ? [{ id, organizationId: { in: otherOrganizationIds } }]
            : []),
        ],
      },
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
        shouldBeCaptured: false, // In this case we shouldnt be capturing the error
      });
    }

    return asset as AssetWithInclude<T>;
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);
    throw new ShelfError({
      cause,
      title: "Asset not found",
      message:
        "The asset you are trying to access does not exist or you do not have permission to access it.",
      additionalData: {
        id,
        organizationId,
        ...(isShelfError ? cause.additionalData : {}),
      },
      label,
      shouldBeCaptured: isShelfError
        ? cause.shouldBeCaptured
        : !isNotFoundError(cause),
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
export async function getAssets(params: {
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
  extraInclude?: Record<string, any>;
  /**
   * Hide all assets that cannot currently be added to kit.
   * This includes:
   * - assets in custody
   * - assets that are checkedout
   * */
  hideUnavailableToAddToKit?: boolean;
  assetKitFilter?: string | null;
  availableToBookOnly?: boolean;
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
    assetKitFilter,
    availableToBookOnly,
  } = params;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 100 ? perPage : 20;

    const where: Record<string, any> = { organizationId };

    if (availableToBookOnly) {
      where.availableToBook = true;
    }

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
          // Search in asset sequential id
          { sequentialId: { contains: term, mode: "insensitive" } },
          // Search in asset description
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
          // Search qr code id
          {
            qrCodes: { some: { id: { contains: term, mode: "insensitive" } } },
          },
          // Search barcode values
          {
            barcodes: {
              some: { value: { contains: term, mode: "insensitive" } },
            },
          },
          // Search in custom fields
          {
            customFields: {
              some: {
                OR: CUSTOM_FIELD_SEARCH_PATHS.map((jsonPath) => ({
                  value: {
                    path: [jsonPath],
                    string_contains: term,
                    mode: "insensitive",
                  },
                })),
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
        where.AND = [
          // Rule 1: Exclude assets from RESERVED bookings (all assets unavailable)
          {
            bookings: {
              none: {
                ...(unhideAssetsBookigIds?.length && {
                  id: { notIn: unhideAssetsBookigIds },
                }),
                status: BookingStatus.RESERVED,
                OR: [
                  { from: { lte: bookingTo }, to: { gte: bookingFrom } },
                  { from: { gte: bookingFrom }, to: { lte: bookingTo } },
                ],
              },
            },
          },
          // Rule 2: For ONGOING/OVERDUE bookings, only exclude CHECKED_OUT assets
          {
            OR: [
              // Either asset is AVAILABLE (checked in from partial check-in)
              { status: AssetStatus.AVAILABLE },
              // Or asset has no conflicting ONGOING/OVERDUE bookings
              {
                bookings: {
                  none: {
                    ...(unhideAssetsBookigIds?.length && {
                      id: { notIn: unhideAssetsBookigIds },
                    }),
                    status: {
                      in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
                    },
                    OR: [
                      { from: { lte: bookingTo }, to: { gte: bookingFrom } },
                      { from: { gte: bookingFrom }, to: { lte: bookingTo } },
                    ],
                  },
                },
              },
            ],
          },
        ];
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
          bookings: {
            some: {
              custodianTeamMemberId: { in: teamMemberIds },
              /** We only get them if the booking is ongoing */
              status: {
                in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
              },
            },
          },
        },
        {
          bookings: {
            some: {
              custodianUserId: { in: teamMemberIds },
              /** We only get them if the booking is ongoing */
              status: {
                in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
              },
            },
          },
        },
        ...(teamMemberIds.includes("without-custody")
          ? [{ custody: null }]
          : []),
      ];
    }

    if (assetKitFilter === "NOT_IN_KIT") {
      where.kit = null;
    } else if (assetKitFilter === "IN_OTHER_KITS") {
      where.kit = { isNot: null };
    }

    // TODO: convert Prisma include (assetIndexFields, extraInclude) to Supabase join/select
    const [assets, totalAssets] = await Promise.all([
      findMany(db, "Asset", {
        skip,
        take,
        where,
        orderBy: { [orderBy]: orderDirection },
      }),
      count(db, "Asset", where),
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
  getBookings = false,
  canUseBarcodes = false,
  availableToBookOnly = false,
}: {
  request: LoaderFunctionArgs["request"];
  organizationId: Organization["id"];
  settings: AssetIndexSettings;
  filters?: string;
  takeAll?: boolean;
  assetIds?: string[];
  getBookings?: boolean;
  canUseBarcodes?: boolean;
  availableToBookOnly?: boolean;
}) {
  const currentFilterParams = new URLSearchParams(filters || "");
  const searchParams = filters
    ? currentFilterParams
    : getCurrentSearchParams(request);
  const paramsValues = getParamsValues(searchParams);
  const { page, perPageParam, search } = paramsValues;
  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  const settingColumns = settings?.columns as Column[];

  const isUpcomingBookingsColumnVisible =
    settings.mode === "ADVANCED" &&
    settingColumns?.some(
      (col) => col.name === "upcomingBookings" && col.visible
    );

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = Math.min(Math.max(perPage, 1), 100);
    const parsedFilters = await parseFiltersWithHierarchy(
      filters,
      settingColumns,
      organizationId
    );

    const whereClause = generateWhereClause(
      organizationId,
      search,
      parsedFilters,
      assetIds,
      availableToBookOnly
    );
    const { orderByClause, customFieldSortings } = parseSortingOptions(
      searchParams.getAll("sortBy")
    );
    const customFieldSelect = generateCustomFieldSelect(customFieldSortings);
    // Modify query to conditionally include LIMIT/OFFSET
    const paginationClause = takeAll
      ? empty
      : sql`LIMIT ${take} OFFSET ${skip}`;
    const query = sql`
      WITH asset_query AS (
        ${assetQueryFragment({
          withBookings: getBookings || isUpcomingBookingsColumnVisible,
          withBarcodes: canUseBarcodes,
        })}
        ${customFieldSelect}
        ${assetQueryJoins}
        ${whereClause}
        GROUP BY a.id, k.id, k.name, c.id, c.name, c.color, l.id, l."parentId", l.name, cu.id, tm.name, u.id, u."firstName", u."lastName", u."profilePicture", u.email, b.id, bu.id, bu."firstName", bu."lastName", bu."profilePicture", bu.email, btm.id, btm.name
      ),
      sorted_asset_query AS (
        SELECT * FROM asset_query
        ${raw(orderByClause)}
        ${paginationClause}
      ),
      count_query AS (
        SELECT COUNT(*)::integer AS total_count
        FROM asset_query
      )
      SELECT
        (SELECT total_count FROM count_query) AS total_count,
        ${assetReturnFragment({
          withBookings: getBookings || isUpcomingBookingsColumnVisible,
          withBarcodes: canUseBarcodes,
        })}
      FROM sorted_asset_query aq;
    `;

    const result = await queryRaw<AdvancedIndexQueryResult[0]>(db, query);
    const totalAssets = result[0].total_count;
    const assets: AdvancedIndexAsset[] = result[0].assets;
    const totalPages = Math.ceil(totalAssets / take);
    return {
      search,
      totalAssets,
      perPage: take,
      page,
      assets,
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
  barcodes,
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
  barcodes?: { type: BarcodeType; value: string; existingId?: string }[];
  organizationId: Organization["id"];
  availableToBook?: Asset["availableToBook"];
  id?: Asset["id"]; // Make ID optional
  mainImage?: Asset["mainImage"];
  mainImageExpiration?: Asset["mainImageExpiration"];
}) {
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    try {
      // Generate sequential ID
      const sequentialId = await getNextSequentialId(organizationId);

      /**
       * If a qr code is passed, link to that QR
       * Otherwise, create a new one
       * Here we also need to double check:
       * 1. If the qr code exists
       * 2. If the qr code belongs to the current organization
       * 3. If the qr code is not linked to an asset or a kit
       */

      const qr = qrId ? await getQr({ id: qrId }) : null;
      const shouldConnectQr =
        qr &&
        (qr.organizationId === organizationId || !qr.organizationId) &&
        qr.assetId === null &&
        qr.kitId === null;

      /** Data object — direct FK references instead of Prisma connect */
      const data: Record<string, any> = {
        id: assetId, // Use provided ID if available
        title,
        description,
        sequentialId, // Add the generated sequential ID
        userId,
        valuation,
        organizationId: organizationId as string,
        availableToBook,
        mainImage,
        mainImageExpiration,
      };

      /** If a kitId is passed, link the kit to the asset. */
      if (kitId && kitId !== "uncategorized") {
        data.kitId = kitId;
      }

      /** If a categoryId is passed, link the category to the asset. */
      if (categoryId && categoryId !== "uncategorized") {
        data.categoryId = categoryId;
      }

      /** If a locationId is passed, link the location to the asset. */
      if (locationId) {
        data.locationId = locationId;
      }

      /** If a custodian is passed, set status to IN_CUSTODY */
      if (custodian) {
        data.status = AssetStatus.IN_CUSTODY;
      }

      const asset = await create(db, "Asset", data as any);

      /** Create QR code — either connect existing or create new */
      if (shouldConnectQr) {
        await update(db, "Qr", {
          where: { id: qrId! },
          data: { assetId: asset.id, organizationId, userId },
        });
      } else {
        await create(db, "Qr", {
          id: id(),
          version: 0,
          errorCorrection: ErrorCorrection["L"],
          userId,
          organizationId,
          assetId: asset.id,
        } as any);
      }

      /** If tags are passed, link them to the asset via join table */
      if (tags && tags?.set?.length > 0) {
        // TODO: convert Prisma many-to-many connect to Supabase join table insert
        for (const tag of tags.set) {
          await create(
            db,
            "_AssetToTag" as any,
            {
              A: asset.id,
              B: tag.id,
            } as any
          );
        }
      }

      /** If a custodian is passed, create a Custody relation with that asset
       * `custodian` represents the id of a {@link TeamMember}. */
      if (custodian) {
        await create(db, "Custody", {
          assetId: asset.id,
          teamMemberId: custodian,
        } as any);
      }

      /** If custom fields are passed, create them */
      if (customFieldsValues && customFieldsValues.length > 0) {
        const customFieldValuesToAdd = customFieldsValues.filter(
          (cf) => !!cf.value
        );

        for (const cf of customFieldValuesToAdd) {
          if (cf.id && cf.value) {
            await create(db, "AssetCustomFieldValue", {
              value: cf.value,
              customFieldId: cf.id,
              assetId: asset.id,
            } as any);
          }
        }
      }

      /** If barcodes are passed, handle reusing orphaned barcodes or creating new ones */
      if (barcodes && barcodes.length > 0) {
        const barcodesToAdd = barcodes.filter(
          (barcode) => !!barcode.value && !!barcode.type
        );

        if (barcodesToAdd.length > 0) {
          const barcodesToConnect = barcodesToAdd.filter((b) => b.existingId);
          const barcodesToCreate = barcodesToAdd.filter((b) => !b.existingId);

          // Connect existing barcodes by setting their assetId
          for (const b of barcodesToConnect) {
            await update(db, "Barcode", {
              where: { id: b.existingId! },
              data: { assetId: asset.id },
            });
          }

          // Create new barcodes
          for (const { type, value } of barcodesToCreate) {
            await create(db, "Barcode", {
              type,
              value: normalizeBarcodeValue(type, value),
              organizationId,
              assetId: asset.id,
            } as any);
          }
        }
      }

      // Successfully created asset, exit the retry loop
      return asset;
    } catch (cause) {
      // Check for unique constraint violation and retry
      const errorCode = (cause as any)?.code;
      const errorMessage =
        cause instanceof Error ? cause.message : String(cause);

      if (errorCode === "23505" || errorCode === "P2002") {
        // Handle sequential ID conflicts with retry
        if (
          errorMessage.includes("sequentialId") &&
          attempts < maxAttempts - 1
        ) {
          attempts++;
          continue; // Retry with next sequential ID
        }

        // If it's a unique constraint violation on barcode values,
        // use our detailed validation to provide specific field errors
        if (errorMessage.includes("value") && barcodes && barcodes.length > 0) {
          const barcodesToAdd = barcodes.filter(
            (barcode) => !!barcode.value && !!barcode.type
          );
          if (barcodesToAdd.length > 0) {
            // Use existing validation function for detailed error messages
            await validateBarcodeUniqueness(barcodesToAdd, organizationId);
          }
        }
      }

      throw maybeUniqueConstraintViolation(cause, "Asset", {
        additionalData: { userId, organizationId },
      });
    }
  }

  // If we reach here, all retry attempts failed
  throw new ShelfError({
    cause: null,
    message:
      "Failed to create asset after maximum retry attempts for sequential ID generation",
    label: "Assets",
    additionalData: { userId, organizationId, maxAttempts },
  });
}

export async function updateAsset({
  title,
  description,
  mainImage,
  mainImageExpiration,
  thumbnailImage,
  categoryId,
  tags,
  id,
  newLocationId,
  currentLocationId,
  userId,
  valuation,
  customFieldsValues: customFieldsValuesFromForm,
  barcodes,
  organizationId,
  request,
}: UpdateAssetPayload) {
  try {
    const isChangingLocation = newLocationId !== currentLocationId;

    // Check if asset belongs to a kit and prevent location updates
    if (isChangingLocation) {
      // TODO: convert Prisma nested select to Supabase join
      const assetWithKit: any = await findUnique(db, "Asset", {
        where: { id, organizationId },
        select: "kitId, kit:Kit(id, name)",
      });

      if (assetWithKit?.kit) {
        throw new ShelfError({
          cause: null,
          message: `This asset's location is managed by its parent kit "${assetWithKit.kit.name}". Please update the kit's location instead.`,
          additionalData: {
            assetId: id,
            kitId: assetWithKit.kit.id,
            kitName: assetWithKit.kit.name,
          },
          label: "Assets",
          status: 400,
          shouldBeCaptured: false,
        });
      }
    }

    const isTagUpdate = Boolean(tags?.set);

    const trackedFieldUpdates = Boolean(
      typeof title !== "undefined" ||
        typeof description !== "undefined" ||
        typeof categoryId !== "undefined" ||
        typeof valuation !== "undefined"
    );

    const assetBeforeUpdate = await fetchAssetBeforeUpdate({
      id,
      organizationId,
      shouldFetch: trackedFieldUpdates || isTagUpdate,
    });

    const previousTags: TagSummary[] = isTagUpdate
      ? (assetBeforeUpdate?.tags ?? []).map((tag) => ({
          id: tag.id,
          name: tag.name ?? "",
        }))
      : [];

    const loadUserForNotes = createLoadUserForNotes(userId);

    const data: Record<string, any> = {
      title,
      description,
      valuation,
      mainImage,
      mainImageExpiration,
      thumbnailImage,
    };

    /** If uncategorized is passed, disconnect the category (set FK to null) */
    if (categoryId === "uncategorized") {
      data.categoryId = null;
    }

    // If category id is passed and is different than uncategorized, connect the category
    if (categoryId && categoryId !== "uncategorized") {
      data.categoryId = categoryId;
    }

    /** Connect the new location id */
    if (newLocationId) {
      data.locationId = newLocationId;
    }

    /** disconnecting location relation if a user clears locations */
    if (currentLocationId && !newLocationId) {
      data.locationId = null;
    }

    /** If custom fields are passed, create/update them */
    let currentCustomFieldsValuesWithFields: {
      id: string;
      customFieldId: string;
      value: any;
      customField: { id: string; name: string; type: any };
    }[] = [];

    if (customFieldsValuesFromForm && customFieldsValuesFromForm.length > 0) {
      /** We get the current values with field information for comparison. We need this to detect changes for notes */
      // TODO: convert Prisma nested select to Supabase join
      currentCustomFieldsValuesWithFields = (await findMany(
        db,
        "AssetCustomFieldValue",
        {
          where: { assetId: id },
          select:
            "id, customFieldId, value, customField:CustomField(id, name, type)",
        }
      )) as any;

      const customFieldValuesToAdd = customFieldsValuesFromForm.filter(
        (cf) => !!cf.value
      );

      const customFieldValuesToRemove = customFieldsValuesFromForm.filter(
        (cf) => !cf.value
      );

      // Handle upserts for custom field values
      for (const { id: cfId, value } of customFieldValuesToAdd) {
        const existing = currentCustomFieldsValuesWithFields.find(
          (ccfv) => ccfv.customFieldId === cfId
        );
        if (existing) {
          await update(db, "AssetCustomFieldValue", {
            where: { id: existing.id },
            data: { value },
          });
        } else {
          await create(db, "AssetCustomFieldValue", {
            value,
            customFieldId: cfId,
            assetId: id,
          } as any);
        }
      }

      // Handle deletes for custom field values
      for (const cf of customFieldValuesToRemove) {
        await deleteMany(db, "AssetCustomFieldValue", {
          assetId: id,
          customFieldId: cf.id,
        });
      }
    }

    /** If tags are being updated, handle via join table */
    if (isTagUpdate && tags?.set) {
      // Remove all existing tag associations
      await deleteMany(db, "_AssetToTag" as any, { A: id } as any);
      // Add new tag associations
      for (const tag of tags.set) {
        await create(
          db,
          "_AssetToTag" as any,
          {
            A: id,
            B: tag.id,
          } as any
        );
      }
    }

    // TODO: convert Prisma include to Supabase join for location/tags/category/organization
    const asset: any = await update(db, "Asset", {
      where: { id, organizationId },
      data,
      select:
        "*, location:Location(*), tags:Tag(*), category:Category(*), organization:Organization(*)",
    });

    /** If barcodes are passed, update existing barcodes efficiently */
    if (barcodes !== undefined) {
      await updateBarcodes({
        barcodes,
        assetId: id,
        organizationId,
        userId,
      });
    }

    /** If the location id was passed, we create a note for the move */
    if (isChangingLocation) {
      /**
       * Create a note for the move
       * Here we actually need to query the locations so we can print their names
       * */

      const user = await loadUserForNotes();

      const currentLocation = currentLocationId
        ? await findFirst(db, "Location", {
            where: { id: currentLocationId },
          })
        : null;

      const newLocation = newLocationId
        ? await findFirst(db, "Location", {
            where: { id: newLocationId },
          })
        : null;

      await createLocationChangeNote({
        currentLocation,
        newLocation,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        assetId: asset.id,
        userId,
        isRemoving: newLocationId === null,
      });

      // Create location activity notes
      const userLink = wrapUserLinkForNote({
        id: userId,
        firstName: user.firstName,
        lastName: user.lastName,
      });
      const assetData = [{ id: asset.id, title: asset.title }];

      if (newLocation) {
        const newLocLink = wrapLinkForNote(
          `/locations/${newLocation.id}`,
          newLocation.name
        );
        const assetMarkup = wrapAssetsWithDataForNote(assetData, "added");
        const movedFrom = currentLocation
          ? ` Moved from ${wrapLinkForNote(
              `/locations/${currentLocation.id}`,
              currentLocation.name
            )}.`
          : "";
        await createSystemLocationNote({
          locationId: newLocation.id,
          content: `${userLink} added ${assetMarkup} to ${newLocLink}.${movedFrom}`,
          userId,
        });
      }

      if (currentLocation && currentLocation.id !== newLocation?.id) {
        const prevLocLink = wrapLinkForNote(
          `/locations/${currentLocation.id}`,
          currentLocation.name
        );
        const assetMarkup = wrapAssetsWithDataForNote(assetData, "removed");
        const movedTo = newLocation
          ? ` Moved to ${wrapLinkForNote(
              `/locations/${newLocation.id}`,
              newLocation.name
            )}.`
          : "";
        await createSystemLocationNote({
          locationId: currentLocation.id,
          content: `${userLink} removed ${assetMarkup} from ${prevLocLink}.${movedTo}`,
          userId,
        });
      }
    }

    if (assetBeforeUpdate && trackedFieldUpdates) {
      await Promise.all([
        createAssetNameChangeNote({
          assetId: asset.id,
          userId,
          previousName: assetBeforeUpdate.title,
          newName: title,
          loadUserForNotes,
        }),
        createAssetDescriptionChangeNote({
          assetId: asset.id,
          userId,
          previousDescription: assetBeforeUpdate.description,
          newDescription: description,
          loadUserForNotes,
        }),
        createAssetCategoryChangeNote({
          assetId: asset.id,
          userId,
          previousCategory: assetBeforeUpdate.category,
          newCategory: asset.category
            ? {
                id: asset.category.id,
                name: asset.category.name ?? "Unnamed category",
                color: asset.category.color ?? "#575757",
              }
            : null,
          loadUserForNotes,
        }),
        createAssetValuationChangeNote({
          assetId: asset.id,
          userId,
          previousValuation: assetBeforeUpdate.valuation,
          newValuation: asset.valuation,
          currency: assetBeforeUpdate.organization.currency,
          locale: getLocale(request),
          loadUserForNotes,
        }),
      ]);
    }

    if (isTagUpdate) {
      await createTagChangeNoteIfNeeded({
        assetId: asset.id,
        userId,
        previousTags,
        currentTags: asset.tags ?? [],
        loadUserForNotes,
      });
    }

    /** If custom fields were processed, create notes for any changes */
    if (customFieldsValuesFromForm && customFieldsValuesFromForm.length > 0) {
      // Early detection of potential changes to avoid unnecessary DB queries
      const potentialChanges = detectPotentialChanges(
        currentCustomFieldsValuesWithFields,
        customFieldsValuesFromForm
      );

      if (potentialChanges.length > 0) {
        // Fetch required data in parallel only if we have potential changes
        const [user, customFieldsFromForm] = await Promise.all([
          findFirst(db, "User", {
            where: { id: userId },
            select: "firstName, lastName",
          }),
          findMany(db, "CustomField", {
            where: {
              id: { in: customFieldsValuesFromForm.map((cf) => cf.id) },
              active: true,
              deletedAt: null,
            },
            select: "id, name, type",
          }),
        ]);

        // Detect actual changes with robust comparison
        const changes = detectCustomFieldChanges(
          currentCustomFieldsValuesWithFields,
          customFieldsValuesFromForm,
          customFieldsFromForm
        );

        // Batch create all notes in parallel if we have changes
        if (changes.length > 0) {
          const notePromises = changes.map((change: CustomFieldChangeInfo) =>
            createCustomFieldChangeNote({
              customFieldName: change.customFieldName,
              previousValue: change.previousValue,
              newValue: change.newValue,
              firstName: user?.firstName || "",
              lastName: user?.lastName || "",
              assetId: asset.id,
              userId,
              isFirstTimeSet: change.isFirstTimeSet,
            })
          );

          await Promise.all(notePromises);
        }
      }
    }

    return asset;
  } catch (cause) {
    // If it's already a ShelfError with validation errors, re-throw as is
    if (
      cause instanceof ShelfError &&
      cause.additionalData?.[VALIDATION_ERROR]
    ) {
      throw cause;
    }

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
    // Fetch reminders before deletion
    // TODO: convert Prisma nested select to Supabase join
    const reminders: any[] = await findMany(db, "AssetReminder" as any, {
      where: { assetId: id },
      select: "alertDateTime, activeSchedulerReference",
    });

    await removeRecord(db, "Asset", { id, organizationId });

    await Promise.all(reminders.map(cancelAssetReminderScheduler));
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
  isNewAsset = false,
}: {
  request: Request;
  assetId: string;
  userId: User["id"];
  organizationId: Organization["id"];
  isNewAsset?: boolean;
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
      generateThumbnail: true, // Enable thumbnail generation
      thumbnailSize: 108, // Size matches what we use in AssetImage component
      maxFileSize: ASSET_MAX_IMAGE_UPLOAD_SIZE,
    });

    const image = fileData.get("mainImage") as string | null;

    if (!image) {
      return;
    }

    // Handle both the old string response and new stringified object response
    let mainImagePath: string;
    let thumbnailPath: string | null = null;

    // Try parsing as JSON first (for new thumbnail format)
    try {
      const parsedImage = JSON.parse(image);
      if (parsedImage.originalPath) {
        mainImagePath = parsedImage.originalPath;
        thumbnailPath = parsedImage.thumbnailPath;
      } else {
        // Fallback to string if parsing succeeds but no originalPath
        mainImagePath = image;
      }
    } catch {
      // If parsing fails, it's just a regular path string
      mainImagePath = image;
    }

    const signedUrl = await createSignedUrl({ filename: mainImagePath });
    let thumbnailSignedUrl: string | null = null;

    if (thumbnailPath) {
      thumbnailSignedUrl = await createSignedUrl({ filename: thumbnailPath });
    }

    await updateAsset({
      id: assetId,
      mainImage: signedUrl,
      thumbnailImage: thumbnailSignedUrl,
      mainImageExpiration: oneDayFromNow(),
      userId,
      organizationId,
      request,
    });

    /**
     * If updateAssetMainImage is called from new asset route, then we don't have to delete other images
     * because no others images for this assets exists yet.
     */
    if (!isNewAsset) {
      await deleteOtherImages({
        userId,
        assetId,
        data: { path: mainImagePath },
      });
    }
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);
    throw new ShelfError({
      cause,
      message: isShelfError
        ? cause.message
        : "Something went wrong while updating asset main image",
      additionalData: { assetId, userId, field: "mainImage" },
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
      // asset image storage failure. do nothing
      return;
    }

    const currentImage = extractMainImageName(data.path);
    if (!currentImage) {
      // do nothing
      return;
    }

    // Derive thumbnail name from current image
    const currentThumbnail = currentImage.includes(".")
      ? currentImage.replace(/(\.[^.]+)$/, "-thumbnail$1")
      : `${currentImage}-thumbnail`;

    const { data: deletedImagesData, error: deletedImagesError } =
      await getSupabaseAdmin()
        .storage.from("assets")
        .list(`${userId}/${assetId}`);

    if (deletedImagesError) {
      throw new ShelfError({
        cause: deletedImagesError,
        message: "Failed to fetch images",
        additionalData: { userId, assetId, currentImage, data },
        label,
      });
    }

    // Extract the image names and filter out the ones to keep
    const imagesToDelete = (
      deletedImagesData?.map((image) => image.name) || []
    ).filter(
      (image) =>
        // Keep the current main image and its thumbnail
        image !== currentImage && image !== currentThumbnail
    );

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

export async function uploadDuplicateAssetMainImage(
  mainImageUrl: string,
  assetId: string,
  userId: string
) {
  try {
    const originalPath = extractStoragePath(mainImageUrl, "assets");

    if (!originalPath) {
      throw new ShelfError({
        cause: null,
        message: "Failed to extract asset image path for duplication",
        additionalData: { mainImageUrl, assetId, userId },
        label,
        shouldBeCaptured: false,
      });
    }

    const { data: originalFile, error: downloadError } =
      await getSupabaseAdmin().storage.from("assets").download(originalPath);

    if (downloadError) {
      throw new ShelfError({
        cause: downloadError,
        message: "Failed to download asset image for duplication",
        additionalData: { originalPath, assetId, userId },
        label,
      });
    }

    const arrayBuffer = await originalFile.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuffer);
    const detectedFormat = detectImageFormat(imageBuffer);

    if (!detectedFormat) {
      throw new ShelfError({
        cause: null,
        message: "Unsupported image format for asset duplication",
        additionalData: { originalPath, assetId, userId },
        label,
        shouldBeCaptured: false,
      });
    }

    /** Uploading the Blob to supabase */
    const { data, error } = await getSupabaseAdmin()
      .storage.from("assets")
      .upload(
        `${userId}/${assetId}/main-image-${dateTimeInUnix(Date.now())}`,
        imageBuffer,
        { contentType: detectedFormat, upsert: true }
      );

    if (error) {
      throw error;
    }
    await deleteOtherImages({ userId, assetId, data });
    /** Getting the signed url from supabase to we can view image  */
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

export function createCustomFieldsPayloadFromAsset(asset: any) {
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
  asset: any;
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
        title: `${asset.title} (copy ${amountOfDuplicates > 1 ? i + 1 : ""})`,
        customFieldsValues: extractedCustomFieldValues,
      });

      if (asset.mainImage) {
        try {
          const imagePath = await uploadDuplicateAssetMainImage(
            asset.mainImage,
            duplicatedAsset.id,
            userId
          );

          if (typeof imagePath === "string") {
            await update(db, "Asset", {
              where: { id: duplicatedAsset.id },
              data: {
                mainImage: imagePath,
                mainImageExpiration: oneDayFromNow(),
              },
            });
          }
        } catch (cause) {
          // Log the error so we are aware there is an issue anc can check if it is on our side
          Logger.error(
            new ShelfError({
              cause,
              message: "Skipping duplicate asset image due to upload failure",
              additionalData: {
                assetId: duplicatedAsset.id,
                originalAssetId: asset.id,
                userId,
              },
              label,
              shouldBeCaptured: false,
            })
          );
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
  tagUseFor,
}: {
  organizationId: Organization["id"];
  request: LoaderFunctionArgs["request"];
  defaults?: {
    category?: string | string[] | null;
    tag?: string | null;
    location?: string | null;
  };
  tagUseFor?: TagUseFor;
}) {
  const searchParams = getCurrentSearchParams(request);
  const categorySelected =
    searchParams.get("category") ?? defaults?.category ?? "";
  const locationSelected =
    searchParams.get("location") ?? defaults?.location ?? "";
  const getAllEntries = searchParams.getAll("getAll") as AllowedModelNames[];

  try {
    const [
      { categories, totalCategories },
      tags,
      { locations, totalLocations },
    ] = await Promise.all([
      getCategoriesForCreateAndEdit({
        request,
        organizationId,
        defaultCategory: defaults?.category,
      }),

      /** Get the tags */
      findMany(db, "Tag", {
        where: {
          organizationId,
          OR: [
            { useFor: { isEmpty: true } },
            ...(tagUseFor ? [{ useFor: { has: tagUseFor } }] : []),
          ],
        },
        orderBy: { name: "asc" },
      }),

      /** Get the locations */
      getLocationsForCreateAndEdit({
        organizationId,
        request,
        defaultLocation: defaults?.location,
      }),
    ]);

    return {
      categories,
      totalCategories,
      tags,
      locations,
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
  kitId?: Record<string, any>;
  extraInclude?: Record<string, any>;
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
    assetKitFilter,
  } = paramsValues;

  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  try {
    const {
      tags,
      totalTags,
      categories,
      totalCategories,
      locations,
      totalLocations,
    } = await getEntitiesWithSelectedValues({
      organizationId,
      allSelectedEntries: getAllEntries,
      selectedCategoryIds: categoriesIds,
      selectedTagIds: tagsIds,
      selectedLocationIds: locationIds,
    });

    const teamMembersData = await getTeamMemberForCustodianFilter({
      organizationId,
      selectedTeamMembers: teamMemberIds,
      getAll: getAllEntries.includes("teamMember"),
      filterByUserId: isSelfService,
      userId,
    });

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
      bookingFrom: bookingFrom ?? undefined,
      bookingTo: bookingTo ?? undefined,
      hideUnavailable,
      unhideAssetsBookigIds,
      locationIds,
      teamMemberIds,
      extraInclude,
      assetKitFilter,
      availableToBookOnly: isSelfService,
    });

    const totalPages = Math.ceil(totalAssets / perPage);

    return {
      page,
      perPage,
      search,
      totalAssets,
      totalCategories,
      totalTags,
      categories: excludeCategoriesQuery ? [] : categories,
      tags: excludeTagsQuery ? [] : tags,
      assets,
      totalPages,
      cookie,
      locations: excludeLocationQuery ? [] : locations,
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

export async function createCustomFieldChangeNote({
  customFieldName,
  previousValue,
  newValue,
  firstName,
  lastName,
  assetId,
  userId,
  isFirstTimeSet,
}: {
  customFieldName: string;
  previousValue?: string | null;
  newValue?: string | null;
  firstName: string;
  lastName: string;
  assetId: Asset["id"];
  userId: User["id"];
  isFirstTimeSet: boolean;
}) {
  try {
    const message = getCustomFieldUpdateNoteContent({
      customFieldName,
      previousValue,
      newValue,
      userId,
      firstName,
      lastName,
      isFirstTimeSet,
    });

    if (!message) {
      return; // No note to create if message is empty
    }

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
        "Something went wrong while creating a custom field change note. Please try again or contact support",
      additionalData: { userId, assetId, customFieldName },
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
    // TODO: convert Prisma include to Supabase join for category/location/notes/custody/tags/customFields
    return await findMany(db, "Asset", {
      where: { organizationId },
      select:
        "*, category:Category(*), location:Location(*), notes:Note(*), custody:Custody(*, custodian:TeamMember(*)), tags:Tag(*), customFields:AssetCustomFieldValue(*, customField:CustomField(*))",
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
  canUseBarcodes,
}: {
  data: CreateAssetFromContentImportPayload[];
  userId: User["id"];
  organizationId: Organization["id"];
  canUseBarcodes?: boolean;
}) {
  try {
    // Create cache instance for this import operation
    const imageCache = new LRUCache<string, CachedImage>({
      maxSize: importImageCacheServer.MAX_CACHE_SIZE,
      sizeCalculation: (value) => {
        // Ensure size is always a positive integer to prevent LRU cache errors
        const size = value?.size || 0;
        return typeof size === "number" && size > 0 ? size : 1;
      },
    });

    const qrCodesPerAsset = await parseQrCodesFromImportData({
      data,
      organizationId,
      userId,
    });

    // Check if any assets have barcode data and if barcodes are enabled
    const hasBarcodesData = data.some(
      (asset) =>
        asset.barcode_Code128 ||
        asset.barcode_Code39 ||
        asset.barcode_DataMatrix
    );

    if (hasBarcodesData && !canUseBarcodes) {
      throw new ShelfError({
        cause: null,
        message:
          "Your workspace doesn't have barcodes enabled. Please contact sales to learn more about barcodes.",
        additionalData: { userId, organizationId },
        label: "Assets",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    // Parse barcode data if barcodes are enabled
    const barcodesPerAsset = canUseBarcodes
      ? await parseBarcodesFromImportData({
          data,
          organizationId,
          userId,
        })
      : [];

    // Validate kit-custody conflicts before any database operations
    await validateKitCustodyConflicts({
      data,
      organizationId,
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
    for (const asset of data) {
      // Generate asset ID upfront
      const assetId = id(LEGACY_CUID_LENGTH); // This generates our standard CUID format. We use legacy length(25 chars) so it fits with the length of IDS generated by prisma

      const customFieldsValues: ShelfAssetCustomFieldValueType[] =
        Object.entries(asset).reduce((res, [key, val]) => {
          if (!key.startsWith("cf:")) {
            return res;
          }

          if (
            val === undefined ||
            val === null ||
            (typeof val === "string" && val.trim() === "")
          ) {
            return res;
          }

          const { name } = getDefinitionFromCsvHeader(key);
          const definition = customFields[name];

          if (!definition?.id) {
            return res;
          }

          try {
            const value = buildCustomFieldValue(
              { raw: asset[key] },
              definition
            );

            if (value) {
              res.push({
                id: definition.id,
                value,
              } as ShelfAssetCustomFieldValueType);
            }
          } catch (error) {
            const isNumericField =
              definition.type === "AMOUNT" || definition.type === "NUMBER";

            if (isNumericField) {
              // If the error is already a ShelfError with a specific message from sanitizeNumericInput,
              // enhance it with asset context. Otherwise, create a generic message.
              let message: string;

              if (isLikeShelfError(error)) {
                // Check if asset context has already been added by checking additionalData
                const hasAssetContext =
                  error.additionalData && "assetKey" in error.additionalData;

                if (hasAssetContext) {
                  message = error.message;
                } else {
                  // Add asset context after the field name using regex to be precise
                  message = error.message.replace(
                    /^(Custom field '[^']+')(:)/,
                    `$1 (asset: '${asset.title}')$2`
                  );
                }
              } else {
                message = formatInvalidNumericCustomFieldMessage(
                  definition.name,
                  asset[key],
                  { assetTitle: asset.title }
                );
              }

              throw new ShelfError({
                cause: error,
                label,
                message,
                additionalData: {
                  assetKey: asset.key,
                  customFieldId: definition.id,
                  customFieldType: definition.type,
                  rawValue: asset[key],
                  ...(isLikeShelfError(error) && error.additionalData),
                },
                shouldBeCaptured: false,
              });
            }

            throw error;
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
          // This catch block should rarely be reached now since uploadImageFromUrl returns null instead of throwing
          // But we keep it for any unexpected errors in createSignedUrl or other operations
          const isShelfError = isLikeShelfError(cause);

          Logger.error(
            new ShelfError({
              cause,
              message: isShelfError
                ? `${cause?.message} for asset: ${asset.title}`
                : `Unexpected error during image processing for asset ${asset.title}`,
              additionalData: { imageUrl: asset.imageUrl, assetId },
              label: "Assets",
            })
          );

          // Continue with asset creation without the image
          mainImage = undefined;
          mainImageExpiration = undefined;
        }
      }

      // Get barcodes for this asset if any
      const assetBarcodes =
        barcodesPerAsset.find((item) => item.key === asset.key)?.barcodes || [];

      // Resolve kit/custodian IDs from normalized CSV values to avoid undefined lookups.
      const kitKey = asset.kit?.trim();
      const kitId = kitKey ? kits?.[kitKey]?.id : undefined;
      // Surface a clear import error instead of a TypeError when a kit value can't be resolved.
      if (kitKey && !kitId) {
        throw new ShelfError({
          cause: null,
          message: `Kit "${kitKey}" could not be resolved for asset "${asset.title}". Please verify the kit column values in your CSV.`,
          additionalData: {
            assetKey: asset.key,
            assetTitle: asset.title,
            kit: kitKey,
          },
          label: "Assets",
          shouldBeCaptured: false,
        });
      }

      const custodianKey = asset.custodian?.trim();
      const custodianId = custodianKey
        ? teamMembers?.[custodianKey]?.id
        : undefined;
      // Surface a clear import error instead of a TypeError when a custodian value can't be resolved.
      if (custodianKey && !custodianId) {
        throw new ShelfError({
          cause: null,
          message: `Custodian "${custodianKey}" could not be resolved for asset "${asset.title}". Please verify the custodian column values in your CSV.`,
          additionalData: {
            assetKey: asset.key,
            assetTitle: asset.title,
            custodian: custodianKey,
          },
          label: "Assets",
          shouldBeCaptured: false,
        });
      }

      await createAsset({
        id: assetId, // Pass the pre-generated ID
        qrId: qrCodesPerAsset.find((item) => item?.key === asset.key)?.qrId,
        organizationId,
        title: asset.title,
        description: asset.description || "",
        userId,
        kitId,
        categoryId: asset.category ? categories?.[asset.category] : null,
        locationId: asset.location ? locations?.[asset.location] : undefined,
        custodian: custodianId,
        tags:
          asset?.tags && asset.tags.length > 0
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
        // Add barcodes if present
        barcodes: assetBarcodes.length > 0 ? assetBarcodes : undefined,
      });
    }

    // Set kit custody for imported assets after all assets have been created
    await setKitCustodyAfterAssetImport({
      data,
      kits,
      teamMembers,
    });

    return true;
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);
    const rawConstraintMessage = (() => {
      if (isShelfError && cause.cause instanceof Error) {
        return cause.cause.message;
      }

      if (cause instanceof Error) {
        return cause.message;
      }

      return undefined;
    })();

    if (
      rawConstraintMessage &&
      rawConstraintMessage.includes("AssetCustomFieldValue") &&
      rawConstraintMessage.includes("ensure_value_structure_and_types")
    ) {
      throw new ShelfError({
        cause,
        label,
        message:
          "We were unable to save numeric custom field values. Please ensure AMOUNT and NUMBER fields use plain numbers without currency symbols or letters (e.g., 600.00).",
        additionalData: {
          userId,
          organizationId,
          ...(isShelfError && cause.additionalData),
        },
        shouldBeCaptured: false,
      });
    }

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
        const assetData: Record<string, any> = {
          title: asset.title,
          description: asset.description || null,
          mainImage: asset.mainImage || null,
          mainImageExpiration: oneDayFromNow(),
          userId,
          organizationId,
          status: asset.status,
          createdAt: new Date(asset.createdAt),
          updatedAt: new Date(asset.updatedAt),
          valuation: asset.valuation ? +asset.valuation : null,
        };

        /** Category */
        if (asset.category && Object.keys(asset?.category).length > 0) {
          const category = asset.category as Category;

          const existingCat = await findFirst(db, "Category", {
            where: { organizationId, name: category.name },
          });

          if (!existingCat) {
            const newCat = await create(db, "Category", {
              organizationId,
              name: category.name,
              description: category.description || "",
              color: category.color,
              userId,
              createdAt: new Date(category.createdAt),
              updatedAt: new Date(category.updatedAt),
            } as any);
            assetData.categoryId = newCat.id;
          } else {
            assetData.categoryId = existingCat.id;
          }
        }

        /** Location */
        if (asset.location && Object.keys(asset?.location).length > 0) {
          const location = asset.location as Location;

          const existingLoc = await findFirst(db, "Location", {
            where: { organizationId, name: location.name },
          });

          if (!existingLoc) {
            const newLoc = await create(db, "Location", {
              name: location.name,
              description: location.description || "",
              address: location.address || "",
              organizationId,
              userId,
              createdAt: new Date(location.createdAt),
              updatedAt: new Date(location.updatedAt),
            } as any);
            assetData.locationId = newLoc.id;
          } else {
            assetData.locationId = existingLoc.id;
          }
        }

        /** Custody — resolved after asset creation */
        let custodyTeamMemberId: string | null = null;
        if (asset.custody && Object.keys(asset?.custody).length > 0) {
          const { custodian } = asset.custody;

          const existingCustodian = await findFirst(db, "TeamMember", {
            where: { deletedAt: null, organizationId, name: custodian.name },
          });

          if (!existingCustodian) {
            const newCustodian = await create(db, "TeamMember", {
              name: custodian.name,
              organizationId,
              createdAt: new Date(custodian.createdAt),
              updatedAt: new Date(custodian.updatedAt),
            } as any);
            custodyTeamMemberId = newCustodian.id;
          } else {
            custodyTeamMemberId = existingCustodian.id;
          }
        }

        /** Tags — resolved after asset creation */
        const tagIds: string[] = [];
        if (asset.tags && asset.tags.length > 0) {
          const tagsNames = asset.tags.map((t) => t.name);
          const tags: Record<string, string> = {};
          for (const tag of tagsNames) {
            const existingTag = await findFirst(db, "Tag", {
              where: { name: tag, organizationId },
            });

            if (!existingTag) {
              const newTag = await create(db, "Tag", {
                name: tag as string,
                userId,
                organizationId,
              } as any);
              tags[tag] = newTag.id;
            } else {
              tags[tag] = existingTag.id;
            }
          }

          for (const tag of asset.tags) {
            if (tags[tag.name]) {
              tagIds.push(tags[tag.name]);
            }
          }
        }

        /** Custom fields — resolved after asset creation */
        let customFieldCreateData: Array<{
          value: any;
          customFieldId: string;
        }> = [];
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

          customFieldCreateData = asset.customFields.map((cf) => ({
            value: cf.value,
            // @ts-ignore
            customFieldId: cfIds[cf.customField.name].id,
          }));
        }

        /** Create the Asset */
        const createdAsset = await create(db, "Asset", assetData as any);
        const assetId = createdAsset.id;

        /** Create QR code for the asset */
        await create(db, "Qr", {
          id: id(),
          version: 0,
          errorCorrection: ErrorCorrection["L"],
          userId,
          organizationId,
          assetId,
        } as any);

        /** Create custody if needed */
        if (custodyTeamMemberId) {
          await create(db, "Custody", {
            assetId,
            teamMemberId: custodyTeamMemberId,
          } as any);
        }

        /** Connect tags via join table */
        for (const tagId of tagIds) {
          await create(
            db,
            "_AssetToTag" as any,
            {
              A: assetId,
              B: tagId,
            } as any
          );
        }

        /** Create custom field values */
        for (const cf of customFieldCreateData) {
          await create(db, "AssetCustomFieldValue", {
            ...cf,
            assetId,
          } as any);
        }

        /** Create notes */
        if (asset?.notes?.length > 0) {
          await createMany(
            db,
            "Note",
            asset.notes.map((note: Note) => ({
              content: note.content,
              type: note.type,
              assetId,
              userId,
              createdAt: new Date(note.createdAt),
              updatedAt: new Date(note.updatedAt),
            })) as any
          );
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
    return await update(db, "Asset", {
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

      // TODO: convert Prisma nested select/where to Supabase join
      const assetsWithCustodians: any[] = await findMany(db, "Asset", {
        where: { id: { in: checkedOutAssetsIds } },
        select:
          "id, bookings:Booking(id, custodianTeamMember:TeamMember(*), custodianUser:User(firstName, lastName, profilePicture))",
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

          /** Data integrity edge case: asset is CHECKED_OUT but booking has no custodian assigned */
          Logger.warn(
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
  try {
    // Disconnect all existing QR codes by setting assetId to null
    try {
      await updateMany(db, "Qr", {
        where: { assetId },
        data: { assetId: null },
      });
    } catch (cause) {
      throw new ShelfError({
        cause,
        message: "Couldn't disconnect existing codes",
        label,
        additionalData: { assetId, organizationId, newQrId },
      });
    }

    // Connect the new QR code
    try {
      await update(db, "Qr", {
        where: { id: newQrId },
        data: { assetId, organizationId },
      });
    } catch (cause) {
      throw new ShelfError({
        cause,
        message: "Couldn't connect the new QR code",
        label,
        additionalData: { assetId, organizationId, newQrId },
      });
    }

    return await findUniqueOrThrow(db, "Asset", {
      where: { id: assetId, organizationId },
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
  settings,
}: {
  assetIds: Asset["id"][];
  organizationId: Asset["organizationId"];
  userId: User["id"];
  currentSearchParams?: string | null;
  settings: AssetIndexSettings;
}) {
  try {
    // Resolve IDs (works for both simple and advanced mode)
    const resolvedIds = await resolveAssetIdsForBulkOperation({
      assetIds,
      organizationId,
      currentSearchParams,
      settings,
    });

    /**
     * We have to remove the images of assets so we have to make this query first
     */
    const assets = await findMany(db, "Asset", {
      where: { id: { in: resolvedIds }, organizationId },
      select: "id, mainImage",
    });

    try {
      await deleteMany(db, "Asset", {
        id: { in: assets.map((asset) => asset.id) },
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
  settings,
}: {
  userId: User["id"];
  assetIds: Asset["id"][];
  custodianId: TeamMember["id"];
  custodianName: TeamMember["name"];
  organizationId: Asset["organizationId"];
  currentSearchParams?: string | null;
  settings: AssetIndexSettings;
}) {
  try {
    // Resolve IDs (works for both simple and advanced mode)
    const resolvedIds = await resolveAssetIdsForBulkOperation({
      assetIds,
      organizationId,
      currentSearchParams,
      settings,
    });

    /**
     * In order to make notes for the assets we have to make this query to get info about assets
     */
    const [assets, user, custodianTeamMember] = await Promise.all([
      findMany(db, "Asset", {
        where: { id: { in: resolvedIds }, organizationId },
        select: "id, title, status",
      }),
      getUserByID(userId, {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        } as Record<string, any>,
      }),
      findUnique(db, "TeamMember", {
        where: { id: custodianId },
        select: "name, user:User(id, firstName, lastName)",
      }) as Promise<any>,
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
     * TODO: convert Prisma $transaction to Supabase RPC or sequential queries
     * For now, run sequentially without transaction wrapper
     */
    /** Creating custodies over assets */
    await createMany(
      db,
      "Custody",
      assets.map((asset) => ({
        assetId: asset.id,
        teamMemberId: custodianId,
      })) as any
    );

    /** Updating status of assets to IN_CUSTODY */
    await updateMany(db, "Asset", {
      where: { id: { in: assets.map((asset) => asset.id) } },
      data: { status: AssetStatus.IN_CUSTODY },
    });

    /** Creating notes for the assets */
    const actor = wrapUserLinkForNote({
      id: userId,
      firstName: user.firstName,
      lastName: user.lastName,
    });

    const custodianDisplay = custodianTeamMember
      ? wrapCustodianForNote({ teamMember: custodianTeamMember })
      : `**${custodianName.trim()}**`;

    await createMany(
      db,
      "Note",
      assets.map((asset) => ({
        content: `${actor} granted ${custodianDisplay} custody.`,
        type: "UPDATE",
        userId,
        assetId: asset.id,
      })) as any
    );

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
  settings,
}: {
  userId: User["id"];
  assetIds: Asset["id"][];
  organizationId: Asset["organizationId"];
  currentSearchParams?: string | null;
  settings: AssetIndexSettings;
}) {
  try {
    // Resolve IDs (works for both simple and advanced mode)
    const resolvedIds = await resolveAssetIdsForBulkOperation({
      assetIds,
      organizationId,
      currentSearchParams,
      settings,
    });

    /**
     * In order to make notes for the assets we have to make this query to get info about assets
     */
    // TODO: convert Prisma nested select to Supabase join for custody/custodian/user
    const [assets, user]: [any[], any] = await Promise.all([
      findMany(db, "Asset", {
        where: { id: { in: resolvedIds }, organizationId },
        select:
          "id, title, custody:Custody(id, custodian:TeamMember(*, user:User(*)))",
      }),
      getUserByID(userId, {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        } as Record<string, any>,
      }),
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
     * TODO: convert Prisma $transaction to Supabase RPC or sequential queries
     * For now, run sequentially without transaction wrapper
     */
    /** Deleting custodies over assets */
    const custodyIds = assets.map((asset) => {
      if (!asset.custody) {
        throw new ShelfError({
          cause: null,
          label: "Assets",
          message: "Could not find custody over asset.",
        });
      }
      return asset.custody.id;
    });

    await deleteMany(db, "Custody", { id: { in: custodyIds } });

    /** Updating status of assets to AVAILABLE */
    await updateMany(db, "Asset", {
      where: { id: { in: assets.map((asset) => asset.id) } },
      data: { status: AssetStatus.AVAILABLE },
    });

    /** Creating notes for the assets */
    await createMany(
      db,
      "Note",
      assets.map((asset) => ({
        content: `**${user.firstName?.trim()} ${
          user.lastName
        }** has released **${resolveTeamMemberName(
          asset.custody!.custodian
        )}'s** custody over **${asset.title?.trim()}**`,
        type: "UPDATE",
        userId,
        assetId: asset.id,
      })) as any
    );

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
  settings,
}: {
  userId: User["id"];
  assetIds: Asset["id"][];
  organizationId: Asset["organizationId"];
  newLocationId?: Location["id"] | null;
  currentSearchParams?: string | null;
  settings: AssetIndexSettings;
}) {
  try {
    // Resolve IDs (works for both simple and advanced mode)
    const resolvedIds = await resolveAssetIdsForBulkOperation({
      assetIds,
      organizationId,
      currentSearchParams,
      settings,
    });

    /** We have to create notes for all the assets so we have make this query */
    // TODO: convert Prisma nested select to Supabase join for location/kit
    const [assets, user]: [any[], any] = await Promise.all([
      findMany(db, "Asset", {
        where: { id: { in: resolvedIds }, organizationId },
        select: "id, title, location:Location(*), kit:Kit(id, name)",
      }),
      getUserByID(userId, {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        } as Record<string, any>,
      }),
    ]);

    // Check if any assets belong to kits and prevent bulk location updates
    const assetsInKits = assets.filter((asset) => asset.kit);
    if (assetsInKits.length > 0) {
      const kitNames = Array.from(
        new Set(assetsInKits.map((asset) => asset.kit?.name))
      ).join(", ");
      throw new ShelfError({
        cause: null,
        message: `Cannot update location for assets that belong to kits: ${kitNames}. Update the kit locations instead.`,
        additionalData: {
          assetIds: assetsInKits.map((asset) => asset.id),
          kitNames,
          userId,
          organizationId,
        },
        label: "Assets",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    const newLocation = newLocationId
      ? await findFirst(db, "Location", {
          where: { id: newLocationId, organizationId },
        })
      : null;

    // Filter out assets already at the target location
    const assetsToUpdate = assets.filter(
      (a) => a.location?.id !== newLocation?.id
    );

    // TODO: convert Prisma $transaction to Supabase RPC or sequential queries
    if (assetsToUpdate.length > 0) {
      /** Updating location of assets to newLocation */
      await updateMany(db, "Asset", {
        where: { id: { in: assetsToUpdate.map((asset) => asset.id) } },
        data: { locationId: newLocation?.id ? newLocation.id : null },
      });

      /** Creating notes for the assets */
      await createMany(
        db,
        "Note",
        assetsToUpdate.map((asset) => {
          const isRemoving = !newLocationId;

          const content = getLocationUpdateNoteContent({
            currentLocation: asset.location,
            newLocation,
            userId,
            firstName: user?.firstName ?? "",
            lastName: user?.lastName ?? "",
            isRemoving,
          });

          return {
            content,
            type: "UPDATE",
            userId,
            assetId: asset.id,
          };
        }) as any
      );
    }

    // Create location activity notes
    const userLink = wrapUserLinkForNote({
      id: userId,
      firstName: user?.firstName,
      lastName: user?.lastName,
    });
    // Filter out assets already at the target location
    const actuallyChanged = assets.filter(
      (a) => a.location?.id !== newLocation?.id
    );
    const assetData = actuallyChanged.map((a) => ({
      id: a.id,
      title: a.title,
    }));

    // Group assets by their previous location
    const byPrevLocation = new Map<
      string,
      { name: string; assets: typeof assetData }
    >();
    for (const asset of actuallyChanged) {
      if (!asset.location) continue;
      const existing = byPrevLocation.get(asset.location.id);
      if (existing) {
        existing.assets.push({ id: asset.id, title: asset.title });
      } else {
        byPrevLocation.set(asset.location.id, {
          name: asset.location.name,
          assets: [{ id: asset.id, title: asset.title }],
        });
      }
    }

    // Note on the new location
    if (newLocation && assetData.length > 0) {
      const newLocLink = wrapLinkForNote(
        `/locations/${newLocation.id}`,
        newLocation.name
      );
      const assetMarkup = wrapAssetsWithDataForNote(assetData, "added");

      const prevLocLinks = [...byPrevLocation.entries()].map(([id, { name }]) =>
        wrapLinkForNote(`/locations/${id}`, name)
      );
      const movedFromSuffix =
        prevLocLinks.length > 0
          ? ` Moved from ${prevLocLinks.join(", ")}.`
          : "";

      await createSystemLocationNote({
        locationId: newLocation.id,
        content: `${userLink} added ${assetMarkup} to ${newLocLink}.${movedFromSuffix}`,
        userId,
      });
    }

    // Removal notes on previous locations
    for (const [locId, { name, assets: locAssets }] of byPrevLocation) {
      const prevLocLink = wrapLinkForNote(`/locations/${locId}`, name);
      const assetMarkup = wrapAssetsWithDataForNote(locAssets, "removed");
      const movedToSuffix = newLocation
        ? ` Moved to ${wrapLinkForNote(
            `/locations/${newLocation.id}`,
            newLocation.name
          )}.`
        : "";
      await createSystemLocationNote({
        locationId: locId,
        content: `${userLink} removed ${assetMarkup} from ${prevLocLink}.${movedToSuffix}`,
        userId,
      });
    }

    return true;
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);

    throw new ShelfError({
      cause,
      message: isShelfError
        ? cause.message
        : "Something went wrong while bulk updating location.",
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
  settings,
}: {
  userId: string;
  assetIds: Asset["id"][];
  organizationId: Asset["organizationId"];
  categoryId: Asset["categoryId"];
  currentSearchParams?: string | null;
  settings: AssetIndexSettings;
}) {
  try {
    // Resolve IDs (works for both simple and advanced mode)
    const resolvedIds = await resolveAssetIdsForBulkOperation({
      assetIds,
      organizationId,
      currentSearchParams,
      settings,
    });

    await updateMany(db, "Asset", {
      where: { id: { in: resolvedIds }, organizationId },
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
  settings,
}: {
  userId: string;
  assetIds: Asset["id"][];
  organizationId: Asset["organizationId"];
  tagsIds: string[];
  currentSearchParams?: string | null;
  remove: boolean;
  settings: AssetIndexSettings;
}) {
  try {
    // Resolve IDs (works for both simple and advanced mode)
    const resolvedIds = await resolveAssetIdsForBulkOperation({
      assetIds,
      organizationId,
      currentSearchParams,
      settings,
    });

    if (resolvedIds.length === 0) {
      return true;
    }

    const loadUserForNotes = createLoadUserForNotes(userId);

    // TODO: convert Prisma nested select to Supabase join for tags
    const assetsWithTags: any[] = await findMany(db, "Asset", {
      where: { id: { in: resolvedIds }, organizationId },
      select: "id, tags:Tag(id, name)",
    });
    const previousTagsByAssetId = assetsWithTags.reduce<
      Map<string, TagSummary[]>
    >((acc, asset) => {
      acc.set(asset.id, asset.tags ?? []);
      return acc;
    }, new Map());

    // Handle tag connect/disconnect via join table
    for (const assetId of resolvedIds) {
      if (remove) {
        // Disconnect: remove tag associations
        for (const tagId of tagsIds) {
          await deleteMany(
            db,
            "_AssetToTag" as any,
            {
              A: assetId,
              B: tagId,
            } as any
          );
        }
      } else {
        // Connect: add tag associations (ignore if already exists)
        for (const tagId of tagsIds) {
          try {
            await create(
              db,
              "_AssetToTag" as any,
              {
                A: assetId,
                B: tagId,
              } as any
            );
          } catch {
            // Ignore unique constraint violations (tag already connected)
          }
        }
      }
    }

    // Re-fetch assets with updated tags for change notes
    const updatedAssets: any[] = await findMany(db, "Asset", {
      where: { id: { in: resolvedIds }, organizationId },
      select: "id, tags:Tag(id, name)",
    });

    await Promise.all(
      updatedAssets.map((asset) =>
        createTagChangeNoteIfNeeded({
          assetId: asset.id,
          userId,
          previousTags: previousTagsByAssetId.get(asset.id) ?? [],
          currentTags: asset.tags ?? [],
          loadUserForNotes,
        })
      )
    );

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
  settings,
}: {
  organizationId: Asset["organizationId"];
  assetIds: Asset["id"][];
  type: "available" | "unavailable";
  currentSearchParams?: string | null;
  settings: AssetIndexSettings;
}) {
  try {
    // Resolve IDs (works for both simple and advanced mode)
    const resolvedIds = await resolveAssetIdsForBulkOperation({
      assetIds,
      organizationId,
      currentSearchParams,
      settings,
    });

    // Simple, consistent where clause
    await updateMany(db, "Asset", {
      where: {
        id: { in: resolvedIds },
        organizationId,
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

/**
 * Relinks an asset to a different QR code, unlinking any previous code.
 * Throws if the QR belongs to another org, asset, or kit.
 */
export async function relinkAssetQrCode({
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
  // TODO: convert Prisma nested select to Supabase join for qrCodes
  const [qr, user, asset]: [any, any, any] = await Promise.all([
    getQr({ id: qrId }),
    getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
      } as Record<string, any>,
    }),
    findFirst(db, "Asset", {
      where: { id: assetId, organizationId },
      select: "id",
    }),
  ]);

  // Get existing QR codes for the asset
  const existingQrCodes = await findMany(db, "Qr", {
    where: { assetId },
    select: "id",
  });
  const oldQrCode = existingQrCodes[0];

  /** User cannot link qr code of other organization */
  if (qr.organizationId && qr.organizationId !== organizationId) {
    throw new ShelfError({
      cause: null,
      title: "QR not valid.",
      message: "This QR code does not belong to your organization",
      label: "QR",
    });
  }

  if (qr.kitId) {
    throw new ShelfError({
      cause: null,
      title: "QR already linked.",
      message:
        "You cannot link to this code because its already linked to another kit. Delete the other kit to free up the code and try again.",
      label: "QR",
      shouldBeCaptured: false,
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

  await Promise.all([
    // Update the QR code's org and user
    update(db, "Qr", {
      where: { id: qr.id },
      data: { organizationId, userId },
    }),
    // Disconnect all existing QR codes from asset
    updateMany(db, "Qr", {
      where: { assetId },
      data: { assetId: null },
    }),
  ]);

  // Connect the new QR code to the asset
  await update(db, "Qr", {
    where: { id: qr.id },
    data: { assetId },
  });

  await createNote({
    assetId,
    userId,
    type: "UPDATE",
    content: `${wrapUserLinkForNote({
      id: userId,
      firstName: user.firstName,
      lastName: user.lastName,
    })} changed QR code ${
      oldQrCode ? `from **${oldQrCode.id}**` : ""
    } to **${qrId}**.`,
  });
}

export async function getUserAssetsTabLoaderData({
  userId,
  request,
  organizationId,
}: {
  userId: User["id"];
  request: Request;
  organizationId: Organization["id"];
}) {
  try {
    const { filters } = await getFiltersFromRequest(
      request,
      organizationId,
      { name: "assetFilter_v2", path: "/" } // Use root path for RR7 single fetch
    );

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

/**
 * This function returns the categories, tags and locations
 * including already selected items
 *
 * e.g if `id1` is selected for tag then it will return `[id1, ...other tags]` for tags
 */
export async function getEntitiesWithSelectedValues({
  organizationId,
  allSelectedEntries,
  selectedTagIds = [],
  selectedCategoryIds = [],
  selectedLocationIds = [],
}: {
  organizationId: Organization["id"];
  allSelectedEntries: AllowedModelNames[];
  selectedTagIds: Array<Tag["id"]>;
  selectedCategoryIds: Array<Category["id"]>;
  selectedLocationIds: Array<Location["id"]>;
}) {
  const [
    // Categories
    categoryExcludedSelected,
    selectedCategories,
    totalCategories,

    // Tags
    tagsExcludedSelected,
    selectedTags,
    totalTags,

    // Locations
    locationExcludedSelected,
    selectedLocations,
    totalLocations,
  ] = await Promise.all([
    /** Categories start */
    findMany(db, "Category", {
      where: { organizationId, id: { notIn: selectedCategoryIds } },
      take: allSelectedEntries.includes("category") ? undefined : 12,
    }),
    findMany(db, "Category", {
      where: { organizationId, id: { in: selectedCategoryIds } },
    }),
    count(db, "Category", { organizationId }),
    /** Categories end */

    /** Tags start */
    findMany(db, "Tag", {
      where: {
        organizationId,
        id: { notIn: selectedTagIds },
        OR: [
          { useFor: { isEmpty: true } },
          { useFor: { has: TagUseFor.ASSET } },
        ],
      },
      take: allSelectedEntries.includes("tag") ? undefined : 12,
      orderBy: { name: "asc" },
    }),
    findMany(db, "Tag", {
      where: {
        organizationId,
        id: { in: selectedTagIds },
        OR: [
          { useFor: { isEmpty: true } },
          { useFor: { has: TagUseFor.ASSET } },
        ],
      },
      orderBy: { name: "asc" },
    }),
    count(db, "Tag", {
      organizationId,
      OR: [{ useFor: { isEmpty: true } }, { useFor: { has: TagUseFor.ASSET } }],
    }),
    /** Tags end */

    /** Location start */
    findMany(db, "Location", {
      where: { organizationId, id: { notIn: selectedLocationIds } },
      take: allSelectedEntries.includes("location") ? undefined : 12,
    }),
    findMany(db, "Location", {
      where: { organizationId, id: { in: selectedLocationIds } },
    }),
    count(db, "Location", { organizationId }),
    /** Location end */
  ]);

  return {
    categories: [...selectedCategories, ...categoryExcludedSelected],
    totalCategories,
    tags: [...selectedTags, ...tagsExcludedSelected],
    totalTags,
    locations: [...selectedLocations, ...locationExcludedSelected],
    totalLocations,
  };
}

export async function getCategoriesForCreateAndEdit({
  organizationId,
  request,
  defaultCategory,
}: {
  organizationId: Organization["id"];
  request: Request;
  defaultCategory?: string | string[] | null;
}) {
  const searchParams = getCurrentSearchParams(request);
  const categorySelected =
    searchParams.get("category") ?? defaultCategory ?? "";
  const getAllEntries = searchParams.getAll("getAll") as AllowedModelNames[];

  try {
    const [categoryExcludedSelected, selectedCategories, totalCategories] =
      await Promise.all([
        findMany(db, "Category", {
          where: {
            organizationId,
            id: Array.isArray(categorySelected)
              ? { notIn: categorySelected }
              : { not: categorySelected },
          },
          take: getAllEntries.includes("category") ? undefined : 12,
        }),
        findMany(db, "Category", {
          where: {
            organizationId,
            id: Array.isArray(categorySelected)
              ? { in: categorySelected }
              : categorySelected,
          },
        }),
        count(db, "Category", { organizationId }),
      ]);

    return {
      categories: [...selectedCategories, ...categoryExcludedSelected],
      totalCategories,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching categories",
      additionalData: { organizationId, categorySelected },
      label,
    });
  }
}

export async function getLocationsForCreateAndEdit({
  organizationId,
  request,
  defaultLocation,
}: {
  organizationId: Organization["id"];
  request: Request;
  defaultLocation?: string | null;
}) {
  try {
    const searchParams = getCurrentSearchParams(request);
    const locationSelected =
      searchParams.get("location") ?? defaultLocation ?? "";
    const getAllEntries = searchParams.getAll("getAll") as AllowedModelNames[];

    const [locationExcludedSelected, selectedLocation, totalLocations] =
      await Promise.all([
        findMany(db, "Location", {
          where: { organizationId, id: { not: locationSelected } },
          take: getAllEntries.includes("location") ? undefined : 12,
        }),
        findMany(db, "Location", {
          where: { organizationId, id: locationSelected },
        }),
        count(db, "Location", { organizationId }),
      ]);

    return {
      locations: [...selectedLocation, ...locationExcludedSelected],
      totalLocations,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching tags",
      additionalData: { organizationId, defaultLocation },
      label,
    });
  }
}
