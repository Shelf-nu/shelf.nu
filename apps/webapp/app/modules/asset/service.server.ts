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
} from "@prisma/client";
import {
  AssetStatus,
  AssetType,
  BookingStatus,
  ConsumptionType,
  ErrorCorrection,
  KitStatus,
  OrganizationRoles,
  Prisma,
  TagUseFor,
} from "@prisma/client";
import { LRUCache } from "lru-cache";
import type { LoaderFunctionArgs } from "react-router";
import { extractStoragePath } from "~/components/assets/asset-image/utils";
import type { Filter } from "~/components/assets/assets-index/advanced-filters/schema";
import type {
  SortingDirection,
  SortingOptions,
} from "~/components/list/filters/sort-by";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { getPrimaryLocation, isQuantityTracked } from "~/modules/asset/utils";
import {
  updateBarcodes,
  validateBarcodeUniqueness,
  parseBarcodesFromImportData,
} from "~/modules/barcode/service.server";
import { normalizeBarcodeValue } from "~/modules/barcode/validation";
import {
  createCategoriesIfNotExists,
  getCategory,
} from "~/modules/category/service.server";
import { getPrimaryCustody, hasCustody } from "~/modules/custody/utils";
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
import {
  assetQtyMeta,
  formatUnitCount,
  sanitizeUnitOfMeasureLabel,
} from "~/utils/asset-quantity";
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
  wrapAssetWithCountForNote,
  wrapLinkForNote,
} from "~/utils/markdoc-wrappers";
import { isValidImageUrl } from "~/utils/misc";
import { threeDaysFromNow } from "~/utils/one-week-from-now";
import {
  assertAssetModelBelongsToOrg,
  assertAssetsBelongToOrg,
  assertCustomFieldsBelongToOrg,
  assertLocationBelongsToOrg,
  assertTagsBelongToOrg,
  assertTeamMemberBelongsToOrg,
} from "~/utils/org-validation.server";
import {
  createSignedUrl,
  parseFileFormData,
  uploadImageFromUrl,
} from "~/utils/storage.server";
import { resolveTeamMemberName, resolveUserDisplayName } from "~/utils/user";
import { resolveAssetIdsForBulkOperation } from "./bulk-operations-helper.server";
import { assetIndexFields } from "./fields";
import type {
  MoveAssetLocationUnitsArgs,
  MoveUnitsResult,
  PlaceUnplacedUnitsArgs,
  PlaceUnplacedUnitsResult,
} from "./move-units.types";
import { validateQtyTrackedFields } from "./qty-validation.server";
import {
  CUSTOM_FIELD_SEARCH_PATHS,
  buildAdvancedAssetsQuery,
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
import { recordEvent, recordEvents } from "../activity-event/service.server";
import type { Column } from "../asset-index-settings/helpers";
import {
  createAssetModelsIfNotExists,
  getAssetModel,
} from "../asset-model/service.server";
import { cancelAssetReminderScheduler } from "../asset-reminder/scheduler.server";
import { lockAssetForQuantityUpdate } from "../consumption-log/quantity-lock.server";
import { createConsumptionLog } from "../consumption-log/service.server";
import { createKitsIfNotExists } from "../kit/service.server";
import { createSystemLocationNote } from "../location-note/service.server";
import {
  createAssetCategoryChangeNote,
  createAssetDescriptionChangeNote,
  createAssetNameChangeNote,
  createAssetQuantityChangeNote,
  createAssetValuationChangeNote,
  createNote,
  createTagChangeNoteIfNeeded,
  type TagSummary,
} from "../note/service.server";
import { getUserByID } from "../user/service.server";

const label: ErrorLabel = "Assets";

const ASSET_BEFORE_UPDATE_SELECT = Prisma.validator<Prisma.AssetSelect>()({
  title: true,
  description: true,
  preferredBarcodeId: true,
  category: {
    select: {
      id: true,
      name: true,
      color: true,
    },
  },
  valuation: true,
  quantity: true,
  minQuantity: true,
  consumptionType: true,
  unitOfMeasure: true,
  organization: {
    select: {
      currency: true,
    },
  },
  tags: {
    select: {
      id: true,
      name: true,
    },
  },
});

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
}) {
  if (!shouldFetch) {
    return null;
  }

  return db.asset.findUnique({
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
      await db.kit.update({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: kit comes from the `kits` map built by createKitsIfNotExists({ organizationId }) at the call site (line ~2657); all ids are already org-scoped
        where: { id: kit.id },
        data: {
          status: KitStatus.IN_CUSTODY,
          custody: {
            create: {
              custodian: { connect: { id: teamMember.id } },
            },
          },
        },
      });
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

  // Fetch existing kits and their custody status in one query.
  const existingKitsRaw = await db.kit.findMany({
    where: {
      name: { in: kitNames },
      organizationId,
    },
    select: {
      id: true,
      name: true,
      custody: {
        select: {
          id: true,
          custodian: {
            select: {
              name: true,
            },
          },
        },
      },
      assetKits: {
        select: {
          asset: { select: { id: true } },
        },
      },
    },
  });

  // Flatten pivot rows into the in-memory `assets` shape the existing
  // conflict logic expects.
  const existingKits = existingKitsRaw.map((kit) => ({
    ...kit,
    assets: kit.assetKits.map((ak) => ak.asset),
  }));

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
 * Matches the shape of an asset identifier or barcode / QR id. Two forms:
 *   - bare numeric ("21035", or a 12-digit UPC) — users commonly drop the
 *     prefix when scanning or typing an ID
 *   - canonical sequential ID ("SAM-0001") — letter prefix + dash + 4+
 *     digits, matching the format produced by getNextSequentialId
 *
 * Used by getAssets to run ID-shaped queries against a narrower OR clause
 * (sequentialId / barcodes.value / qrCodes.id) first, instead of the full
 * 10-branch chain. The narrower clause skips the slow paths — custodian
 * name traversal and the unindexed customFields JSON ILIKE — while still
 * covering every place an ID-shaped value is *most likely* to live.
 *
 * Because a bare number can equally be a real barcode OR a value embedded
 * in a title / description / custom field (indistinguishable by shape),
 * getAssets falls back to the full search when this narrow clause returns
 * zero rows — so nothing is ever silently missed. See the fallback re-query
 * in {@link getAssets}.
 *
 * Loose terms like "lab-12" or "AS1000" don't match here and go straight to
 * the full search, since they're more likely substrings of titles, custom
 * fields, etc.
 */
function looksLikeAssetId(term: string): boolean {
  return /^\d+$/.test(term) || /^[a-z]+-\d{4,}$/i.test(term);
}

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
  extraInclude?: Prisma.AssetInclude;
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

    const where: Prisma.AssetWhereInput = { organizationId };

    // Lazily builds the full multi-column search clause. Held as a builder
    // (not a prebuilt value) so a successful narrow ID lookup never pays to
    // construct the 10-branch clause it won't use; it is only invoked by the
    // non-ID path or by the fallback re-query when the narrow query is empty.
    let shouldFallbackToFullSearch = false;
    let buildFullSearchOr: (() => Prisma.AssetWhereInput[]) | undefined;
    // Number of OR entries the narrow search contributed. Later filters
    // (uncategorized / untagged / without-location / team-member) also append
    // to `where.OR`, so the fallback re-query replaces only these first
    // entries with the full clause and preserves the appended filter clauses.
    let narrowSearchOrCount = 0;

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

      if (searchTerms.length > 0) {
        // Builder for the full multi-column clause: matches a term anywhere it
        // can legitimately live — title, sequentialId, description, category,
        // location, tags, custodian names, QR/barcode, and custom fields. It
        // is the slow path (custodian relation traversal + an unindexed
        // customFields JSON ILIKE), so for ID-shaped searches we run the
        // narrow clause first and only build/use this when it finds nothing
        // (see the fallback re-query further down). Defined as a closure so the
        // clause is constructed only when actually needed.
        buildFullSearchOr = () =>
          searchTerms.map((term) => ({
            OR: [
              // Search in asset fields
              { title: { contains: term, mode: "insensitive" } },
              // Search in asset sequential id
              { sequentialId: { contains: term, mode: "insensitive" } },
              // Search in asset description
              { description: { contains: term, mode: "insensitive" } },
              // Search in related category
              { category: { name: { contains: term, mode: "insensitive" } } },
              // Search in related location — traverses the AssetLocation pivot
              // since an asset can be placed at multiple locations.
              {
                assetLocations: {
                  some: {
                    location: {
                      name: { contains: term, mode: "insensitive" },
                    },
                  },
                },
              },
              // Search in related tags
              {
                tags: {
                  some: { name: { contains: term, mode: "insensitive" } },
                },
              },
              // Search in custodian names — custody is a list relation, so
              // traverse it with `some`.
              {
                custody: {
                  some: {
                    custodian: {
                      OR: [
                        { name: { contains: term, mode: "insensitive" } },
                        {
                          user: {
                            OR: [
                              {
                                firstName: {
                                  contains: term,
                                  mode: "insensitive",
                                },
                              },
                              {
                                lastName: {
                                  contains: term,
                                  mode: "insensitive",
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                },
              },
              // Search qr code id
              {
                qrCodes: {
                  some: { id: { contains: term, mode: "insensitive" } },
                },
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

        // Fast path: when every term looks like an asset identifier — either
        // bare digits ("21035", a UPC barcode) or canonical sequentialId
        // ("SAM-0001") — narrow the OR clause to the columns where an
        // ID-shaped value can legitimately live: sequentialId, barcode value,
        // QR id, plus title and description. The ID columns are covered by
        // trigram GIN indexes added in migration 20260525110348, and
        // title/description are covered by the composite trigram GIN index
        // Asset_title_description_idx — so the planner stays on indexed scans
        // and a real ID lookup (the common case) returns immediately.
        //
        // title + description are included here (not deferred to the fallback)
        // because a bare-numeric term often lives ONLY inside a title — e.g.
        // searching "451" must match "KCI-451 Kids Resources Box". Without
        // these branches the narrow query can still return rows (some OTHER
        // asset matches "451" in an ID column), which suppresses the
        // zero-row fallback and silently drops the title-only match.
        //
        // The fallback flag stays set so the remaining slow-path columns
        // (custodian names, category/location/tags, custom-field JSON ILIKE)
        // are still covered when this clause returns zero rows.
        if (searchTerms.every(looksLikeAssetId)) {
          shouldFallbackToFullSearch = true;
          where.OR = searchTerms.flatMap((term) => [
            { sequentialId: { contains: term, mode: "insensitive" } },
            {
              barcodes: {
                some: { value: { contains: term, mode: "insensitive" } },
              },
            },
            {
              qrCodes: {
                some: { id: { contains: term, mode: "insensitive" } },
              },
            },
            // Trigram-indexed (Asset_title_description_idx) — matches a
            // bare-numeric substring embedded in a title/description directly
            // in the fast path, without relying on the zero-row fallback.
            { title: { contains: term, mode: "insensitive" } },
            { description: { contains: term, mode: "insensitive" } },
          ]);
          // Remember how many entries belong to the search so the fallback can
          // swap them out without disturbing filter clauses appended later.
          narrowSearchOrCount = where.OR.length;
        } else {
          // Not an ID-shaped search — go straight to the full clause.
          where.OR = buildFullSearchOr();
        }
      }
    }

    if (status) {
      // why: Asset.status flips to IN_CUSTODY/CHECKED_OUT for QUANTITY_TRACKED
      // assets as soon as ANY unit is allocated, even if other units remain
      // available. Filtering with `where.status = AVAILABLE` would incorrectly
      // exclude qty-tracked rows that still have free stock. Treat AVAILABLE
      // as inclusive of all qty-tracked rows; row.status keeps the existing
      // strict semantic for IN_CUSTODY / CHECKED_OUT (which are already
      // truthful for qty-tracked — the row enters those states whenever ANY
      // unit does).
      if (status === AssetStatus.AVAILABLE) {
        where.AND = [
          ...(Array.isArray(where.AND)
            ? where.AND
            : where.AND
            ? [where.AND]
            : []),
          {
            OR: [
              { type: "INDIVIDUAL", status: AssetStatus.AVAILABLE },
              { type: "QUANTITY_TRACKED" },
            ],
          },
        ];
      } else {
        where.status = status;
      }
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
      /**
       * For INDIVIDUAL assets, exclude those with active custody.
       * For QUANTITY_TRACKED assets, always show them — partial availability
       * is checked at booking time based on available quantity.
       */
      where.AND = [
        ...(Array.isArray(where.AND)
          ? where.AND
          : where.AND
          ? [where.AND]
          : []),
        {
          OR: [{ type: "QUANTITY_TRACKED" }, { custody: { none: {} } }],
        },
      ];
      if (bookingFrom && bookingTo) {
        /**
         * Booking overlap filters only apply to INDIVIDUAL assets.
         * QUANTITY_TRACKED assets can have multiple overlapping bookings
         * as long as total reserved doesn't exceed available quantity.
         * Availability is validated at booking time, not at filter time.
         */
        where.AND = [
          ...(Array.isArray(where.AND)
            ? where.AND
            : where.AND
            ? [where.AND]
            : []),
          // Rule 1: Exclude INDIVIDUAL assets from RESERVED bookings
          {
            OR: [
              { type: "QUANTITY_TRACKED" },
              {
                bookingAssets: {
                  none: {
                    booking: {
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
              },
            ],
          },
          // Rule 2: For ONGOING/OVERDUE bookings, only exclude CHECKED_OUT INDIVIDUAL assets
          {
            OR: [
              { type: "QUANTITY_TRACKED" },
              // Either asset is AVAILABLE (checked in from partial check-in)
              { status: AssetStatus.AVAILABLE },
              // Or asset has no conflicting ONGOING/OVERDUE bookings
              {
                bookingAssets: {
                  none: {
                    booking: {
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
          { assetLocations: { some: { locationId: { in: locationIds } } } },
          { assetLocations: { none: {} } },
        ];
      } else {
        where.assetLocations = {
          some: { locationId: { in: locationIds } },
        };
      }
    }

    /**
     * `hideUnavailable` filters INDIVIDUAL assets that are in any kit out
     * of the picker (those are managed via the kit, not picked directly).
     * QUANTITY_TRACKED assets bypass this filter: a partial-kit allocation
     * is a slice, not whole-asset exclusion — the free pool stays bookable
     * as a standalone slice. Picker's availability math subtracts the
     * kit-committed sum downstream so the displayed "Available" count is
     * already correct.
     */
    if (hideUnavailable === true) {
      where.AND = [
        ...(Array.isArray(where.AND)
          ? where.AND
          : where.AND
          ? [where.AND]
          : []),
        {
          OR: [{ type: "QUANTITY_TRACKED" }, { assetKits: { none: {} } }],
        },
      ];
    }

    if (teamMemberIds && teamMemberIds.length) {
      where.OR = [
        ...(where.OR ?? []),
        {
          custody: { some: { teamMemberId: { in: teamMemberIds } } },
        },
        {
          custody: {
            some: { custodian: { userId: { in: teamMemberIds } } },
          },
        },
        {
          bookingAssets: {
            some: {
              booking: {
                custodianTeamMemberId: { in: teamMemberIds },
                /** We only get them if the booking is ongoing */
                status: {
                  in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
                },
              },
            },
          },
        },
        {
          bookingAssets: {
            some: {
              booking: {
                custodianUserId: { in: teamMemberIds },
                /** We only get them if the booking is ongoing */
                status: {
                  in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
                },
              },
            },
          },
        },
        ...(teamMemberIds.includes("without-custody")
          ? [{ custody: { none: {} } }]
          : []),
      ];
    }

    if (assetKitFilter === "NOT_IN_KIT") {
      where.assetKits = { none: {} };
    } else if (assetKitFilter === "IN_OTHER_KITS") {
      where.assetKits = { some: {} };
    }

    /**
     * Runs the paginated asset query and its total count for a given `where`
     * clause. Extracted so the ID-shaped-search fallback can re-run the same
     * query shape with a different `where.OR` without duplicating the include
     * and ordering config.
     *
     * @param assetWhere - The Prisma where clause to fetch and count against
     * @returns A tuple of `[assets, totalAssets]`
     */
    const fetchAssetsForWhere = (assetWhere: Prisma.AssetWhereInput) =>
      Promise.all([
        db.asset.findMany({
          skip,
          take,
          where: assetWhere,
          include: {
            ...assetIndexFields({
              bookingFrom,
              bookingTo,
              unavailableBookingStatuses,
            }),
            ...extraInclude,
          },
          // Stable `id` tiebreaker for deterministic skip/take paging when
          // rows tie on the sort key (bulk-imported assets share createdAt
          // down to the millisecond). Mirrors the tiebreaker the advanced
          // index uses (parseSortingOptions in query.server.ts). Skipped when
          // the caller already sorts by id.
          orderBy: [
            { [orderBy]: orderDirection },
            ...(orderBy !== "id" ? [{ id: "asc" as const }] : []),
          ],
        }),
        db.asset.count({ where: assetWhere }),
      ]);

    let [assets, totalAssets] = await fetchAssetsForWhere(where);

    // Fallback: an ID-shaped search ran the narrow clause but matched no
    // assets. The term may be embedded in a title, description, or custom
    // field rather than being a real identifier, so re-run with the full
    // search clause before giving up. Only the narrow search entries are
    // swapped for the full clause; any filter clauses appended to `where.OR`
    // afterwards (uncategorized / untagged / without-location / team-member)
    // are kept so the fallback honours the same filters as the first query.
    if (shouldFallbackToFullSearch && totalAssets === 0 && buildFullSearchOr) {
      const appendedFilterOr = Array.isArray(where.OR)
        ? where.OR.slice(narrowSearchOrCount)
        : [];
      where.OR = [...buildFullSearchOr(), ...appendedFilterOr];
      [assets, totalAssets] = await fetchAssetsForWhere(where);
    }

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
  preParsedFilters,
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
  /** Pre-parsed filters — pass these to skip redundant parseFiltersWithHierarchy call */
  preParsedFilters?: Filter[];
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
    const parsedFilters =
      preParsedFilters ??
      (await parseFiltersWithHierarchy(
        filters,
        settingColumns,
        organizationId
      ));

    const whereClause = generateWhereClause(
      organizationId,
      search,
      parsedFilters,
      assetIds,
      availableToBookOnly
    );
    const sortByValues = searchParams.getAll("sortBy");
    const { orderByInner, customFieldSortings } =
      parseSortingOptions(sortByValues);
    // Modify query to conditionally include LIMIT/OFFSET
    const paginationClause = takeAll
      ? Prisma.empty
      : Prisma.sql`LIMIT ${take} OFFSET ${skip}`;

    // Paginate-first assembly: a slim id+sort-keys CTE is paged via an integer
    // ROW_NUMBER rank, counted cheaply, then the full heavy projection runs
    // once per page row via LEFT JOIN LATERAL. See buildAdvancedAssetsQuery.
    const query = buildAdvancedAssetsQuery({
      whereClause,
      orderByInner,
      customFieldSortings,
      sortBy: sortByValues,
      parsedFilters,
      withBookings: getBookings || isUpcomingBookingsColumnVisible,
      withBarcodes: canUseBarcodes,
      paginationClause,
      // Search reads c.name / l.name, so the slim phase must join Category +
      // Location even without a category/location sort.
      hasSearch: Boolean(search),
    });

    const result = await db.$queryRaw<AdvancedIndexQueryResult>(query);
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
  type,
  quantity,
  minQuantity,
  consumptionType,
  unitOfMeasure,
  assetModelId,
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
  type?: Asset["type"];
  quantity?: Asset["quantity"];
  minQuantity?: Asset["minQuantity"];
  consumptionType?: Asset["consumptionType"];
  unitOfMeasure?: Asset["unitOfMeasure"];
  assetModelId?: string;
}) {
  // Server-side validation for quantity-tracked assets
  if (isQuantityTracked(type)) {
    if (!quantity || quantity <= 0) {
      throw new ShelfError({
        cause: null,
        message: "Quantity is required for quantity-tracked assets",
        label,
        status: 400,
      });
    }
    if (!consumptionType) {
      throw new ShelfError({
        cause: null,
        message: "Consumption type is required for quantity-tracked assets",
        label,
        status: 400,
      });
    }
    // AssetModel is an INDIVIDUAL-only concept: a model groups N
    // distinguishable units of the same template (e.g. 100 MacBook Pro
    // 2025 laptops). A QUANTITY_TRACKED asset is itself one record
    // representing a stock pool, so a model link makes no semantic
    // sense — reject up-front rather than silently dropping it.
    if (assetModelId) {
      throw new ShelfError({
        cause: null,
        title: "Asset model not allowed",
        message:
          "Asset models can only be linked to individually tracked assets. Remove the model or change the tracking method to INDIVIDUAL.",
        label,
        status: 400,
        shouldBeCaptured: false,
      });
    }
  }

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    try {
      // Generate sequential ID
      const sequentialId = await getNextSequentialId(organizationId);

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
        sequentialId, // Add the generated sequential ID
        user,
        qrCodes,
        valuation,
        organization,
        availableToBook,
        mainImage,
        mainImageExpiration,
        type,
        quantity,
        minQuantity,
        consumptionType,
        unitOfMeasure,
      };

      /** If a kitId is passed, link the kit to the asset. */
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

      /** If an assetModelId is passed, link the asset model to the asset.
       * Org-scope-guard before the connect — Prisma's FK only enforces
       * that the row exists, not that it belongs to the caller's
       * organization, so without this check a user in Org A could
       * link their new asset to Org B's model (hex-security r3341845640
       * / r3350881506). Same pattern as the other org-scope guards
       * in this file (assertLocationBelongsToOrg, assertTagsBelongToOrg).
       */
      if (assetModelId) {
        await assertAssetModelBelongsToOrg({ assetModelId, organizationId });
        Object.assign(data, {
          assetModel: {
            connect: {
              id: assetModelId,
            },
          },
        });
      }

      // Placement can't be set inline in the asset create (the AssetLocation
      // pivot needs the assetId), so it's created in the tx below right
      // after the asset row.

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

      /** Custom-field ids referenced by this create. Sourced from form input
       * and validated for org ownership inside the create transaction below
       * (cross-org IDOR guard). */
      let customFieldIdsToValidate: string[] = [];

      /** If custom fields are passed, create them */
      if (customFieldsValues && customFieldsValues.length > 0) {
        const customFieldValuesToAdd = customFieldsValues.filter(
          (cf) => !!cf.value
        );

        // SECURITY (cross-org IDOR): these ids get connected to a CustomField
        // by the nested `create` below, which has no org scoping of its own.
        // Collected here and validated inside the transaction (see the
        // assertCustomFieldsBelongToOrg call there).
        customFieldIdsToValidate = customFieldValuesToAdd
          .map(({ id }) => id)
          .filter(Boolean);

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

      /** If barcodes are passed, handle reusing orphaned barcodes or creating new ones */
      if (barcodes && barcodes.length > 0) {
        const barcodesToAdd = barcodes.filter(
          (barcode) => !!barcode.value && !!barcode.type
        );

        if (barcodesToAdd.length > 0) {
          const barcodesToConnect = barcodesToAdd
            .filter((b) => b.existingId)
            .map((b) => ({ id: b.existingId! }));

          const barcodesToCreate = barcodesToAdd
            .filter((b) => !b.existingId)
            .map(({ type, value }) => ({
              type,
              value: normalizeBarcodeValue(type, value),
              organizationId,
            }));

          // Build barcodes relation data
          const barcodeRelationData: any = {};

          if (barcodesToConnect.length > 0) {
            barcodeRelationData.connect = barcodesToConnect;
          }

          if (barcodesToCreate.length > 0) {
            barcodeRelationData.create = barcodesToCreate;
          }

          if (Object.keys(barcodeRelationData).length > 0) {
            Object.assign(data, { barcodes: barcodeRelationData });
          }
        }
      }

      // Use transaction to ensure asset creation and activity event are atomic
      const asset = await db.$transaction(async (tx) => {
        // SECURITY (cross-org IDOR): prove every form-supplied custom-field id
        // belongs to this org before the nested create connects them. Run inside
        // the tx so the ownership check shares the write's transaction (no-op
        // when there are no custom-field ids).
        await assertCustomFieldsBelongToOrg(
          { customFieldIds: customFieldIdsToValidate, organizationId },
          tx
        );

        const created = await tx.asset.create({
          data,
          include: {
            assetLocations: { include: { location: true } },
            user: true,
            custody: true,
          },
        });

        // Create the AssetLocation pivot row now that we have the assetId.
        // Quantity is type-aware to match the sum-within-total trigger
        // semantics: qty-tracked = full pool, INDIVIDUAL = 1.
        if (locationId) {
          await tx.assetLocation.create({
            data: {
              assetId: created.id,
              locationId,
              organizationId,
              quantity:
                type === AssetType.QUANTITY_TRACKED && quantity ? quantity : 1,
            },
          });
        }

        // Activity event must be inside transaction for atomicity
        await recordEvent(
          {
            organizationId,
            actorUserId: userId,
            action: "ASSET_CREATED",
            entityType: "ASSET",
            entityId: created.id,
            assetId: created.id,
          },
          tx
        );

        // Re-read so the returned shape has the pivot we just created
        // (the initial create's include came back empty for it).
        return locationId
          ? tx.asset.findUniqueOrThrow({
              // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `created.id` is from the `tx.asset.create` above (org-scoped via the create payload's organizationId); re-read of our own just-created row
              where: { id: created.id },
              include: {
                assetLocations: { include: { location: true } },
                user: true,
                custody: true,
              },
            })
          : created;
      });

      // Successfully created asset, exit the retry loop
      return asset;
    } catch (cause) {
      // Check for sequential ID unique constraint violation and retry
      if (cause instanceof Error && "code" in cause && cause.code === "P2002") {
        const prismaError = cause as any;
        const target = prismaError.meta?.target;

        // Handle sequential ID conflicts with retry
        if (
          target &&
          target.includes("sequentialId") &&
          attempts < maxAttempts - 1
        ) {
          attempts++;
          continue; // Retry with next sequential ID
        }

        // If it's a Prisma unique constraint violation on barcode values,
        // use our detailed validation to provide specific field errors
        if (
          target &&
          target.includes("value") &&
          barcodes &&
          barcodes.length > 0
        ) {
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

/**
 * Hard cap on `bulkCreateAssetsFromModel` batch size. Tuned to keep a single
 * synchronous request comfortable (each underlying `createAsset` opens its
 * own tx); for higher counts users should reach for CSV import.
 */
export const BULK_CREATE_MAX = 100;

const BULK_NAME_TEMPLATE_TOKEN = /\{i\}/g;

/**
 * Renders the title for the Nth bulk-created asset from a template string.
 *
 * - If the template contains the literal `{i}` token, every occurrence is
 *   replaced with `indexValue`. Multiple tokens are supported (e.g.
 *   `"Batt-{i}-{i}"` with `5` → `"Batt-5-5"`).
 * - If the template contains no `{i}` token, `indexValue` is appended with
 *   a single space separator (mirrors the spreadsheet-fill convention).
 *
 * Final string is trimmed.
 *
 * @param template - User-supplied template (already sanitised against
 *   Markdoc injection by the caller)
 * @param indexValue - The number to substitute / append (typically
 *   `startNumber + i` from the bulk-create loop)
 */
export function renderBulkAssetTitle(
  template: string,
  indexValue: number
): string {
  if (template.includes("{i}")) {
    return template
      .replace(BULK_NAME_TEMPLATE_TOKEN, String(indexValue))
      .trim();
  }
  return `${template.trim()} ${indexValue}`.trim();
}

/**
 * Bulk-creates N `INDIVIDUAL` assets from an `AssetModel` template.
 *
 * The use case is "I want 20 separate distinguishable Dell Latitudes" —
 * each asset gets its own row, QR code, sequential ID, and (if SAM
 * barcodes are enabled at the workspace level) auto-allocated barcode.
 * All N assets share the same model-derived defaults (category +
 * valuation) and any caller-supplied overrides (location, kit, tags,
 * custom fields, description, valuation override, image) — values are
 * applied uniformly across the batch.
 *
 * **`QUANTITY_TRACKED` is intentionally NOT supported via this primitive.**
 * A stock pool is one asset with `Asset.quantity = N`, not N assets. Users
 * onboarding stock should reach for single-create + restock instead.
 *
 * **Transaction semantics — pragmatic, not all-or-nothing.** Each underlying
 * `createAsset` opens its own `db.$transaction` with a sequential-ID retry
 * loop; nesting these under one outer transaction would break the retry
 * semantics. So on a mid-loop failure at index K, indices `[0..K-1]` stay
 * committed and the caller receives `failedAt: K + error`. Aggressive
 * up-front validation makes mid-loop failures rare in practice (most
 * recoverable conditions trip the synchronous validators first).
 *
 * @param params.assetModelId - The AssetModel to inherit defaults from
 * @param params.count - Batch size; must be between 2 and `BULK_CREATE_MAX`
 * @param params.nameTemplate - Title template; supports `{i}` token, falls
 *   back to `"{template} {i}"` if absent. Sanitised against Markdoc
 *   injection.
 * @param params.startNumber - First value substituted for `{i}` (default 1)
 * @param params.organizationId - Caller's validated org id
 * @param params.userId - Authoring user id
 * @param params.categoryId - Optional override; defaults to model's
 *   `defaultCategoryId`
 * @param params.valuation - Optional override; defaults to model's
 *   `defaultValuation`
 * @param params.locationId - Optional shared primary location
 * @param params.kitId - Optional shared kit membership
 * @param params.tags - Optional shared tag set
 * @param params.customFieldsValues - Optional shared custom-field values
 * @param params.description - Optional shared description
 * @param params.mainImage / mainImageExpiration - Optional shared cover image
 * @param params.availableToBook - Optional override (default true)
 * @returns On full success: `{ createdAssetIds }`. On partial failure at
 *   index K: `{ createdAssetIds: [the K already-committed], failedAt: K,
 *   error }` — recovery is re-running for the remainder.
 * @throws {ShelfError} 400 for pre-validation failures (count out of range,
 *   empty / malformed template, duplicate titles within batch, foreign org
 *   IDs). These happen BEFORE any writes.
 */
export async function bulkCreateAssetsFromModel({
  assetModelId,
  count,
  nameTemplate,
  startNumber = 1,
  organizationId,
  userId,
  categoryId,
  valuation,
  description,
  locationId,
  kitId,
  tags,
  customFieldsValues,
  mainImage,
  mainImageExpiration,
  availableToBook,
}: {
  assetModelId: string;
  count: number;
  nameTemplate: string;
  startNumber?: number;
  organizationId: Organization["id"];
  userId: User["id"];
  categoryId?: Category["id"];
  valuation?: number | null;
  description?: string | null;
  locationId?: Location["id"];
  kitId?: Kit["id"];
  tags?: { set: { id: string }[] };
  customFieldsValues?: ShelfAssetCustomFieldValueType[];
  mainImage?: Asset["mainImage"];
  mainImageExpiration?: Asset["mainImageExpiration"];
  availableToBook?: boolean;
}): Promise<{
  createdAssetIds: Asset["id"][];
  failedAt?: number;
  error?: ShelfError;
}> {
  // ── Synchronous pre-validation ────────────────────────────────────────
  // Everything that can be rejected without a DB write gets rejected
  // here. After this block, mid-loop failures are rare (mostly transient
  // DB issues).

  if (!Number.isInteger(count) || count < 2 || count > BULK_CREATE_MAX) {
    throw new ShelfError({
      cause: null,
      title: "Invalid count",
      message: `Asset count must be a whole number between 2 and ${BULK_CREATE_MAX}.`,
      label,
      status: 400,
      shouldBeCaptured: false,
      additionalData: { count, max: BULK_CREATE_MAX },
    });
  }

  if (!Number.isInteger(startNumber) || startNumber < 0) {
    throw new ShelfError({
      cause: null,
      title: "Invalid start number",
      message: "Start number must be a non-negative whole number.",
      label,
      status: 400,
      shouldBeCaptured: false,
      additionalData: { startNumber },
    });
  }

  // Strip Markdoc tokens (`{`, `%`, `}`) without destroying whitespace
  // adjacent to the `{i}` substitution token. The earlier chunked
  // implementation used `sanitizeUnitOfMeasureLabel` per-chunk, which
  // also `.trim()`-ed each chunk — so `"Asset {i}"` collapsed to
  // `"Asset{i}"` (trailing space on the left chunk dropped). Fix:
  // protect `{i}` with a private-use placeholder, strip Markdoc chars
  // globally, then restore.
  const rawTemplate = (nameTemplate ?? "").toString();
  const I_TOKEN_PLACEHOLDER = "I_TOKEN";
  const protectedTemplate = rawTemplate.replace(/\{i\}/g, I_TOKEN_PLACEHOLDER);
  const strippedTemplate = protectedTemplate.replace(/[{%}]/g, "");
  const sanitisedTemplate = strippedTemplate.replace(
    new RegExp(I_TOKEN_PLACEHOLDER, "g"),
    "{i}"
  );
  const trimmedTemplate = sanitisedTemplate.trim();
  if (!trimmedTemplate || trimmedTemplate === "{i}") {
    // Pure `{i}` alone with no surrounding text would produce raw integers
    // ("1", "2", ...) as titles — almost certainly a user mistake.
    throw new ShelfError({
      cause: null,
      title: "Invalid name template",
      message:
        'Name template must include some text alongside the {i} number token (e.g. "Battery {i}").',
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }

  const titles = Array.from({ length: count }, (_, i) =>
    renderBulkAssetTitle(trimmedTemplate, startNumber + i)
  );
  if (titles.some((t) => t.length === 0)) {
    throw new ShelfError({
      cause: null,
      title: "Invalid name template",
      message:
        "The name template produced an empty title for one or more assets.",
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }
  if (new Set(titles).size !== titles.length) {
    // Duplicates only happen when the template has no `{i}` token AND the
    // user supplied a fixed suffix, OR (theoretical) when startNumber
    // arithmetic collides. Either way the result would be confusing.
    throw new ShelfError({
      cause: null,
      title: "Duplicate titles",
      message:
        "The name template produced duplicate titles within the batch. Include {i} so each asset gets a distinct name.",
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }

  // ── Org-scope all entity references ──────────────────────────────────

  await assertAssetModelBelongsToOrg({ assetModelId, organizationId });

  if (locationId) {
    await assertLocationBelongsToOrg({ locationId, organizationId });
  }

  if (tags?.set && tags.set.length > 0) {
    await assertTagsBelongToOrg({
      tagIds: tags.set.map((t) => t.id),
      organizationId,
    });
  }
  // kitId + customFieldsValues + categoryId — createAsset's connect will
  // throw a 400 on cross-org id (Prisma surfaces a foreign-key violation).
  // Could harden with explicit asserts in a future polish.

  // ── Read model + resolve defaults ────────────────────────────────────

  const model = await getAssetModel({ id: assetModelId, organizationId });
  const resolvedCategoryId: string | null =
    categoryId ?? model.defaultCategoryId ?? null;
  const resolvedValuation: number | null =
    valuation ?? model.defaultValuation ?? null;

  // ── Sequential create loop ──────────────────────────────────────────
  // Each `createAsset` runs its own transaction with sequential-ID retry.
  // Nesting under an outer tx would break that retry; instead we accept
  // partial-success semantics and surface `failedAt` on mid-loop failure.

  const createdAssetIds: Asset["id"][] = [];
  for (let i = 0; i < titles.length; i++) {
    const title = titles[i];
    try {
      const created = await createAsset({
        title,
        description: description ?? null,
        userId,
        organizationId,
        assetModelId,
        categoryId: resolvedCategoryId,
        valuation: resolvedValuation,
        kitId,
        locationId,
        tags,
        customFieldsValues,
        mainImage,
        mainImageExpiration,
        availableToBook: availableToBook ?? true,
        type: AssetType.INDIVIDUAL,
      });
      createdAssetIds.push(created.id);
    } catch (cause) {
      const error = isLikeShelfError(cause)
        ? (cause as ShelfError)
        : new ShelfError({
            cause,
            title: "Bulk create failed",
            message:
              "Something went wrong while creating one of the assets in the batch. Earlier assets in the batch were saved successfully.",
            label,
            additionalData: {
              assetModelId,
              organizationId,
              failedAtIndex: i,
            },
          });
      return { createdAssetIds, failedAt: i, error };
    }
  }

  return { createdAssetIds };
}

/**
 * Resolves the `AssetLocation.quantity` to write when the asset-overview
 * "Update location" dialog rewrites the asset's single primary placement.
 *
 * QUANTITY_TRACKED honours the submitted dialog value (already validated
 * against `Asset.quantity` upstream). When the dialog omitted the input
 * (legacy callers — bulk update, scan drawer, mobile API), falls back to
 * the asset's full pool. INDIVIDUAL ignores the input entirely — that
 * type's pivot row is always 1 unit per the BEFORE trigger.
 */
function resolveNewLocationQuantity(
  asset: { type: AssetType; quantity: number | null },
  submitted?: number
): number {
  if (asset.type !== AssetType.QUANTITY_TRACKED) return 1;
  if (typeof submitted === "number") return submitted;
  return asset.quantity ?? 1;
}

export async function updateAsset({
  title,
  description,
  mainImage,
  mainImageExpiration,
  thumbnailImage,
  categoryId,
  assetModelId,
  tags,
  id,
  newLocationId,
  currentLocationId,
  newLocationQuantity,
  userId,
  valuation,
  customFieldsValues: customFieldsValuesFromForm,
  barcodes,
  preferredBarcodeId,
  organizationId,
  request,
  quantity,
  minQuantity,
  consumptionType,
  unitOfMeasure,
}: UpdateAssetPayload) {
  try {
    const isChangingLocation = newLocationId !== currentLocationId;
    /**
     * The asset-overview "Update location" dialog surfaces a per-asset
     * qty input for QUANTITY_TRACKED rows. Setting a new qty (with or
     * without changing the target location) is also a placement edit
     * — both branches share the kit-guard and the pivot rewrite.
     * INDIVIDUAL submissions ignore the qty entirely (forced to 1 at
     * write time).
     */
    const isSettingNewQuantity = newLocationQuantity != null;
    const shouldUpdatePlacement = isChangingLocation || isSettingNewQuantity;

    // Check if asset belongs to a kit and prevent location updates.
    // the parent kit (today: ≤1 pivot row per asset) through
    // `assetKits.kit` and read it as `assetWithKit?.assetKits[0]?.kit`.
    // Also pull `type` + `quantity` so the qty validator below has the
    // asset's total without a second round-trip.
    let assetForValidation: {
      type: AssetType;
      quantity: number | null;
    } | null = null;
    if (shouldUpdatePlacement) {
      const assetWithKit = await db.asset.findUnique({
        where: { id, organizationId },
        select: {
          type: true,
          quantity: true,
          assetKits: {
            select: { kit: { select: { id: true, name: true } } },
          },
        },
      });

      // Defensive `?.` on `assetKits` itself tolerates fixtures /
      // payloads that omit the pivot relation entirely.
      const parentKit = assetWithKit?.assetKits?.[0]?.kit;
      if (parentKit) {
        throw new ShelfError({
          cause: null,
          message: `This asset's location is managed by its parent kit "${parentKit.name}". Please update the kit's location instead.`,
          additionalData: {
            assetId: id,
            kitId: parentKit.id,
            kitName: parentKit.name,
          },
          label: "Assets",
          status: 400,
          shouldBeCaptured: false,
        });
      }
      assetForValidation = assetWithKit
        ? { type: assetWithKit.type, quantity: assetWithKit.quantity }
        : null;
    }

    /**
     * Validate the submitted qty against the asset's pool. The dialog
     * collapses any existing multi-placement back to one row at this
     * location, so the bound is simply `Asset.quantity`. No "other
     * locations" subtraction (those rows get cleared in the transaction
     * below). INDIVIDUAL submissions ignore the qty — write path forces
     * it to 1.
     */
    if (
      isSettingNewQuantity &&
      newLocationId &&
      assetForValidation?.type === AssetType.QUANTITY_TRACKED
    ) {
      const totalQty = assetForValidation.quantity ?? 0;
      if (
        typeof newLocationQuantity === "number" &&
        newLocationQuantity > totalQty
      ) {
        throw new ShelfError({
          cause: null,
          title: "Quantity exceeds available pool",
          message: `Requested ${newLocationQuantity} but the asset has only ${totalQty} units total.`,
          additionalData: {
            assetId: id,
            newLocationQuantity,
            totalQty,
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
        typeof valuation !== "undefined" ||
        typeof quantity !== "undefined" ||
        typeof minQuantity !== "undefined" ||
        typeof consumptionType !== "undefined" ||
        typeof unitOfMeasure !== "undefined" ||
        typeof preferredBarcodeId !== "undefined"
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

    const data: Prisma.AssetUpdateInput = {
      title,
      description,
      valuation,
      mainImage,
      mainImageExpiration,
      thumbnailImage,
      // Quantity-tracked fields (type is immutable, never updated here)
      // TODO(Phase 2): Route quantity changes through an audited adjustment
      // path that writes to ConsumptionLog. Direct mutation here bypasses
      // the full-attribution audit trail required by the PRD.
      quantity,
      minQuantity,
      consumptionType,
      unitOfMeasure,
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
      // why: connect: { id } is unscoped — verify the category belongs to this
      // org before connecting, otherwise an attacker who knows a foreign-org
      // category id could attach it to their asset (cross-org IDOR).
      await getCategory({ id: categoryId, organizationId });
      Object.assign(data, {
        category: {
          connect: {
            id: categoryId,
          },
        },
      });
    }

    /** If assetModelId is null, disconnect the asset model */
    if (assetModelId === null) {
      Object.assign(data, {
        assetModel: {
          disconnect: true,
        },
      });
    } else if (assetModelId) {
      // Org-scope guard before the connect — Prisma's FK only enforces
      // that the AssetModel row exists, not that it belongs to the
      // caller's org, so without this check a user in Org A could
      // link their asset to Org B's model (hex-security r3341845640
      // / r3350881506). Runs before the type-check below so a
      // cross-org id is rejected with the "not in your workspace"
      // 404 instead of leaking a "not allowed for qty-tracked" 400.
      await assertAssetModelBelongsToOrg({ assetModelId, organizationId });

      // AssetModel is INDIVIDUAL-only (see the matching guard in
      // createAsset). Block the connect for a QUANTITY_TRACKED asset
      // with a labelled 400 rather than letting it silently link.
      // Reads `type` directly off the asset row — sub-millisecond
      // org-scoped index lookup, only on the link branch.
      const currentAsset = await db.asset.findUnique({
        where: { id, organizationId },
        select: { type: true },
      });
      if (currentAsset && currentAsset.type === AssetType.QUANTITY_TRACKED) {
        throw new ShelfError({
          cause: null,
          title: "Asset model not allowed",
          message:
            "Asset models can only be linked to individually tracked assets. This asset is tracked by quantity.",
          label,
          status: 400,
          shouldBeCaptured: false,
          additionalData: { assetId: id, assetModelId },
        });
      }
      /** If assetModelId is a valid ID, connect the asset model */
      Object.assign(data, {
        assetModel: {
          connect: {
            id: assetModelId,
          },
        },
      });
    }

    /** Connect the new location id */
    if (newLocationId) {
      // why: same IDOR concern as category — verify the location is in this
      // org before connecting. Lightweight findFirst, getLocation() loads
      // paginated assets and is too heavy here.
      const orgLocation = await db.location.findFirst({
        where: { id: newLocationId, organizationId },
        select: { id: true },
      });
      if (!orgLocation) {
        throw new ShelfError({
          cause: null,
          title: "Location not found",
          message:
            "The selected location does not exist or you don't have access to it.",
          additionalData: { newLocationId, organizationId },
          label,
          status: 404,
          shouldBeCaptured: false,
        });
      }
      // We can't inline a `connect` on `data` for location anymore — the
      // AssetLocation pivot write happens in the $transaction below
      // alongside the asset update.
    }

    /** disconnecting location relation if a user clears locations */
    // (no-op here too; the pivot deleteMany happens in the tx below.)

    /** If a tags is passed, link the category to the asset. */
    if (isTagUpdate) {
      Object.assign(data, {
        tags,
      });
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
      currentCustomFieldsValuesWithFields =
        await db.assetCustomFieldValue.findMany({
          where: {
            assetId: id,
          },
          select: {
            id: true,
            customFieldId: true,
            value: true,
            customField: {
              select: {
                id: true,
                name: true,
                type: true,
              },
            },
          },
        });

      const customFieldValuesToAdd = customFieldsValuesFromForm.filter(
        (cf) => !!cf.value
      );

      const customFieldValuesToRemove = customFieldsValuesFromForm.filter(
        (cf) => !cf.value
      );

      // SECURITY (cross-org IDOR): the create/updateMany writes below connect
      // values to a CustomField by an id sourced from form input. Prove every
      // referenced custom field belongs to this org before writing. (Removals
      // go through `deleteMany` scoped to this asset's own value rows, so only
      // the added/updated ids need the check.)
      await assertCustomFieldsBelongToOrg({
        customFieldIds: customFieldValuesToAdd
          .map(({ id }) => id)
          .filter(Boolean),
        organizationId,
      });

      /**
       * Split the writes into create vs update ourselves instead of using a
       * nested `upsert`. Prisma emulates each nested upsert with a
       * SELECT-then-write round-trip per field, which is the N+1 reported in
       * Sentry SHELF-WEBAPP-1KY / SHELF-WEBAPP-1MF. We already loaded the
       * existing values above (`currentCustomFieldsValuesWithFields`), so we
       * know which fields exist without asking the database again. Each
       * custom field has at most one value row per asset, so keying by
       * `customFieldId` is unambiguous.
       */
      const existingValueIdByFieldId = new Map(
        currentCustomFieldsValuesWithFields.map((ccfv) => [
          ccfv.customFieldId,
          ccfv.id,
        ])
      );

      const customFieldsToCreate = customFieldValuesToAdd
        .filter(({ id }) => !existingValueIdByFieldId.has(id))
        .map(({ id, value }) => ({ value, customFieldId: id }));

      /**
       * Existing values are written with `updateMany` (one entry per row),
       * NOT a nested `update`. `update` would throw P2025 and abort the whole
       * asset save if a concurrent edit deleted the value row in the window
       * between the `findMany` above and this write; `updateMany` matches zero
       * rows instead of throwing. The concurrent delete then wins (the row
       * stays gone) rather than 500-ing the user — an acceptable
       * last-write-wins outcome for this rare interleaving, and it keeps the
       * per-field existence SELECT eliminated.
       */
      const customFieldsToUpdate = customFieldValuesToAdd
        .filter(({ id }) => existingValueIdByFieldId.has(id))
        .map(({ id, value }) => ({
          where: { id: existingValueIdByFieldId.get(id) as string },
          data: { value },
        }));

      Object.assign(data, {
        customFields: {
          ...(customFieldsToCreate.length > 0
            ? { create: customFieldsToCreate }
            : {}),
          ...(customFieldsToUpdate.length > 0
            ? { updateMany: customFieldsToUpdate }
            : {}),
          ...(customFieldValuesToRemove.length > 0
            ? {
                // Collapse N per-field deleteMany filters into ONE `IN`
                // clause so Prisma issues a single SELECT pre-flight +
                // single DELETE, not 2N round trips (Sentry N+1
                // SHELF-WEBAPP-1NZ, 1P0). Prisma's nested `deleteMany`
                // accepts EITHER a single where OR an array of wheres —
                // the array form fans out into per-entry queries.
                deleteMany: {
                  customFieldId: {
                    in: customFieldValuesToRemove.map((cf) => cf.id),
                  },
                },
              }
            : {}),
        },
      });
    }

    // Normalize the form-submitted preferredBarcodeId early so the same
    // value is used by the pre-flight validation below and the actual write
    // further down. Both undefined (field absent from patch) and empty
    // string (form sends "" for "workspace default") collapse to null —
    // any non-null branch is then guarded by `preferredBarcodeId !== undefined`
    // so we never mistake "field omitted from patch" for "user picked
    // workspace default" when writing.
    const targetPreferred: string | null =
      preferredBarcodeId === null ||
      preferredBarcodeId === undefined ||
      preferredBarcodeId.length === 0
        ? null
        : preferredBarcodeId;

    /**
     * P1 atomicity guard (pre-flight):
     *
     * The preferred-barcode override must reference a barcode that will
     * still exist on this asset AFTER `updateBarcodes` runs. Without this
     * pre-flight, a save that simultaneously (a) removes the currently-
     * preferred barcode from the `barcodes` array AND (b) keeps the now-
     * stale `preferredBarcodeId` would delete the barcode first, then
     * fail validation, returning a 400 to the user while leaving the
     * barcodes table mutated. We surface the error before any write so
     * the rejected save is genuinely atomic.
     *
     * Membership-check semantics:
     * - If `barcodes` is being submitted, compute the post-update id-set
     *   from the submission (only entries that already have an `id` —
     *   freshly-created ones have no id yet and can't be referenced).
     * - If `barcodes` is NOT being submitted, the current DB set is the
     *   post-update set, so query the live barcodes table scoped to
     *   `{ assetId, organizationId }` (also closes cross-org IDOR).
     */
    if (preferredBarcodeId !== undefined && targetPreferred !== null) {
      // Addon entitlement gate. Non-addon (and addon-revoked) orgs must not
      // be able to persist a non-null `preferredBarcodeId` via a tampered
      // form post — the UI gates the override section by `canUseBarcodes`,
      // but the server-side action must enforce the same invariant. The
      // resolver already silently falls back to QR for addon-revoked orgs
      // (the override branch is gated by `barcodesEnabled` in display.ts),
      // so this check is belt-and-suspenders: it prevents the stale value
      // from being written in the first place rather than leaving silent
      // drift in the DB. `null` overrides are always allowed — that's the
      // "clear my override" intent and shouldn't require the addon.
      const orgEntitlement = await db.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { barcodesEnabled: true },
      });
      if (!orgEntitlement.barcodesEnabled) {
        throw new ShelfError({
          cause: null,
          message:
            "Per-asset preferred-barcode overrides require the alternative-barcodes add-on. " +
            "Enable the add-on or clear the override (leave it on workspace default).",
          additionalData: {
            assetId: id,
            organizationId,
            preferredBarcodeId: targetPreferred,
          },
          label,
          status: 403,
          shouldBeCaptured: false,
        });
      }

      // Org-scoped ownership check — ALWAYS run, even when `barcodes` is
      // being submitted. The submitted-array check below proves the id will
      // survive `updateBarcodes`'s mutation, but it does NOT prove the id
      // actually belongs to this asset/org: a forged form could include
      // `barcodes: [{ id: "victim-barcode-id", ... }]` to slip past the
      // earlier check. The DB lookup closes the cross-asset / cross-org
      // IDOR vector authoritatively.
      const owned = await db.barcode.findFirst({
        where: {
          id: targetPreferred,
          assetId: id,
          organizationId,
        },
        select: { id: true },
      });
      let isMember = Boolean(owned);

      // Additional gate when the patch is also rewriting the `barcodes`
      // collection: the target must still be in the post-update set
      // (i.e., not being deleted in the same save). Without this, a save
      // that simultaneously removes the preferred barcode and keeps the
      // override would partially-commit (barcodes deleted, then 400 on
      // membership) — the original P1 from Codex.
      if (isMember && barcodes !== undefined) {
        isMember = barcodes.some(
          (bc) => typeof bc.id === "string" && bc.id === targetPreferred
        );
      }

      if (!isMember) {
        throw new ShelfError({
          cause: null,
          message:
            "The selected preferred barcode is not linked to this asset.",
          additionalData: {
            assetId: id,
            preferredBarcodeId: targetPreferred,
          },
          label,
          status: 400,
          shouldBeCaptured: false,
        });
      }
    }

    // The per-row `AssetLocation.quantity` affected by this placement edit,
    // used to label the qty-tracked location note/event ("placed 50 units").
    // For a placement it's the qty written to the new pivot row; for a
    // removal it's the MANUAL row qty dropped (read pre-delete from the
    // captured `assetLocations`). Captured inside the tx so the removal qty
    // survives the deleteMany below. `null` for INDIVIDUAL via the helpers.
    let locationChangeQuantity: number | null = null;

    // Bundle the asset update and AssetLocation pivot ops in a single tx
    // so a location change is atomic (and so the sum-within-total trigger
    // sees the final state at COMMIT).
    const asset = await db.$transaction(async (tx) => {
      const updated = await tx.asset.update({
        where: { id, organizationId },
        data,
        include: {
          assetLocations: { include: { location: true } },
          tags: true,
          category: true,
          organization: true,
        },
      });

      if (shouldUpdatePlacement) {
        if (newLocationId) {
          locationChangeQuantity = resolveNewLocationQuantity(
            updated,
            newLocationQuantity
          );
        } else {
          // Removal: name the manual row being dropped at the prior
          // location. `updated.assetLocations` is the pre-delete snapshot.
          locationChangeQuantity =
            updated.assetLocations.find(
              (al) =>
                al.locationId === currentLocationId && al.assetKitId == null
            )?.quantity ?? null;
        }

        // Clear existing MANUAL primary placement(s) first. Kit-driven
        // rows (`assetKitId IS NOT NULL`) are owned by the kit's flow
        // and stay untouched — the user editing the asset-overview
        // single-location dialog can replace their manual placement
        // without nuking the kit-driven row. INDIVIDUAL is capped at
        // 1 manual row by trigger; QUANTITY_TRACKED multi-placement
        // edits go through the manage-placements dialog or the
        // location picker.
        await tx.assetLocation.deleteMany({
          where: { assetId: id, assetKitId: null },
        });
        if (newLocationId) {
          await tx.assetLocation.create({
            data: {
              assetId: id,
              locationId: newLocationId,
              organizationId,
              quantity: resolveNewLocationQuantity(
                updated,
                newLocationQuantity
              ),
            },
          });
        }
      }

      // Re-read so the returned `assetLocations` reflects the pivot ops.
      return shouldUpdatePlacement
        ? tx.asset.findUniqueOrThrow({
            where: { id, organizationId },
            include: {
              assetLocations: { include: { location: true } },
              tags: true,
              category: true,
              organization: true,
            },
          })
        : updated;
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

    /**
     * Per-asset preferred-barcode override.
     * Membership of `targetPreferred` was already proven by the pre-flight
     * guard above (either against the submitted `barcodes` array or against
     * the current DB set), so this block is now purely the write + audit.
     */
    if (preferredBarcodeId !== undefined) {
      const previousPreferred = assetBeforeUpdate?.preferredBarcodeId ?? null;

      // Did THIS request's `updateBarcodes` call delete the previously-
      // preferred barcode? True only when (a) a previously-preferred
      // barcode existed AND (b) the patch submitted a `barcodes` array
      // that no longer contains it (so updateBarcodes deleted it and the
      // FK `onDelete: SetNull` cascade nulled `preferredBarcodeId`).
      // This is the "explicit clear-by-this-request" signal we need to
      // distinguish "we caused the cascade" from "someone else moved
      // preferredBarcodeId concurrently".
      const weDeletedPreferredViaCascade =
        previousPreferred !== null &&
        barcodes !== undefined &&
        !barcodes.some(
          (bc) => typeof bc.id === "string" && bc.id === previousPreferred
        );

      // Wrap the read + update + audit in one transaction so the *write*
      // decision is based on the committed current state (defeats
      // concurrent-external-write TOCTOU). The *audit* fires only when
      // THIS request actually caused the change — either via the explicit
      // write below, or via the cascade-delete branch above. We must NOT
      // audit when the value simply differs between the pre-request
      // snapshot and the in-tx read because of a concurrent external
      // write — that would misattribute someone else's change to this actor.
      const wroteOrAudited = await db.$transaction(async (tx) => {
        const current = await tx.asset.findUniqueOrThrow({
          where: { id, organizationId },
          select: { preferredBarcodeId: true },
        });
        const currentPreferred = current.preferredBarcodeId ?? null;

        const needsWrite = currentPreferred !== targetPreferred;
        if (needsWrite) {
          await tx.asset.update({
            where: { id, organizationId },
            data: { preferredBarcodeId: targetPreferred },
          });
        }

        // Audit when THIS request caused the row change. Two attribution
        // paths:
        //   1. We performed the explicit DB write (target differed from
        //      the in-tx current state).
        //   2. The cascade-delete from THIS request's `updateBarcodes`
        //      nulled the row AND the user's target is null too (the
        //      cascade fulfilled the user's "clear my override" intent
        //      silently; we still want an audit row).
        // Concurrent external writes can't satisfy either condition.
        const auditAttributableToUs =
          needsWrite ||
          (weDeletedPreferredViaCascade &&
            targetPreferred === null &&
            currentPreferred === null);

        if (auditAttributableToUs && previousPreferred !== targetPreferred) {
          // Structured event per `.claude/rules/use-record-event.md`.
          await recordEvent(
            {
              organizationId,
              actorUserId: userId,
              action: "ASSET_PREFERRED_BARCODE_CHANGED",
              entityType: "ASSET",
              entityId: id,
              assetId: id,
              field: "preferredBarcodeId",
              fromValue: previousPreferred,
              toValue: targetPreferred,
            },
            tx
          );
          return true;
        }

        return false;
      });

      if (wroteOrAudited) {
        // Sync the in-memory `asset` object so the returned shape reflects
        // the post-update state — callers that destructure
        // `preferredBarcodeId` (e.g., to drive an immediate cache
        // invalidation) would otherwise see the stale value from the
        // earlier `db.asset.update` snapshot.
        asset.preferredBarcodeId = targetPreferred;
      }
    }

    /** If the location id was passed, we create a note for the move */
    if (isChangingLocation) {
      /**
       * Create a note for the move
       * Here we actually need to query the locations so we can print their names
       * */

      const user = await loadUserForNotes();

      // why: cross-org safety for the location IDs is already enforced
      // *before* the write — `newLocationId` is hard-validated at the
      // org-scoped findFirst guard above (it throws 404 before connecting),
      // and `currentLocationId` only drives a `disconnect` (value unused by
      // Prisma) plus the org-scoped name lookups below (a foreign id resolves
      // to null, never leaks). A post-write assert here previously threw a
      // 404 *after* db.asset.update had already committed — removed.
      const currentLocation = currentLocationId
        ? await db.location.findFirst({
            where: {
              id: currentLocationId,
              organizationId,
            },
          })
        : null;

      const newLocation = newLocationId
        ? await db.location.findFirst({
            where: {
              id: newLocationId,
              organizationId,
            },
          })
        : null;

      await createLocationChangeNote({
        currentLocation,
        newLocation,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        assetId: asset.id,
        userId,
        organizationId,
        isRemoving: newLocationId === null,
        // Qty-tracked: name the units placed / moved / removed at this
        // location (sourced from the affected pivot row). INDIVIDUAL keeps
        // the original phrasing via `formatUnitCount`.
        type: asset.type,
        unitOfMeasure: asset.unitOfMeasure,
        quantity: locationChangeQuantity,
      });

      // Activity event for the asset-level location change.
      await recordEvent({
        organizationId,
        actorUserId: userId,
        action: "ASSET_LOCATION_CHANGED",
        entityType: "ASSET",
        entityId: asset.id,
        assetId: asset.id,
        locationId: newLocation?.id ?? undefined,
        field: "locationId",
        fromValue: currentLocation?.id ?? null,
        toValue: newLocation?.id ?? null,
        // Qty-tracked: per-row AssetLocation.quantity affected. No-op for
        // INDIVIDUAL.
        meta: assetQtyMeta(asset, locationChangeQuantity),
      });

      // Create location activity notes
      const userLink = wrapUserLinkForNote({
        id: userId,
        firstName: user.firstName,
        lastName: user.lastName,
      });
      // Single-asset location-timeline note. `wrapAssetWithCountForNote`
      // prefixes the qty-tracked unit count ("50 units of {asset}");
      // INDIVIDUAL renders the bare link, so phrasing is unchanged.
      const assetForCount = {
        id: asset.id,
        title: asset.title,
        type: asset.type,
        unitOfMeasure: asset.unitOfMeasure,
      };

      if (newLocation) {
        const newLocLink = wrapLinkForNote(
          `/locations/${newLocation.id}`,
          newLocation.name
        );
        const assetMarkup = wrapAssetWithCountForNote(
          assetForCount,
          locationChangeQuantity
        );
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
        const assetMarkup = wrapAssetWithCountForNote(
          assetForCount,
          locationChangeQuantity
        );
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
          organizationId,
          userId,
          previousName: assetBeforeUpdate.title,
          newName: title,
          loadUserForNotes,
        }),
        createAssetDescriptionChangeNote({
          assetId: asset.id,
          organizationId,
          userId,
          previousDescription: assetBeforeUpdate.description,
          newDescription: description,
          loadUserForNotes,
        }),
        createAssetCategoryChangeNote({
          assetId: asset.id,
          organizationId,
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
          organizationId,
          userId,
          previousValuation: assetBeforeUpdate.valuation,
          newValuation: asset.valuation,
          currency: assetBeforeUpdate.organization.currency,
          locale: getLocale(request),
          loadUserForNotes,
        }),
        createAssetQuantityChangeNote({
          assetId: asset.id,
          organizationId,
          userId,
          previousQuantity: assetBeforeUpdate.quantity,
          newQuantity: quantity,
          previousMinQuantity: assetBeforeUpdate.minQuantity,
          newMinQuantity: minQuantity,
          previousConsumptionType: assetBeforeUpdate.consumptionType,
          newConsumptionType: consumptionType,
          previousUnitOfMeasure: assetBeforeUpdate.unitOfMeasure,
          newUnitOfMeasure: unitOfMeasure,
          loadUserForNotes,
        }),
      ]);

      // Activity events — one per logical field that actually changed.
      // See `.claude/rules/record-event-payload-shapes.md`.
      const fieldChangeEvents: Parameters<typeof recordEvents>[0] = [];
      if (
        typeof title !== "undefined" &&
        assetBeforeUpdate.title !== asset.title
      ) {
        fieldChangeEvents.push({
          organizationId,
          actorUserId: userId,
          action: "ASSET_NAME_CHANGED",
          entityType: "ASSET",
          entityId: asset.id,
          assetId: asset.id,
          field: "title",
          fromValue: assetBeforeUpdate.title ?? null,
          toValue: asset.title ?? null,
        });
      }
      if (
        typeof description !== "undefined" &&
        (assetBeforeUpdate.description ?? null) !== (asset.description ?? null)
      ) {
        fieldChangeEvents.push({
          organizationId,
          actorUserId: userId,
          action: "ASSET_DESCRIPTION_CHANGED",
          entityType: "ASSET",
          entityId: asset.id,
          assetId: asset.id,
          field: "description",
          fromValue: assetBeforeUpdate.description ?? null,
          toValue: asset.description ?? null,
        });
      }
      if (
        typeof categoryId !== "undefined" &&
        (assetBeforeUpdate.category?.id ?? null) !==
          (asset.category?.id ?? null)
      ) {
        fieldChangeEvents.push({
          organizationId,
          actorUserId: userId,
          action: "ASSET_CATEGORY_CHANGED",
          entityType: "ASSET",
          entityId: asset.id,
          assetId: asset.id,
          field: "categoryId",
          fromValue: assetBeforeUpdate.category?.id ?? null,
          toValue: asset.category?.id ?? null,
        });
      }
      if (
        typeof valuation !== "undefined" &&
        (assetBeforeUpdate.valuation ?? null) !== (asset.valuation ?? null)
      ) {
        fieldChangeEvents.push({
          organizationId,
          actorUserId: userId,
          action: "ASSET_VALUATION_CHANGED",
          entityType: "ASSET",
          entityId: asset.id,
          assetId: asset.id,
          field: "valuation",
          fromValue: assetBeforeUpdate.valuation ?? null,
          toValue: asset.valuation ?? null,
        });
      }
      if (fieldChangeEvents.length > 0) {
        await recordEvents(fieldChangeEvents);
      }
    }

    if (isTagUpdate) {
      await createTagChangeNoteIfNeeded({
        assetId: asset.id,
        organizationId,
        userId,
        previousTags,
        currentTags: asset.tags ?? [],
        loadUserForNotes,
      });

      // Activity event for tag changes — compare the before/after tag-id sets.
      const previousTagIds = new Set(previousTags.map((t) => t.id));
      const currentTagIds = new Set((asset.tags ?? []).map((t) => t.id));
      const setsDiffer =
        previousTagIds.size !== currentTagIds.size ||
        [...previousTagIds].some((t) => !currentTagIds.has(t));
      if (setsDiffer) {
        await recordEvent({
          organizationId,
          actorUserId: userId,
          action: "ASSET_TAGS_CHANGED",
          entityType: "ASSET",
          entityId: asset.id,
          assetId: asset.id,
          field: "tags",
          fromValue: [...previousTagIds],
          toValue: [...currentTagIds],
        });
      }
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
          db.user.findFirst({
            where: { id: userId },
            select: { firstName: true, lastName: true, displayName: true },
          }),
          db.customField.findMany({
            where: {
              id: { in: customFieldsValuesFromForm.map((cf) => cf.id) },
              // Org-scope the lookup so form-supplied custom field ids from
              // another tenant cannot be resolved here (cross-org IDOR guard).
              organizationId,
              active: true,
              deletedAt: null,
            },
            select: { id: true, name: true, type: true },
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
              organizationId,
              isFirstTimeSet: change.isFirstTimeSet,
            })
          );

          await Promise.all(notePromises);

          // Activity events — one per custom field that changed.
          await recordEvents(
            changes.map((change: CustomFieldChangeInfo) => ({
              organizationId,
              actorUserId: userId,
              action: "ASSET_CUSTOM_FIELD_CHANGED",
              entityType: "ASSET",
              entityId: asset.id,
              assetId: asset.id,
              field: change.customFieldName,
              fromValue: (change.previousValue ?? null) as any,
              toValue: (change.newValue ?? null) as any,
              meta: { isFirstTimeSet: change.isFirstTimeSet },
            }))
          );
        }
      }
    }

    return asset;
  } catch (cause) {
    // If it's already a ShelfError (kit guard, qty validator, org-scope
    // guard, etc.), re-throw as-is so the upstream status / title /
    // message survive. `isLikeShelfError` includes a duck-type fallback
    // so re-mocked / re-imported error classes still match. Only unknown
    // errors get wrapped as a 500-ish unique-constraint guess.
    if (isLikeShelfError(cause)) {
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
  actorUserId,
}: Pick<Asset, "id"> & {
  organizationId: Organization["id"];
  /** Optional — caller-supplied userId for the activity event actor. */
  actorUserId?: string;
}) {
  try {
    // Use transaction to ensure delete and activity event are atomic
    const deletedAsset = await db.$transaction(async (tx) => {
      const deleted = await tx.asset.delete({
        where: { id, organizationId },
        select: {
          reminders: {
            select: { alertDateTime: true, activeSchedulerReference: true },
          },
        },
      });

      // Activity event must be inside transaction for atomicity
      await recordEvent(
        {
          organizationId,
          actorUserId: actorUserId ?? null,
          action: "ASSET_DELETED",
          entityType: "ASSET",
          entityId: id,
          assetId: id,
        },
        tx
      );

      return deleted;
    });

    // Cancel reminders outside transaction (cleanup operation, not critical for atomicity)
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

/**
 * Replaces an asset's full set of placements atomically.
 *
 * Called by the asset-overview "Manage placements" dialog. Diff'd
 * against current pivot rows so unchanged placements keep their
 * `createdAt` (preserves the primary-pick LATERAL ordering used by
 * the asset-index column rendering). New placements are created;
 * removed placements are deleted; qty edits update the existing row
 * in place.
 *
 * **Validation invariants** (all enforced before the transaction so a
 * bad submission returns a clean 400 instead of a trigger-fired 500):
 *
 *  - INDIVIDUAL assets cap at exactly one placement with `quantity = 1`
 *    — submitted qty is ignored, count > 1 is rejected.
 *  - QUANTITY_TRACKED: `sum(placements[].quantity) <= Asset.quantity`
 *    (the DEFERRED `enforce_asset_location_sum_within_total` trigger
 *    is the underlying guard; the explicit check here gives a
 *    user-friendly message).
 *  - Each `locationId` must belong to the caller's org.
 *  - No duplicate `locationId` entries in the submitted list.
 *  - Assets that belong to a kit can't have placements edited from the
 *    asset side — the kit-location cascade owns it. Mirrors the
 *    kit-guard in `updateAsset`.
 *
 * @see {@link file://./../../routes/_layout+/assets.$assetId.overview.manage-placements.tsx}
 */
export async function replaceAssetPlacements({
  assetId,
  organizationId,
  userId,
  placements,
}: {
  assetId: string;
  organizationId: Asset["organizationId"];
  userId: User["id"];
  /**
   * Full desired placement set. Empty array means "unplace this asset"
   * (all pivot rows removed). The service deduplicates / validates
   * before any DB write.
   */
  placements: Array<{ locationId: string; quantity: number }>;
}) {
  try {
    // 1. Fetch the asset's current state — total qty, type, manual
    //    placements only (kit-driven rows are owned by the kit's flow
    //    and stay read-only from this dialog), and the kit-driven
    //    placements separately so the sum-within-total math accounts
    //    for them. Manual placements coexist with kit-driven rows on
    //    different `assetKitId` values — the manage-placements dialog
    //    edits manual rows only, kit-driven rows are owned by the
    //    kit's flow.
    const asset = await db.asset.findUniqueOrThrow({
      where: { id: assetId, organizationId },
      select: {
        id: true,
        title: true,
        type: true,
        quantity: true,
        // unitOfMeasure labels the qty-tracked unit count in per-row
        // placement notes ("placed 50 boxes at L").
        unitOfMeasure: true,
        assetLocations: {
          select: {
            locationId: true,
            quantity: true,
            assetKitId: true,
            location: { select: { id: true, name: true } },
          },
        },
      },
    });

    // Split manual vs kit-driven. The diff math below operates only on
    // manual rows; the kit-driven sum is added to the sum-within-total
    // pre-check so a submitted set that "fits" against manual rows
    // alone but exceeds Asset.quantity once kit rows are counted gets
    // rejected up-front instead of failing at the DEFERRED trigger.
    const manualPlacements = asset.assetLocations.filter(
      (al) => al.assetKitId === null
    );
    const kitDrivenSum = asset.assetLocations
      .filter((al) => al.assetKitId !== null)
      .reduce((sum, al) => sum + (al.quantity ?? 0), 0);

    // 3. Shape validation — duplicate ids + per-row qty bounds.
    const seenLocationIds = new Set<string>();
    for (const p of placements) {
      if (!p.locationId || typeof p.locationId !== "string") {
        throw new ShelfError({
          cause: null,
          message: "Each placement must reference a location.",
          status: 400,
          label: "Assets",
          additionalData: { assetId, placements },
          shouldBeCaptured: false,
        });
      }
      if (!Number.isInteger(p.quantity) || p.quantity < 1) {
        throw new ShelfError({
          cause: null,
          message: `Each placement quantity must be a positive integer (got ${p.quantity} for ${p.locationId}).`,
          status: 400,
          label: "Assets",
          additionalData: { assetId, placements },
          shouldBeCaptured: false,
        });
      }
      if (seenLocationIds.has(p.locationId)) {
        throw new ShelfError({
          cause: null,
          message:
            "Duplicate location in the submitted placements — each location can appear at most once per asset.",
          status: 400,
          label: "Assets",
          additionalData: { assetId, placements },
          shouldBeCaptured: false,
        });
      }
      seenLocationIds.add(p.locationId);
    }

    // 4. INDIVIDUAL constraint — at most one row, qty forced to 1.
    if (asset.type !== AssetType.QUANTITY_TRACKED) {
      if (placements.length > 1) {
        throw new ShelfError({
          cause: null,
          message:
            "INDIVIDUAL assets can only be placed at one location. Remove the extra rows or change the asset type.",
          status: 400,
          label: "Assets",
          additionalData: { assetId },
          shouldBeCaptured: false,
        });
      }
      // Force qty to 1 — the picker UI shouldn't render a qty input
      // for INDIVIDUAL, but a tampered submission still gets corrected.
      placements = placements.map((p) => ({ ...p, quantity: 1 }));
    }

    // 5. Sum-within-total — explicit pre-check so the user gets a
    //    nice message; the DEFERRED trigger is the ultimate guard.
    //    Includes the kit-driven sum because those rows survive this
    //    update — the submitted manual set plus the unchanged kit-
    //    driven rows must together fit within `Asset.quantity`.
    if (asset.type === AssetType.QUANTITY_TRACKED) {
      const total = asset.quantity ?? 0;
      const submittedSum = placements.reduce((s, p) => s + p.quantity, 0);
      const projectedSum = submittedSum + kitDrivenSum;
      if (projectedSum > total) {
        throw new ShelfError({
          cause: null,
          title: "Quantity exceeds available pool",
          message:
            kitDrivenSum > 0
              ? `Submitted manual placements (${submittedSum}) plus kit-driven placements (${kitDrivenSum}) sum to ${projectedSum} but the asset has only ${total} units total.`
              : `Submitted placements sum to ${submittedSum} but the asset has only ${total} units total.`,
          status: 400,
          label: "Assets",
          additionalData: {
            assetId,
            submittedSum,
            kitDrivenSum,
            projectedSum,
            total,
          },
          shouldBeCaptured: false,
        });
      }
    }

    // 6. Cross-org guard — every locationId must belong to this org.
    //    Use findMany (not count) so we can reuse the (id, name) pairs
    //    when rendering per-row "placed N units at L" notes after the tx.
    //    The dialog only offers org-scoped locations, so tampering is
    //    the only way to land a foreign id here.
    const submittedLocations = new Map<string, { id: string; name: string }>();
    if (placements.length > 0) {
      const orgLocations = await db.location.findMany({
        where: {
          id: { in: placements.map((p) => p.locationId) },
          organizationId,
        },
        select: { id: true, name: true },
      });
      if (orgLocations.length !== placements.length) {
        throw new ShelfError({
          cause: null,
          message: "One or more locations don't belong to your organization.",
          status: 403,
          label: "Assets",
          additionalData: { assetId, organizationId },
          shouldBeCaptured: true,
        });
      }
      for (const l of orgLocations) submittedLocations.set(l.id, l);
    }

    // 7. Compute diff against current MANUAL pivot rows only. Kit-
    //    driven rows aren't editable from this dialog; they're indexed
    //    by `assetKitId` and survive untouched. A submitted entry at
    //    the same location as a kit-driven row creates a SECOND row
    //    (manual, `assetKitId = null`) — the two coexist.
    const currentByLocation = new Map(
      manualPlacements.map((al) => [al.locationId, al])
    );
    const submittedByLocation = new Map(
      placements.map((p) => [p.locationId, p])
    );

    const toCreate = placements.filter(
      (p) => !currentByLocation.has(p.locationId)
    );
    const toDelete = manualPlacements.filter(
      (al) => !submittedByLocation.has(al.locationId)
    );
    const toUpdate = placements.filter((p) => {
      const existing = currentByLocation.get(p.locationId);
      return existing != null && existing.quantity !== p.quantity;
    });

    // 8. Apply the diff in one tx. The DEFERRED sum-within-total
    //    trigger re-checks at COMMIT — covers any race where another
    //    request modified `Asset.quantity` between our validation and
    //    the write.
    await db.$transaction(async (tx) => {
      if (toDelete.length > 0) {
        // Manual-row only delete. Kit-driven rows at the same
        // (assetId, locationId) aren't on the diff set (we never
        // included them) — `assetKitId: null` scopes this to manual
        // rows alongside the `IN locationId` filter.
        await tx.assetLocation.deleteMany({
          where: {
            assetId,
            assetKitId: null,
            locationId: { in: toDelete.map((al) => al.locationId) },
          },
        });
      }
      // Manual-row only updates. The (assetId, locationId) composite
      // isn't unique on its own (a manual + kit-driven row can coexist
      // at the same location), so we use `updateMany` scoped to
      // `assetKitId IS NULL`. The partial unique
      // `AssetLocation_manual_unique` guarantees at most one matching
      // row per (assetId, locationId) for manual placements.
      for (const u of toUpdate) {
        await tx.assetLocation.updateMany({
          where: { assetId, locationId: u.locationId, assetKitId: null },
          data: { quantity: u.quantity },
        });
      }
      if (toCreate.length > 0) {
        await tx.assetLocation.createMany({
          data: toCreate.map((p) => ({
            assetId,
            locationId: p.locationId,
            organizationId,
            quantity: p.quantity,
          })),
        });
      }

      // Activity events — one ASSET_LOCATION_CHANGED per net add /
      // remove. Qty-only edits don't emit an event today (deliberate
      // gap). Mirrors the `updateLocationAssets` event pattern.
      // `meta.quantity` carries the per-row placement qty (this is the
      // QUANTITY_TRACKED multi-placement editor, so the count is
      // always meaningful here); `assetQtyMeta` no-ops for INDIVIDUAL.
      const events: Parameters<typeof recordEvents>[0] = [
        ...toCreate.map((p) => ({
          organizationId,
          actorUserId: userId,
          action: "ASSET_LOCATION_CHANGED" as const,
          entityType: "ASSET" as const,
          entityId: assetId,
          assetId,
          locationId: p.locationId,
          field: "locationId",
          fromValue: null,
          toValue: p.locationId,
          meta: assetQtyMeta(asset, p.quantity),
        })),
        ...toDelete.map((al) => ({
          organizationId,
          actorUserId: userId,
          action: "ASSET_LOCATION_CHANGED" as const,
          entityType: "ASSET" as const,
          entityId: assetId,
          assetId,
          field: "locationId",
          fromValue: al.locationId,
          toValue: null,
          meta: assetQtyMeta(asset, al.quantity),
        })),
      ];
      if (events.length > 0) {
        await recordEvents(events, tx);
      }
    });

    // Per-row notes emitted AFTER the tx commits. Following the same
    // pattern as `updateLocationAssets`: notes capture intent and don't
    // need to be atomic with the placement diff — a markdoc hiccup
    // shouldn't roll back the actual placement write. Three shapes:
    //   • toCreate → "placed N units at L"
    //   • toDelete → "removed N units from L"
    //   • toUpdate → "changed quantity at L from X to Y units"
    // (Activity events on the toUpdate path are still the deliberate
    // gap — revisit when ASSET_LOCATION_CHANGED gets a "quantity-only"
    // variant.)
    if (toCreate.length > 0 || toDelete.length > 0 || toUpdate.length > 0) {
      const user = await getUserByID(userId, {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
        } satisfies Prisma.UserSelect,
      });
      const firstName = user?.firstName ?? "";
      const lastName = user?.lastName ?? "";

      // Resolve location ids for the toUpdate set (same locations as
      // their pre-update manual rows; they survived the diff). We pull
      // names from the manualPlacements snapshot so we don't need a
      // second query.
      const manualByLocation = new Map(
        manualPlacements.map((al) => [al.locationId, al])
      );

      // The qty-change note is inline (not via `createLocationChangeNote`)
      // because the helper handles add / move / remove, not a "same
      // location, different quantity" case. INDIVIDUAL is also
      // structurally never on this path — qty was forced to 1 above,
      // so an INDIVIDUAL "qty change" diff entry can't reach here.
      const qtyChangeNoteCalls = toUpdate.flatMap((p) => {
        const existing = manualByLocation.get(p.locationId);
        const locationMeta = submittedLocations.get(p.locationId);
        if (!existing || !locationMeta) return [];
        const fromCount = formatUnitCount(asset, existing.quantity);
        const toCount = formatUnitCount(asset, p.quantity);
        if (!fromCount || !toCount) return [];
        const actor = wrapUserLinkForNote({
          id: userId,
          firstName,
          lastName,
        });
        const locationLink = wrapLinkForNote(
          `/locations/${locationMeta.id}`,
          locationMeta.name.trim()
        );
        return [
          createNote({
            content: `${actor} changed quantity at ${locationLink} from ${fromCount} to ${toCount}.`,
            type: "UPDATE",
            userId,
            assetId,
            organizationId,
          }),
        ];
      });

      await Promise.all([
        ...toCreate.map((p) => {
          const location = submittedLocations.get(p.locationId);
          if (!location) return Promise.resolve();
          return createLocationChangeNote({
            currentLocation: null,
            newLocation: location,
            firstName,
            lastName,
            assetId,
            userId,
            isRemoving: false,
            organizationId,
            type: asset.type,
            unitOfMeasure: asset.unitOfMeasure,
            quantity: p.quantity,
          });
        }),
        ...toDelete.map((al) =>
          createLocationChangeNote({
            currentLocation: al.location,
            newLocation: null,
            firstName,
            lastName,
            assetId,
            userId,
            isRemoving: true,
            organizationId,
            type: asset.type,
            unitOfMeasure: asset.unitOfMeasure,
            quantity: al.quantity,
          })
        ),
        ...qtyChangeNoteCalls,
      ]);
    }

    return { ok: true as const };
  } catch (cause) {
    if (isLikeShelfError(cause)) throw cause;
    throw new ShelfError({
      cause,
      message: "Something went wrong while updating asset placements.",
      additionalData: { assetId, userId, organizationId },
      label: "Assets",
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
      mainImageExpiration: threeDaysFromNow(),
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
    // Image cleanup is non-critical — the asset duplication still succeeds.
    // Transient Supabase storage errors (e.g., 502) should not pollute Sentry.
    Logger.error(
      new ShelfError({
        cause,
        title: "Oops, deletion of other asset images failed",
        message: "Something went wrong while deleting other asset images",
        additionalData: { assetId, userId },
        label,
        shouldBeCaptured: false,
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

/**
 * Creates one or more copies of an existing asset within the same organization.
 *
 * Copies the source asset's title, description, category, location, tags,
 * valuation, custom field values and (best-effort) main image onto each
 * duplicate.
 *
 * @param params.asset - The org-scoped source asset (with tags, custody, custom fields)
 * @param params.userId - The acting user's ID
 * @param params.amountOfDuplicates - How many copies to create
 * @param params.organizationId - The caller's validated organization ID; all
 *   duplicates and copied tags are constrained to this org
 * @returns The list of created duplicate assets
 * @throws {ShelfError} If a copied tag does not belong to `organizationId`
 *   (cross-org guard) or if duplication otherwise fails
 */
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
      // Needed so the duplicate can copy the primary placement.
      assetLocations: { select: { location: { select: { id: true } } } };
    };
  }>;
  userId: string;
  amountOfDuplicates: number;
  organizationId: string;
}) {
  try {
    const duplicatedAssets: Awaited<ReturnType<typeof createAsset>>[] = [];

    // why: defense-in-depth cross-org guard. The source `asset` is loaded
    // org-scoped by the caller, but we re-validate the tag ids against the
    // target `organizationId` before copying them onto the new assets so a
    // tampered/stale payload can never connect tags from another workspace.
    const copiedTagIds = asset.tags.map((tag) => tag.id);
    await assertTagsBelongToOrg({ tagIds: copiedTagIds, organizationId });

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
      locationId: getPrimaryLocation(asset)?.id ?? undefined,
      tags: { set: copiedTagIds.map((id) => ({ id })) },
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
            await db.asset.update({
              // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: duplicatedAsset was just created by createAsset({ organizationId }) on line ~2216; this only writes back its own mainImage
              where: { id: duplicatedAsset.id },
              data: {
                mainImage: imagePath,
                mainImageExpiration: threeDaysFromNow(),
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
      db.tag.findMany({
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
  // `AssetKit` pivot. Callers still pass a plain `kitId` string here
  // for filtering; the where-builder will map it onto `assetKits.some`.
  kitId?: string | null;
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
    assetKitFilter,
  } = paramsValues;

  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  try {
    /**
     * These three queries are independent (no data flows between them),
     * so we run them in parallel to reduce total loader latency.
     */
    const [
      {
        tags,
        totalTags,
        categories,
        totalCategories,
        locations,
        totalLocations,
      },
      teamMembersData,
      { assets, totalAssets },
    ] = await Promise.all([
      getEntitiesWithSelectedValues({
        organizationId,
        allSelectedEntries: getAllEntries,
        selectedCategoryIds: categoriesIds,
        selectedTagIds: tagsIds,
        selectedLocationIds: locationIds,
      }),
      getTeamMemberForCustodianFilter({
        organizationId,
        selectedTeamMembers: teamMemberIds,
        getAll: getAllEntries.includes("teamMember"),
        filterByUserId: isSelfService,
        userId,
      }),
      getAssets({
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
      }),
    ]);

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

/**
 * Creates a system note recording a change to a custom field value on an asset.
 *
 * @param params.assetId - The asset the note is attached to
 * @param params.userId - The acting user's ID
 * @param params.organizationId - The asset's organization ID; scopes the note
 *   write so it cannot be attached cross-org
 * @returns void (no note is created when the change produces an empty message)
 * @throws {ShelfError} If the note creation fails
 */
export async function createCustomFieldChangeNote({
  customFieldName,
  previousValue,
  newValue,
  firstName,
  lastName,
  assetId,
  userId,
  organizationId,
  isFirstTimeSet,
}: {
  customFieldName: string;
  previousValue?: string | null;
  newValue?: string | null;
  firstName: string;
  lastName: string;
  assetId: Asset["id"];
  userId: User["id"];
  organizationId: Organization["id"];
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
      organizationId,
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
    return await db.asset.findMany({
      where: {
        organizationId,
      },
      include: {
        category: true,
        assetLocations: { include: { location: true } },
        // Phase A5: include the model so backup-export can emit
        // assetModel.name (round-trippable across orgs). Without it,
        // re-import would only get the opaque assetModelId.
        assetModel: { select: { name: true } },
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
 * Parsed shape of the quantity-tracked + AssetModel columns for a single
 * CSV import row. All fields are optional: a row with none of these
 * columns falls back to `type=INDIVIDUAL, quantity=1` at the createAsset
 * boundary.
 *
 * @see {@link parseQtyTrackedCsvRow}
 */
type ParsedQtyTrackedCsvRow = {
  type: AssetType | undefined;
  quantity: number | undefined;
  minQuantity: number | undefined;
  unitOfMeasure: string | undefined;
  consumptionType: ConsumptionType | undefined;
};

/**
 * Parses + validates the quantity-tracked columns
 * (`type`, `quantity`, `minQuantity`, `unitOfMeasure`, `consumptionType`)
 * from a single CSV import row, on the create path.
 *
 * Thin adapter over the shared `validateQtyTrackedFields` validator so
 * the update path (`parseQtyTrackedUpdateRow`) and the create path
 * share a single source of truth for per-field error messages and
 * validation rules. The function's public signature + return shape is
 * preserved verbatim so the existing `createAssetsFromContentImport`
 * call site keeps working without changes.
 *
 * @param asset - The parsed CSV row (raw string values + injected `key`)
 * @returns Typed object ready to spread into the createAsset payload
 * @throws {ShelfError} 400 on any column-format failure
 */
function parseQtyTrackedCsvRow(
  asset: CreateAssetFromContentImportPayload
): ParsedQtyTrackedCsvRow {
  return validateQtyTrackedFields(
    {
      type: asset.type,
      quantity: asset.quantity,
      minQuantity: asset.minQuantity,
      unitOfMeasure: asset.unitOfMeasure,
      consumptionType: asset.consumptionType,
    },
    { kind: "create" },
    {
      rowLabel: `asset "${asset.title}"`,
      additionalData: { assetKey: asset.key },
    }
  );
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
    const [
      kits,
      categories,
      locations,
      teamMembers,
      tags,
      { customFields },
      assetModels,
    ] = await Promise.all([
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
      createAssetModelsIfNotExists({
        data,
        userId,
        organizationId,
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
              message:
                "Image URL must be a valid http(s) URL, including the https:// prefix.",
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
            mainImageExpiration = threeDaysFromNow();
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

      // ── AssetModel column → resolved model id ──────────────────────
      const modelKey = asset.assetModel?.trim();
      const assetModelId =
        modelKey && assetModels?.[modelKey] ? assetModels[modelKey] : undefined;
      if (modelKey && !assetModelId) {
        // The createAssetModelsIfNotExists pre-resolve should have
        // populated every non-empty key. If we land here, something
        // went wrong upstream (e.g. an upsert failed silently).
        throw new ShelfError({
          cause: null,
          message: `Asset model "${modelKey}" could not be resolved for asset "${asset.title}". Please verify the assetModel column values in your CSV.`,
          additionalData: {
            assetKey: asset.key,
            assetTitle: asset.title,
            assetModel: modelKey,
          },
          label: "Assets",
          shouldBeCaptured: false,
        });
      }

      // ── Quantity-tracked columns → typed + validated ───────────────
      const { type, quantity, minQuantity, unitOfMeasure, consumptionType } =
        parseQtyTrackedCsvRow(asset);

      // AssetModel is INDIVIDUAL-only — a model represents N
      // distinguishable units of the same template, whereas a
      // QUANTITY_TRACKED asset is a stock pool. Reject the row up-front
      // with a row-friendly message rather than silently dropping the
      // model link or relying on createAsset's downstream guard.
      if (type === AssetType.QUANTITY_TRACKED && assetModelId) {
        throw new ShelfError({
          cause: null,
          title: "Asset model not allowed",
          message: `Asset "${asset.title}": models can only be linked to INDIVIDUAL assets. Remove the assetModel cell or change type to INDIVIDUAL.`,
          label: "Assets",
          status: 400,
          shouldBeCaptured: false,
          additionalData: { assetKey: asset.key, assetTitle: asset.title },
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
        // AssetModel + qty-tracked fields (default INDIVIDUAL, quantity=1
        // when columns are absent or empty).
        assetModelId,
        type,
        quantity,
        minQuantity,
        unitOfMeasure,
        consumptionType,
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
        /** Quantity-tracked + assetModel fields — passed through from
         * the backup payload. Backup export emits these as raw string
         * values (per-Asset scalar columns); on restore we read them
         * back so round-trip preserves the qty-tracked semantics. The
         * content-import path validates these aggressively; for backup
         * import we trust the source (it came from our own exporter)
         * but still coerce types defensively. */
        const backupType =
          typeof asset.type === "string" &&
          (asset.type === AssetType.INDIVIDUAL ||
            asset.type === AssetType.QUANTITY_TRACKED)
            ? (asset.type as AssetType)
            : undefined;
        const backupQuantity =
          typeof asset.quantity === "string" && asset.quantity.trim() !== ""
            ? Number(asset.quantity)
            : typeof asset.quantity === "number"
            ? asset.quantity
            : undefined;
        const backupMinQuantity =
          typeof asset.minQuantity === "string" &&
          asset.minQuantity.trim() !== ""
            ? Number(asset.minQuantity)
            : typeof asset.minQuantity === "number"
            ? asset.minQuantity
            : undefined;
        const backupUnit =
          typeof asset.unitOfMeasure === "string" && asset.unitOfMeasure !== ""
            ? sanitizeUnitOfMeasureLabel(asset.unitOfMeasure)
            : undefined;
        const backupCt =
          typeof asset.consumptionType === "string" &&
          (asset.consumptionType === ConsumptionType.ONE_WAY ||
            asset.consumptionType === ConsumptionType.TWO_WAY)
            ? (asset.consumptionType as ConsumptionType)
            : undefined;

        /** Base data from asset */
        const d = {
          data: {
            title: asset.title,
            description: asset.description || null,
            mainImage: asset.mainImage || null,
            mainImageExpiration: threeDaysFromNow(),
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
            ...(backupType !== undefined ? { type: backupType } : {}),
            ...(backupQuantity !== undefined
              ? { quantity: backupQuantity }
              : {}),
            ...(backupMinQuantity !== undefined
              ? { minQuantity: backupMinQuantity }
              : {}),
            ...(backupUnit !== undefined ? { unitOfMeasure: backupUnit } : {}),
            ...(backupCt !== undefined ? { consumptionType: backupCt } : {}),
          },
        };

        /** AssetModel by name — mirrors the category block below.
         * Skip linkage entirely when the row is QUANTITY_TRACKED:
         * models are INDIVIDUAL-only by design. Importing a backup that
         * predates this rule should not block (we just drop the model
         * connect) — the user can clean up the export upstream or
         * re-import the model link manually after fixing the type. */
        if (
          asset.assetModel &&
          typeof asset.assetModel === "object" &&
          (asset.assetModel as any).name &&
          backupType !== AssetType.QUANTITY_TRACKED
        ) {
          const modelPayload = asset.assetModel as { name: string };
          const existingModel = await db.assetModel.findFirst({
            where: {
              organizationId,
              name: {
                equals: modelPayload.name.trim(),
                mode: "insensitive",
              },
            },
          });
          if (existingModel) {
            Object.assign(d.data, { assetModelId: existingModel.id });
          } else {
            const newModel = await db.assetModel.create({
              data: {
                name: modelPayload.name.trim(),
                createdBy: { connect: { id: userId } },
                organization: { connect: { id: organizationId } },
              },
            });
            Object.assign(d.data, { assetModelId: newModel.id });
          }
        }

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
                create: [{ teamMemberId: newCustodian.id }],
              },
            });
          } else {
            Object.assign(d.data, {
              custody: {
                create: [{ teamMemberId: existingCustodian.id }],
              },
            });
          }
        }

        /** Tags */
        if (asset.tags && asset.tags.length > 0) {
          const tagsNames = asset.tags.map((t) => t.name);
          // now we loop through the categories and check if they exist
          const tags: Record<string, string> = {};
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

        // Activity event: ASSET_CREATED at the moment of creation.
        // The per-note createMany below restores HISTORICAL notes with
        // their original timestamps — those are not events.
        await recordEvent({
          organizationId,
          actorUserId: userId,
          action: "ASSET_CREATED",
          entityType: "ASSET",
          entityId: assetId,
          assetId,
          meta: { source: "backup_import" },
        });

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

/**
 * Enriches CHECKED_OUT assets with booking custodian info as a synthetic `custody` property.
 *
 * Previously this made a separate DB query (N+1 pattern). Now the booking custodian
 * data is included in the initial asset query via `assetIndexFields`, so this function
 * just reads the active booking from `asset.bookings` directly — no DB call needed.
 *
 * @param assets - Assets with `bookingAssets` already included from the initial query
 * @returns The same assets array with `custody.custodian` added for checked-out assets
 */
export function updateAssetsWithBookingCustodians<
  T extends Asset & {
    bookingAssets?: Array<{
      booking?: {
        id: string;
        status?: string;
        custodianTeamMember?: { name: string } | null;
        custodianUser?: {
          firstName: string | null;
          lastName: string | null;
          displayName: string | null;
          profilePicture: string | null;
        } | null;
        [key: string]: unknown;
      };
      [key: string]: unknown;
    }>;
  },
>(assets: T[]) {
  const checkedOutAssetIds = new Set(
    assets.filter((a) => a.status === "CHECKED_OUT").map((a) => a.id)
  );

  if (checkedOutAssetIds.size === 0) {
    return assets;
  }

  /**
   * Map over assets and use the already-included bookingAssets data
   * to build the same custody shape the UI expects.
   */
  return assets.map((a) => {
    if (!checkedOutAssetIds.has(a.id)) {
      return a;
    }

    // When the availability view is active, bookingAssets may include RESERVED
    // entries alongside ONGOING/OVERDUE. Pick the active checkout explicitly.
    const bookingAsset =
      a.bookingAssets?.find(
        (ba) =>
          "booking" in ba &&
          ba.booking &&
          "status" in ba.booking &&
          (ba.booking.status === "ONGOING" || ba.booking.status === "OVERDUE")
      ) ?? a.bookingAssets?.[0];
    const booking = bookingAsset?.booking;
    const custodianUser = booking?.custodianUser;
    const custodianTeamMember = booking?.custodianTeamMember;

    /** If there is a custodian user, use its data to display the name */
    if (custodianUser) {
      return {
        ...a,
        custody: {
          custodian: {
            // Prioritizes displayName, falls back to firstName + lastName
            name: resolveUserDisplayName(custodianUser),
            user: {
              firstName: custodianUser.firstName || "",
              lastName: custodianUser.lastName || "",
              profilePicture: custodianUser.profilePicture || null,
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
        additionalData: { assetId: a.id, status: a.status },
        label,
      })
    );

    return a;
  });
}

/**
 * Checks if an error indicates the storage object was not found.
 * Walks both additionalData and the cause chain to handle
 * Supabase StorageApiError wrapped by ShelfError.
 */
export function isStorageObjectNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  if (
    "additionalData" in error &&
    error.additionalData &&
    typeof error.additionalData === "object" &&
    "errorMessage" in error.additionalData &&
    typeof error.additionalData.errorMessage === "string" &&
    error.additionalData.errorMessage.toLowerCase().includes("object not found")
  ) {
    return true;
  }

  if ("cause" in error && error.cause) {
    if (
      error.cause instanceof Error &&
      error.cause.message.toLowerCase().includes("object not found")
    ) {
      return true;
    }
    return isStorageObjectNotFound(error.cause);
  }

  return false;
}

/**
 * Refreshes expired signed URLs for asset images server-side.
 * Prevents N+1 client-side calls to /api/asset/refresh-main-image.
 *
 * Only refreshes existing thumbnail URLs — does not generate missing
 * thumbnails, as that requires downloading + re-uploading images
 * which is too expensive for a batch operation.
 */
export async function refreshExpiredAssetImages<
  T extends {
    id: string;
    organizationId: string;
    mainImage: string | null;
    mainImageExpiration: Date | null;
    thumbnailImage?: string | null;
  },
>(assets: T[]): Promise<T[]> {
  const now = new Date();
  const expiredAssets = assets.filter(
    (a) =>
      a.mainImage &&
      a.mainImageExpiration &&
      new Date(a.mainImageExpiration) < now
  );

  if (expiredAssets.length === 0) return assets;

  const BATCH_SIZE = 10;
  /** Short backoff to prevent retry storms when refresh fails */
  const BACKOFF_SECONDS = 30;

  const applyBackoff = async (asset: (typeof expiredAssets)[number]) => {
    try {
      const backoffExpiration = new Date(Date.now() + BACKOFF_SECONDS * 1000);
      await db.asset.update({
        where: { id: asset.id, organizationId: asset.organizationId },
        data: { mainImageExpiration: backoffExpiration },
      });
    } catch {
      // If even the backoff update fails, just move on
    }
  };

  const refreshAsset = async (asset: (typeof expiredAssets)[number]) => {
    try {
      const mainImagePath = extractStoragePath(asset.mainImage!, "assets");
      if (!mainImagePath) {
        // Can't extract path — apply backoff to avoid retrying every load
        await applyBackoff(asset);
        return null;
      }

      // Refresh main image and thumbnail in parallel — they're independent
      // Supabase signed URL calls. This halves latency for assets with thumbnails.
      const thumbnailPath = asset.thumbnailImage
        ? extractStoragePath(asset.thumbnailImage, "assets")
        : null;

      const [newMainImageUrl, newThumbnailUrl] = await Promise.all([
        createSignedUrl({
          filename: mainImagePath,
          bucketName: "assets",
        }),
        thumbnailPath
          ? createSignedUrl({
              filename: thumbnailPath,
              bucketName: "assets",
            }).catch(() => {
              Logger.info(
                `Failed to refresh thumbnail for asset ${asset.id}, proceeding with mainImage only`
              );
              return null;
            })
          : Promise.resolve(null),
      ]);

      // 72h expiration reduces how often users hit the refresh path,
      // which blocks the loader while it generates new signed URLs.
      const newExpiration = threeDaysFromNow();

      const updateData: {
        mainImage: string;
        mainImageExpiration: Date;
        thumbnailImage?: string;
      } = {
        mainImage: newMainImageUrl,
        mainImageExpiration: newExpiration,
      };

      if (newThumbnailUrl) {
        updateData.thumbnailImage = newThumbnailUrl;
      }

      await db.asset.update({
        where: { id: asset.id, organizationId: asset.organizationId },
        data: updateData,
      });

      return {
        id: asset.id,
        mainImage: newMainImageUrl,
        mainImageExpiration: newExpiration,
        ...(newThumbnailUrl ? { thumbnailImage: newThumbnailUrl } : {}),
      };
    } catch (error) {
      // Asset deleted between query and update — not an error
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        return null;
      }

      // File deleted from storage — expected, not a bug
      if (isStorageObjectNotFound(error)) {
        Logger.info(
          `Image file not found in storage for asset ${asset.id}, applying backoff`
        );
        await applyBackoff(asset);
        return null;
      }

      // Preserve shouldBeCaptured from original error if present
      const shouldCapture =
        error &&
        typeof error === "object" &&
        "shouldBeCaptured" in error &&
        typeof error.shouldBeCaptured === "boolean"
          ? error.shouldBeCaptured
          : true;

      Logger.error(
        new ShelfError({
          cause: error,
          message: `Failed to refresh expired image URLs for asset ${asset.id}`,
          additionalData: { assetId: asset.id },
          label: "Assets",
          shouldBeCaptured: shouldCapture,
        })
      );

      await applyBackoff(asset);
      throw error;
    }
  };

  const refreshResults: PromiseSettledResult<{
    id: string;
    mainImage: string;
    mainImageExpiration: Date;
    thumbnailImage?: string;
  } | null>[] = [];

  for (let i = 0; i < expiredAssets.length; i += BATCH_SIZE) {
    const batch = expiredAssets.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map((asset) => refreshAsset(asset))
    );
    refreshResults.push(...batchResults);
  }

  const refreshedMap = new Map<
    string,
    {
      mainImage: string;
      mainImageExpiration: Date;
      thumbnailImage?: string;
    }
  >();
  for (const result of refreshResults) {
    if (result.status === "fulfilled" && result.value) {
      const entry: {
        mainImage: string;
        mainImageExpiration: Date;
        thumbnailImage?: string;
      } = {
        mainImage: result.value.mainImage,
        mainImageExpiration: result.value.mainImageExpiration,
      };
      if (result.value.thumbnailImage) {
        entry.thumbnailImage = result.value.thumbnailImage;
      }
      refreshedMap.set(result.value.id, entry);
    }
  }

  return assets.map((a) => {
    const refreshed = refreshedMap.get(a.id);
    if (refreshed) {
      return { ...a, ...refreshed };
    }
    return a;
  });
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
     * We have to remove the images of assets so we have to make this query first.
     * `title` is also selected so we can attach it as `meta.title` on the
     * `ASSET_DELETED` activity events emitted post-delete (useful for
     * activity feeds where the asset row no longer exists to JOIN against).
     */
    const assets = await db.asset.findMany({
      where: {
        id: { in: resolvedIds },
        organizationId,
      },
      select: { id: true, mainImage: true, title: true },
    });

    try {
      // Defense-in-depth: a bulk delete cascades across every asset relation
      // (notes, custody, codes, custom-field values, booking joins …), so a
      // large selection can creep past Prisma's 5s interactive-tx default and
      // abort with P2028 (Sentry SHELF-WEBAPP-1MJ). Bump the ceiling to 15s,
      // matching the booking-checkout precedent.
      await db.$transaction(
        async (tx) => {
          // Activity events — one ASSET_DELETED per asset, emitted in the
          // same tx as the deleteMany so a rollback nukes both. Emitted
          // BEFORE the delete so the rows still exist for cross-ref checks
          // (mirrors singular `deleteAsset`); `meta.title` survives the
          // row delete so activity feeds can render the name later.
          if (assets.length > 0) {
            await recordEvents(
              assets.map((asset) => ({
                organizationId,
                actorUserId: userId,
                action: "ASSET_DELETED" as const,
                entityType: "ASSET" as const,
                entityId: asset.id,
                assetId: asset.id,
                meta: { title: asset.title },
              })),
              tx
            );
          }

          await tx.asset.deleteMany({
            // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `assets` was fetched on lines 3659-3665 with where { id in resolvedIds, organizationId }; every id here is already org-proven
            where: { id: { in: assets.map((asset) => asset.id) } },
          });
        },
        { timeout: 15000 }
      );

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

/**
 * Assigns custody of multiple assets to a team member.
 *
 * Sets each asset's status to IN_CUSTODY, creates custody records linking
 * them to the custodian, and logs activity notes. Only AVAILABLE assets
 * can be assigned — throws if any selected asset is unavailable.
 *
 * Supports both explicit asset IDs and the ALL_SELECTED filter pattern
 * (via `currentSearchParams` + `settings`).
 *
 * @param params.custodianId - Team member ID from request input; validated
 *   against `organizationId` (cross-org IDOR guard) before any custody row
 *   is written
 * @param params.organizationId - The caller's validated organization ID
 * @throws {ShelfError} If the custodian does not belong to `organizationId`,
 *   or if any selected asset is not AVAILABLE
 */
export async function bulkCheckOutAssets({
  userId,
  role,
  assetIds,
  custodianId,
  custodianName,
  organizationId,
  currentSearchParams,
  settings,
}: {
  userId: User["id"];
  /**
   * Caller's role. Required so the SELF_SERVICE self-restriction is enforced
   * here for EVERY caller (web + mobile), not duplicated in each route. When
   * `SELF_SERVICE` the service rejects assignments to anyone other than the
   * calling user — symmetric counterpart on the release side lives in the
   * route today (see `routes/api+/assets.bulk-release-custody.ts`).
   */
  role: OrganizationRoles;
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
    const [allAssets, user, custodianTeamMember] = await Promise.all([
      db.asset.findMany({
        where: {
          id: { in: resolvedIds },
          organizationId,
        },
        select: { id: true, title: true, status: true, type: true },
      }),
      getUserByID(userId, {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
        } satisfies Prisma.UserSelect,
      }),
      // why: cross-org guard. `custodianId` comes from request input, so the
      // team-member lookup is org-scoped — a foreign-org team member resolves
      // to null here (and is hard-rejected by the assert inside the tx below)
      // so custody can never be granted to a custodian from another workspace.
      db.teamMember.findFirst({
        where: { id: custodianId, organizationId },
        select: {
          name: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
        },
      }),
    ]);

    /**
     * SELF_SERVICE guard: a self-service user can only assign custody to
     * themselves. Centralised in the service so every caller (web + mobile)
     * is covered — previously this lived only in the web route and the mobile
     * routes bypassed it. Both routes just pass `role` through.
     */
    if (
      role === OrganizationRoles.SELF_SERVICE &&
      custodianTeamMember?.user?.id !== userId
    ) {
      throw new ShelfError({
        cause: null,
        title: "Action not allowed",
        message: "Self user can only assign custody to themselves only.",
        additionalData: { userId, assetIds, custodianId },
        label: "Assets",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    /**
     * Filter out QUANTITY_TRACKED assets — they require per-asset
     * quantity input and cannot participate in bulk custody operations.
     */
    const assets = allAssets.filter((a) => a.type !== "QUANTITY_TRACKED");
    const skippedQuantityTracked = allAssets.length - assets.length;

    if (assets.length === 0 && skippedQuantityTracked > 0) {
      throw new ShelfError({
        cause: null,
        message:
          "All selected assets are quantity-tracked. Quantity-tracked assets must be assigned custody individually with a specific quantity.",
        label: "Assets",
        shouldBeCaptured: false,
      });
    }

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
      // why: hard cross-org guard inside the tx. Mirrors the org-scoped
      // validation pattern used by `updateBookingAssets`. This throws before
      // any custody row is written if `custodianId` belongs to another
      // organization, preventing a cross-tenant IDOR via the bulk endpoint.
      await assertTeamMemberBelongsToOrg(
        { teamMemberId: custodianId, organizationId },
        tx
      );

      /** Clean up any stale custody records that may exist despite AVAILABLE status.
       * This prevents P2002 unique constraint violations when a previous
       * release/checkin updated status but failed to delete the custody row. */
      await tx.custody.deleteMany({
        where: { assetId: { in: assets.map((a) => a.id) } },
      });

      /** Creating custodies over assets */
      await tx.custody.createMany({
        data: assets.map((asset) => ({
          assetId: asset.id,
          teamMemberId: custodianId,
        })),
      });

      /** Updating status of assets to IN_CUSTODY */
      await tx.asset.updateMany({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `assets` was fetched on lines 3773-3779 with where { id in resolvedIds, organizationId }; every id is already org-proven
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

      // why: `assets` is individual-only — QUANTITY_TRACKED were filtered out
      // above (they have no Custody.quantity in this path), so no unit count
      // is surfaced here. Qty-tracked grants go through `checkOutQuantity`.
      await tx.note.createMany({
        data: assets.map((asset) => ({
          content: `${actor} granted ${custodianDisplay} custody.`,
          type: "UPDATE",
          userId,
          assetId: asset.id,
        })),
      });

      // Activity events — one CUSTODY_ASSIGNED per asset, inside the tx.
      // why: individual-only (qty-tracked filtered out above), so no
      // meta.quantity — the qty-tracked path is `checkOutQuantity`.
      await recordEvents(
        assets.map((asset) => ({
          organizationId,
          actorUserId: userId,
          action: "CUSTODY_ASSIGNED",
          entityType: "ASSET",
          entityId: asset.id,
          assetId: asset.id,
          teamMemberId: custodianId,
          targetUserId: custodianTeamMember?.user?.id ?? undefined,
        })),
        tx
      );
    });

    return { success: true, skippedQuantityTracked };
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

/**
 * Releases custody of multiple assets, returning them to AVAILABLE status.
 *
 * Deletes custody records, sets each asset's status to AVAILABLE, and logs
 * activity notes. Only assets that currently have custody can be released —
 * throws if any selected asset has no custody.
 *
 * Supports both explicit asset IDs and the ALL_SELECTED filter pattern
 * (via `currentSearchParams` + `settings`).
 */
export async function bulkCheckInAssets({
  userId,
  role,
  assetIds,
  organizationId,
  currentSearchParams,
  settings,
}: {
  userId: User["id"];
  /**
   * Caller's role. Required so the SELF_SERVICE self-restriction is enforced
   * here for EVERY caller (web + mobile), not duplicated in each route — when
   * `SELF_SERVICE` the service rejects release of custody assigned to anyone
   * other than the calling user.
   */
  role: OrganizationRoles;
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
    const [allAssets, user] = await Promise.all([
      db.asset.findMany({
        where: {
          id: { in: resolvedIds },
          organizationId,
        },
        select: {
          id: true,
          title: true,
          type: true,
          custody: {
            select: { id: true, custodian: { include: { user: true } } },
          },
        },
      }),
      getUserByID(userId, {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
        } satisfies Prisma.UserSelect,
      }),
    ]);

    /**
     * Filter out QUANTITY_TRACKED assets — they require per-asset
     * quantity input and cannot participate in bulk custody operations.
     */
    const assets = allAssets.filter((a) => a.type !== "QUANTITY_TRACKED");
    const skippedQuantityTracked = allAssets.length - assets.length;

    if (assets.length === 0 && skippedQuantityTracked > 0) {
      throw new ShelfError({
        cause: null,
        message:
          "All selected assets are quantity-tracked. Quantity-tracked assets must have custody released individually.",
        label: "Assets",
        shouldBeCaptured: false,
      });
    }

    const hasAssetsWithoutCustody = assets.some(
      (asset) => !hasCustody(asset.custody)
    );

    if (hasAssetsWithoutCustody) {
      throw new ShelfError({
        cause: null,
        message:
          "There are some assets without custody. Please make sure you are selecting assets with custody.",
        label: "Assets",
        shouldBeCaptured: false,
      });
    }

    // Self-service users may only release custody of assets assigned to them.
    // `Asset.custody` is a `Custody[]` post Phase 2 widening (multi-custodian
    // for QUANTITY_TRACKED). For INDIVIDUAL there's exactly one row; for
    // qty-tracked we'd reject if ANY row belongs to someone else — but
    // qty-tracked rows are filtered out above anyway.
    if (
      role === OrganizationRoles.SELF_SERVICE &&
      assets.some((asset) =>
        (asset.custody ?? []).some((c) => c.custodian?.userId !== userId)
      )
    ) {
      throw new ShelfError({
        cause: null,
        title: "Action not allowed",
        message:
          "Self service user can only release custody of assets assigned to their user.",
        additionalData: { userId, assetIds },
        label: "Assets",
        status: 403,
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
          assetId: { in: assets.map((asset) => asset.id) },
        },
      });

      /** Updating status of assets to AVAILABLE */
      await tx.asset.updateMany({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `assets` was fetched on lines 3948-3952 with where { id in resolvedIds, organizationId }; every id is already org-proven
        where: { id: { in: assets.map((asset) => asset.id) } },
        data: { status: AssetStatus.AVAILABLE },
      });

      /** Creating notes for the assets */
      // why: `assets` is individual-only — QUANTITY_TRACKED were filtered out
      // above (they have no Custody.quantity in this path), so no unit count
      // is surfaced here. Qty-tracked releases go through the per-unit path.
      await tx.note.createMany({
        data: assets.map((asset) => {
          const primaryCustody = getPrimaryCustody(asset.custody);
          return {
            content: `**${user.firstName?.trim()} ${
              user.lastName
            }** has released **${
              primaryCustody
                ? resolveTeamMemberName(primaryCustody.custodian)
                : "Unknown Custodian"
            }'s** custody over **${asset.title?.trim()}**`,
            type: "UPDATE",
            userId,
            assetId: asset.id,
          };
        }),
      });

      // Activity events — one CUSTODY_RELEASED per asset, inside the tx.
      // Phase 2 turned `Asset.custody` into a `Custody[]` array, so we
      // use the same `getPrimaryCustody` helper as the note above to pick
      // a representative custodian for the event.
      // why: individual-only (qty-tracked filtered out above), so no
      // meta.quantity — the qty-tracked release path is per-unit.
      await recordEvents(
        assets.map((asset) => {
          const primaryCustody = getPrimaryCustody(asset.custody);
          return {
            organizationId,
            actorUserId: userId,
            action: "CUSTODY_RELEASED",
            entityType: "ASSET",
            entityId: asset.id,
            assetId: asset.id,
            teamMemberId: primaryCustody?.custodian?.id,
          };
        }),
        tx
      );
    });

    return { success: true, skippedQuantityTracked };
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
    const [assets, user] = await Promise.all([
      db.asset.findMany({
        where: {
          id: { in: resolvedIds },
          organizationId,
        },
        select: {
          id: true,
          title: true,
          type: true,
          quantity: true,
          // We only care about the primary placement here (the bulk
          // location update sets a single new location per asset).
          assetLocations: {
            select: {
              locationId: true,
              location: { select: { id: true, name: true } },
            },
          },
          assetKits: { select: { kit: { select: { id: true, name: true } } } },
        },
      }),
      getUserByID(userId, {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
        } satisfies Prisma.UserSelect,
      }),
    ]);

    /**
     * Filter out QUANTITY_TRACKED assets FIRST — they always skip the
     * bulk path (no per-asset qty input here), so they shouldn't be
     * counted against the kit-guard below. A qty-tracked asset that
     * happens to be in a kit would otherwise trip the kit-guard error
     * even though it would have been skipped anyway. Mirror of the
     * bulk-custody pattern (`bulkCheckOutAssets` line ~4099-4113):
     * silently skip qty-tracked rows, throw early when the whole
     * selection is qty-tracked. The dialog shows a `WarningBox`
     * summarising the skip so users know what happened.
     */
    const nonQtyTracked = assets.filter(
      (a) => a.type !== AssetType.QUANTITY_TRACKED
    );
    const skippedQuantityTracked = assets.length - nonQtyTracked.length;
    if (nonQtyTracked.length === 0 && skippedQuantityTracked > 0) {
      throw new ShelfError({
        cause: null,
        message:
          "All selected assets are quantity-tracked. Quantity-tracked assets must have their placements managed individually with a per-location quantity.",
        additionalData: {
          userId,
          organizationId,
          skippedQuantityTracked,
        },
        label: "Assets",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    // Kit-guard applies only to INDIVIDUAL assets that survive the
    // qty-tracked filter above. INDIVIDUAL in a kit really IS a
    // conflict — the kit owns its location and the BEFORE trigger
    // caps an INDIVIDUAL at one AssetLocation row, so we can't
    // additively place it elsewhere via this bulk path.
    const assetsInKits = nonQtyTracked.filter(
      (asset) => asset.assetKits?.[0]?.kit
    );
    if (assetsInKits.length > 0) {
      const kitNames = Array.from(
        new Set(assetsInKits.map((asset) => asset.assetKits?.[0]?.kit?.name))
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

    // why: parity with the singular `updateAsset` path. When a location is
    // provided it MUST belong to the caller's org — hard-reject a foreign/
    // invalid id instead of silently coercing it to "remove location"
    // (which previously returned success while clearing the asset's location).
    // An empty/absent `newLocationId` is a legitimate "remove location" op.
    let newLocation: Awaited<ReturnType<typeof db.location.findFirst>> = null;
    if (newLocationId) {
      await assertLocationBelongsToOrg({
        locationId: newLocationId,
        organizationId,
      });
      newLocation = await db.location.findFirst({
        where: { id: newLocationId, organizationId },
      });
    }

    // Filter out assets already at the target location (qty-tracked
    // already filtered above; only INDIVIDUAL reach this point).
    const assetsToUpdate = nonQtyTracked.filter(
      (a) => getPrimaryLocation(a)?.id !== newLocation?.id
    );

    await db.$transaction(async (tx) => {
      if (assetsToUpdate.length > 0) {
        // Per-asset MANUAL pivot replace. Drop the asset's existing
        // manual rows (kit-driven rows survive — they're owned by the
        // kit's flow), then create the new one (skipped when
        // clearing). The DEFERRED sum-within-total trigger re-checks
        // at COMMIT. INDIVIDUAL-only at this point — qty-tracked were
        // filtered out above.
        await tx.assetLocation.deleteMany({
          where: {
            assetId: { in: assetsToUpdate.map((a) => a.id) },
            assetKitId: null,
          },
        });
        if (newLocation) {
          await tx.assetLocation.createMany({
            data: assetsToUpdate.map((asset) => ({
              assetId: asset.id,
              locationId: newLocation.id,
              organizationId,
              quantity:
                asset.type === AssetType.QUANTITY_TRACKED && asset.quantity
                  ? asset.quantity
                  : 1,
            })),
          });
        }

        /**
         * Creating notes for the assets.
         *
         * why: `assetsToUpdate` is derived from `nonQtyTracked` — this bulk
         * path filters out QUANTITY_TRACKED assets entirely (see the
         * `nonQtyTracked` filter above; they must manage placements per-row
         * with a quantity). So these notes/events are INDIVIDUAL-only and
         * intentionally carry no unit count.
         */
        await tx.note.createMany({
          data: assetsToUpdate.map((asset) => {
            const isRemoving = !newLocationId;

            const content = getLocationUpdateNoteContent({
              currentLocation: getPrimaryLocation(asset),
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
          }),
        });

        // Activity events — one ASSET_LOCATION_CHANGED per asset, inside the
        // tx. INDIVIDUAL-only (qty-tracked filtered out above), so no
        // `meta.quantity`.
        await recordEvents(
          assetsToUpdate.map((asset) => ({
            organizationId,
            actorUserId: userId,
            action: "ASSET_LOCATION_CHANGED",
            entityType: "ASSET",
            entityId: asset.id,
            assetId: asset.id,
            locationId: newLocation?.id ?? undefined,
            field: "locationId",
            fromValue: getPrimaryLocation(asset)?.id ?? null,
            toValue: newLocation?.id ?? null,
          })),
          tx
        );
      }
    });

    // Create location activity notes
    const userLink = wrapUserLinkForNote({
      id: userId,
      firstName: user?.firstName,
      lastName: user?.lastName,
    });
    // Filter out assets already at the target location
    const actuallyChanged = assets.filter(
      (a) => getPrimaryLocation(a)?.id !== newLocation?.id
    );
    const assetData = actuallyChanged.map((a) => ({
      id: a.id,
      title: a.title,
    }));

    // Group assets by their previous (primary) location
    const byPrevLocation = new Map<
      string,
      { name: string; assets: typeof assetData }
    >();
    for (const asset of actuallyChanged) {
      const prev = getPrimaryLocation(asset);
      if (!prev) continue;
      const existing = byPrevLocation.get(prev.id);
      if (existing) {
        existing.assets.push({ id: asset.id, title: asset.title });
      } else {
        byPrevLocation.set(prev.id, {
          name: prev.name,
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

    if (resolvedIds.length === 0) {
      return true;
    }

    // Fetch before-state so we can emit per-asset events and notes only for
    // assets whose category actually changes.
    const newCategoryId = categoryId || null;
    const assetsBeforeUpdate = await db.asset.findMany({
      where: {
        id: { in: resolvedIds },
        organizationId,
      },
      select: {
        id: true,
        category: { select: { id: true, name: true, color: true } },
      },
    });

    const assetsThatChange = assetsBeforeUpdate.filter(
      (asset) => (asset.category?.id ?? null) !== newCategoryId
    );

    if (assetsThatChange.length === 0) {
      return true;
    }

    // Fetch the new category once for note formatting AND to verify it
    // belongs to this organization. Without this check, a crafted
    // foreign-org `categoryId` would be written verbatim by `updateMany`.
    const newCategory = newCategoryId
      ? await db.category.findFirst({
          where: { id: newCategoryId, organizationId },
          select: { id: true, name: true, color: true },
        })
      : null;

    if (newCategoryId && !newCategory) {
      throw new ShelfError({
        cause: null,
        title: "Category not found",
        message:
          "The category you are trying to use does not exist or you do not have permission to access it.",
        additionalData: { categoryId: newCategoryId, organizationId, userId },
        label,
        status: 404,
        shouldBeCaptured: false,
      });
    }

    await db.$transaction(async (tx) => {
      await tx.asset.updateMany({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: assetsThatChange is derived from assetsBeforeUpdate fetched on lines 4322-4326 with where { id in resolvedIds, organizationId }; every id is already org-proven
        where: { id: { in: assetsThatChange.map((a) => a.id) } },
        data: { categoryId: newCategoryId },
      });

      // Activity events — one ASSET_CATEGORY_CHANGED per asset that changed.
      await recordEvents(
        assetsThatChange.map((asset) => ({
          organizationId,
          actorUserId: userId,
          action: "ASSET_CATEGORY_CHANGED" as const,
          entityType: "ASSET" as const,
          entityId: asset.id,
          assetId: asset.id,
          field: "categoryId",
          fromValue: asset.category?.id ?? null,
          toValue: newCategoryId,
        })),
        tx
      );
    });

    // Notes can be created outside the transaction (not critical for atomicity).
    // Mirrors the singular `updateAsset` flow.
    const loadUserForNotes = createLoadUserForNotes(userId);
    await Promise.all(
      assetsThatChange.map((asset) =>
        createAssetCategoryChangeNote({
          assetId: asset.id,
          userId,
          organizationId,
          previousCategory: asset.category,
          newCategory,
          loadUserForNotes,
        })
      )
    );

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

    // Validate that every tag id belongs to this organization before
    // wiring it into the `connect`/`disconnect` payload. Prisma's nested
    // `connect: { id }` operation has no org scoping on its own, so a
    // crafted foreign-org tag id would otherwise be attached/detached.
    if (tagsIds.length > 0) {
      const orgTags = await db.tag.findMany({
        where: { id: { in: tagsIds }, organizationId },
        select: { id: true },
      });
      if (orgTags.length !== new Set(tagsIds).size) {
        throw new ShelfError({
          cause: null,
          title: "Tag not found",
          message:
            "One or more selected tags do not exist or you do not have permission to access them.",
          additionalData: { tagsIds, organizationId, userId },
          label,
          status: 404,
          shouldBeCaptured: false,
        });
      }
    }

    const loadUserForNotes = createLoadUserForNotes(userId);

    const previousTagsByAssetId = await db.asset
      .findMany({
        where: {
          id: { in: resolvedIds },
          organizationId,
        },
        select: {
          id: true,
          tags: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      })
      .then((assets) =>
        assets.reduce<Map<string, TagSummary[]>>((acc, asset) => {
          acc.set(asset.id, asset.tags);
          return acc;
        }, new Map())
      );

    // Defense-in-depth: this issues one `asset.update` per selected asset
    // inside the interactive tx (needed to diff each asset's tag set), so a
    // large selection serially exhausts Prisma's 5s default and aborts with
    // P2028 (Sentry SHELF-WEBAPP-1MH). Bump the ceiling to 15s.
    const updatedAssets = await db.$transaction(
      async (tx) => {
        const results = await Promise.all(
          resolvedIds.map((id) =>
            tx.asset.update({
              where: { id, organizationId },
              data: {
                tags: {
                  [remove ? "disconnect" : "connect"]: tagsIds.map((tagId) => ({
                    id: tagId,
                  })),
                },
              },
              include: {
                tags: { select: { id: true, name: true } },
              },
            })
          )
        );

        // Activity events — one ASSET_TAGS_CHANGED per asset whose tag set
        // actually changed. Same shape as the singular `updateAsset` flow.
        const tagChangeEvents: Parameters<typeof recordEvents>[0] = [];
        for (const asset of results) {
          const previousTags = previousTagsByAssetId.get(asset.id) ?? [];
          const previousTagIds = new Set(previousTags.map((t) => t.id));
          const currentTagIds = new Set(asset.tags.map((t) => t.id));
          const setsDiffer =
            previousTagIds.size !== currentTagIds.size ||
            [...previousTagIds].some((t) => !currentTagIds.has(t));
          if (setsDiffer) {
            tagChangeEvents.push({
              organizationId,
              actorUserId: userId,
              action: "ASSET_TAGS_CHANGED",
              entityType: "ASSET",
              entityId: asset.id,
              assetId: asset.id,
              field: "tags",
              fromValue: [...previousTagIds],
              toValue: [...currentTagIds],
            });
          }
        }
        if (tagChangeEvents.length > 0) {
          await recordEvents(tagChangeEvents, tx);
        }

        return results;
      },
      { timeout: 15000 }
    );

    await Promise.all(
      updatedAssets.map((asset) =>
        createTagChangeNoteIfNeeded({
          assetId: asset.id,
          organizationId,
          userId,
          previousTags: previousTagsByAssetId.get(asset.id) ?? [],
          currentTags: asset.tags,
          loadUserForNotes,
        })
      )
    );

    // ASSET_TAGS_CHANGED events are emitted inside the $transaction above
    // (per the use-record-event rule — the tx-wrapped emission is the
    // authoritative one). Pre-merge HEAD had a second post-tx emission for
    // the same events; that was a duplicate left over from before PR
    // #2495 wrapped the tag updates in a transaction. Dropped here.
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
    await db.asset.updateMany({
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
  const [qr, user, asset] = await Promise.all([
    getQr({ id: qrId }),
    getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
      } satisfies Prisma.UserSelect,
    }),
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
      status: 403,
      shouldBeCaptured: false,
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

  const oldQrCode = asset?.qrCodes[0];

  await Promise.all([
    db.qr.update({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: lines 4646-4655 reject any qr whose organizationId differs from the caller's; an unclaimed qr (null org) is being claimed here, which is why this write sets organizationId
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
      organizationId,
      type: "UPDATE",
      content: `${wrapUserLinkForNote({
        id: userId,
        firstName: user.firstName,
        lastName: user.lastName,
      })} changed QR code ${
        oldQrCode ? `from **${oldQrCode.id}**` : ""
      } to **${qrId}**.`,
    }),
  ]);
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
  selectedAssetModelIds = [],
}: {
  organizationId: Organization["id"];
  allSelectedEntries: AllowedModelNames[];
  selectedTagIds: Array<Tag["id"]>;
  selectedCategoryIds: Array<Category["id"]>;
  selectedLocationIds: Array<Location["id"]>;
  selectedAssetModelIds?: string[];
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

    // Asset Models
    assetModelExcludedSelected,
    selectedAssetModels,
    totalAssetModels,
  ] = await Promise.all([
    /** Categories start */
    db.category.findMany({
      where: { organizationId, id: { notIn: selectedCategoryIds } },
      take: allSelectedEntries.includes("category") ? undefined : 12,
    }),
    selectedCategoryIds.length > 0
      ? db.category.findMany({
          where: { organizationId, id: { in: selectedCategoryIds } },
        })
      : Promise.resolve([]),
    db.category.count({ where: { organizationId } }),
    /** Categories end */

    /** Tags start */
    db.tag.findMany({
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
    selectedTagIds.length > 0
      ? db.tag.findMany({
          where: {
            organizationId,
            id: { in: selectedTagIds },
            OR: [
              { useFor: { isEmpty: true } },
              { useFor: { has: TagUseFor.ASSET } },
            ],
          },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    db.tag.count({
      where: {
        organizationId,
        OR: [
          { useFor: { isEmpty: true } },
          { useFor: { has: TagUseFor.ASSET } },
        ],
      },
    }),
    /** Tags end */

    /** Location start */
    db.location.findMany({
      where: { organizationId, id: { notIn: selectedLocationIds } },
      take: allSelectedEntries.includes("location") ? undefined : 12,
    }),
    selectedLocationIds.length > 0
      ? db.location.findMany({
          where: { organizationId, id: { in: selectedLocationIds } },
        })
      : Promise.resolve([]),
    db.location.count({ where: { organizationId } }),
    /** Location end */

    /** Asset Models start */
    db.assetModel.findMany({
      where: { organizationId, id: { notIn: selectedAssetModelIds } },
      take: allSelectedEntries.includes("assetModel") ? undefined : 12,
      orderBy: { updatedAt: "desc" },
    }),
    db.assetModel.findMany({
      where: { organizationId, id: { in: selectedAssetModelIds } },
    }),
    db.assetModel.count({ where: { organizationId } }),
    /** Asset Models end */
  ]);

  return {
    categories: [...selectedCategories, ...categoryExcludedSelected],
    totalCategories,
    tags: [...selectedTags, ...tagsExcludedSelected],
    totalTags,
    locations: [...selectedLocations, ...locationExcludedSelected],
    totalLocations,
    assetModels: [...selectedAssetModels, ...assetModelExcludedSelected],
    totalAssetModels,
  };
}

/**
 * Parses a raw valuation string from a form input into a finite number, or
 * null when the field was left blank. Throws a 400 ShelfError for any input
 * that cannot be coerced to a finite number.
 *
 * Used by the asset overview's inline-edit action so that browser-side
 * `type="text" inputMode="decimal"` inputs surface a clear server error
 * instead of a Prisma type error.
 *
 * @param raw - The raw string value from `formData.get("fieldValue")`
 * @returns A finite number, or null when the input is blank
 * @throws {ShelfError} 400 when the input is non-empty but not a finite number
 */
export function parseAssetValuation(raw: string | null): number | null {
  if (!raw || raw.trim() === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new ShelfError({
      cause: null,
      message: "Value must be a valid number",
      label: "Assets",
      shouldBeCaptured: false,
      status: 400,
    });
  }
  return parsed;
}

/**
 * Returns the active custom field definitions scoped to the given asset's
 * category. Throws a 404 ShelfError when the asset does not exist in the
 * given organization — this is the source of truth for the cross-org IDOR
 * guard used by the asset overview inline-edit action.
 *
 * @param params.id - Asset id
 * @param params.organizationId - Organization id (asset must belong to it)
 * @returns The array of active custom-field definitions for the asset's category
 * @throws {ShelfError} 404 when the asset is not found in the organization
 */
export async function getActiveCustomFieldsForAsset({
  id,
  organizationId,
}: {
  id: string;
  organizationId: string;
}) {
  const asset = await db.asset.findUnique({
    where: { id, organizationId },
    select: { categoryId: true },
  });

  if (!asset) {
    throw new ShelfError({
      cause: null,
      message: "Asset not found",
      label: "Assets",
      status: 404,
      shouldBeCaptured: false,
      additionalData: { id, organizationId },
    });
  }

  return getActiveCustomFields({
    organizationId,
    category: asset.categoryId,
  });
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
        db.location.findMany({
          where: { organizationId, id: { not: locationSelected } },
          take: getAllEntries.includes("location") ? undefined : 12,
        }),
        db.location.findMany({
          where: { organizationId, id: locationSelected },
        }),
        db.location.count({ where: { organizationId } }),
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

/* -------------------------------------------------------------------------- */
/*                       Quantity-Aware Custody Operations                     */
/* -------------------------------------------------------------------------- */

/** Arguments for checking out a quantity of a QUANTITY_TRACKED asset to a custodian. */
type CheckOutQuantityArgs = {
  /** The asset to check out from */
  assetId: string;
  /** The team member receiving custody */
  teamMemberId: string;
  /** Number of units to check out (must be positive integer) */
  quantity: number;
  /** The user performing the checkout */
  userId: string;
  /** The organization owning the asset (used for validation) */
  organizationId: string;
  /** Optional note explaining the checkout */
  note?: string;
};

/**
 * Checks out a quantity of units from a QUANTITY_TRACKED asset to a custodian.
 *
 * Runs inside an interactive transaction with a row-level lock to prevent
 * concurrent modifications. Validates that the asset is QUANTITY_TRACKED,
 * belongs to the given organization, and that enough units are available.
 *
 * Creates or increments a Custody record for the asset-teamMember pair
 * and logs an immutable CHECKOUT consumption log entry.
 *
 * @param args - The checkout details
 * @returns The updated Asset record
 * @throws {ShelfError} If the asset is not QUANTITY_TRACKED, does not belong
 *   to the organization, or there are insufficient available units
 */
export async function checkOutQuantity({
  assetId,
  teamMemberId,
  quantity,
  userId,
  organizationId,
  note,
}: CheckOutQuantityArgs) {
  try {
    if (quantity <= 0) {
      throw new ShelfError({
        cause: null,
        message: "Quantity must be greater than zero.",
        label,
        status: 400,
      });
    }

    return await db.$transaction(async (tx) => {
      /** Step 1: Acquire row-level lock to prevent concurrent modifications */
      const asset = await lockAssetForQuantityUpdate(tx, assetId);

      /** Step 2: Validate asset belongs to the organization */
      if (asset.organizationId !== organizationId) {
        throw new ShelfError({
          cause: null,
          message: "Asset does not belong to this organization.",
          label,
          status: 403,
          additionalData: { assetId, organizationId },
        });
      }

      /** Step 3: Validate the asset is quantity-tracked */
      if (asset.type !== "QUANTITY_TRACKED") {
        throw new ShelfError({
          cause: null,
          message:
            "Only quantity-tracked assets support quantity custody operations.",
          label,
          status: 400,
          additionalData: { assetId, assetType: asset.type },
        });
      }

      /**
       * Step 4: Compute available quantity within the transaction.
       *
       * `available = total − inCustody − checkedOutViaBooking`
       *
       * Units currently checked out via an ONGOING/OVERDUE booking are
       * semantically held by that booking's custodian (even if no
       * `Custody` row exists for them — qty-tracked bookings track the
       * commitment on the `BookingAsset` pivot, not via `Custody`). They
       * must be subtracted so we never double-allocate the same physical
       * unit to a direct custody assignment AND an active booking.
       *
       * Reservations (RESERVED bookings) are NOT subtracted — those
       * units are still physically present until their booking is
       * checked out, so they're valid targets for custody assignment
       * right now. The booking will re-validate availability at its own
       * checkout time.
       */
      const totalQuantity = asset.quantity ?? 0;
      const [custodySum, bookingCheckedOutSum] = await Promise.all([
        tx.custody.aggregate({
          where: { assetId },
          _sum: { quantity: true },
        }),
        tx.bookingAsset.aggregate({
          where: {
            assetId,
            booking: {
              status: { in: ["ONGOING", "OVERDUE"] },
            },
          },
          _sum: { quantity: true },
        }),
      ]);
      const inCustody = custodySum._sum.quantity ?? 0;
      const checkedOut = bookingCheckedOutSum._sum.quantity ?? 0;
      const available = totalQuantity - inCustody - checkedOut;

      /** Step 5: Validate sufficient availability */
      if (quantity > available) {
        throw new ShelfError({
          cause: null,
          message: `Cannot check out ${quantity} units. Only ${available} units are available (${inCustody} in custody, ${checkedOut} checked out on active bookings).`,
          label,
          status: 400,
          additionalData: {
            assetId,
            quantity,
            available,
            inCustody,
            checkedOut,
          },
        });
      }

      /**
       * Step 6: Upsert the OPERATOR-allocated custody row (kitCustodyId
       * IS NULL). Find-then-branch instead of `prisma.upsert` because
       * the composite (assetId, teamMemberId) uniqueness is now split
       * into two partial uniques (operator + kit-allocated) — Prisma's
       * `upsert` needs a single declared unique. The operator partial
       * still guarantees at most one matching row, so the find +
       * create/update sequence is safe inside this tx.
       */
      const existingOperatorCustody = await tx.custody.findFirst({
        where: { assetId, teamMemberId, kitCustodyId: null },
        select: { id: true },
      });
      if (existingOperatorCustody) {
        await tx.custody.update({
          where: { id: existingOperatorCustody.id },
          data: { quantity: { increment: quantity } },
        });
      } else {
        await tx.custody.create({
          data: { assetId, teamMemberId, quantity },
        });
      }

      /**
       * Step 6b: Flip `Asset.status` to `IN_CUSTODY`. Symmetric counterpart
       * to the conditional flip-to-`AVAILABLE` in `releaseQuantity` (Step
       * 6b there). Without this the row-level status drifts away from the
       * actual Custody table state — every kit-assign / picker filter /
       * UI badge that gates on `Asset.status === "AVAILABLE"` then sees
       * the asset as available even though it has units in custody, which
       * (e.g.) lets the kit-assign route bypass its
       * `someUnavailableAsset` guard. Always a write because the asset
       * status is no longer guaranteed to be `AVAILABLE` (could be a
       * second checkout into the same asset), but the value is constant
       * so it's a no-op in the already-`IN_CUSTODY` case.
       */
      await tx.asset.update({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `assetId` org-verified earlier via lockAssetForQuantityUpdate + the organizationId guard in this function
        where: { id: assetId },
        data: { status: AssetStatus.IN_CUSTODY },
      });

      /** Step 7: Create an immutable audit log entry */
      await createConsumptionLog({
        assetId,
        category: "CHECKOUT",
        quantity,
        userId,
        custodianId: teamMemberId,
        note,
        tx,
      });

      /**
       * Step 8: Activity event — emit `CUSTODY_ASSIGNED` inside the tx so
       * it commits atomically with the custody upsert. The `viaQuantity`
       * meta flag distinguishes qty-tracked custody slices from
       * INDIVIDUAL-asset custody assignments.
       */
      const custodianTeamMember = await tx.teamMember.findFirst({
        // org-scoped: teamMemberId is request input, so scope the lookup to
        // the caller's org (cross-org IDOR guard).
        where: { id: teamMemberId, organizationId },
        select: { user: { select: { id: true } } },
      });
      await recordEvent(
        {
          organizationId,
          actorUserId: userId,
          action: "CUSTODY_ASSIGNED",
          entityType: "ASSET",
          entityId: assetId,
          assetId,
          teamMemberId,
          targetUserId: custodianTeamMember?.user?.id ?? undefined,
          meta: { quantity, viaQuantity: true },
        },
        tx
      );

      /** Step 9: Return the refreshed asset */
      return tx.asset.findUniqueOrThrow({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `assetId` org-verified earlier via lockAssetForQuantityUpdate + the organizationId guard in this function
        where: { id: assetId },
      });
    });
  } catch (cause) {
    if (cause instanceof ShelfError) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      message:
        "Something went wrong while checking out quantity. Please try again or contact support.",
      additionalData: { assetId, teamMemberId, quantity, organizationId },
      label,
    });
  }
}

/** Arguments for releasing (returning) a quantity from a custodian back to the available pool. */
type ReleaseQuantityArgs = {
  /** The asset to release units for */
  assetId: string;
  /** The team member releasing custody */
  teamMemberId: string;
  /** Number of units to release (must be positive integer) */
  quantity: number;
  /** The user performing the release */
  userId: string;
  /** The organization owning the asset (used for validation) */
  organizationId: string;
  /** Optional note explaining the release */
  note?: string;
};

/**
 * Releases a quantity of units from a custodian back to the available pool.
 *
 * Runs inside an interactive transaction with a row-level lock to prevent
 * concurrent modifications. Validates that a custody record exists for the
 * asset-teamMember pair and that the release quantity does not exceed what
 * the custodian currently holds.
 *
 * If releasing the full custodied amount, the Custody record is deleted.
 * Otherwise, the quantity is decremented. An immutable RETURN consumption
 * log entry is always created.
 *
 * @param args - The release details
 * @returns The updated Asset record
 * @throws {ShelfError} If no custody record exists or the release quantity
 *   exceeds the custodied amount
 */
export async function releaseQuantity({
  assetId,
  teamMemberId,
  quantity,
  userId,
  organizationId,
  note,
}: ReleaseQuantityArgs) {
  try {
    if (quantity <= 0) {
      throw new ShelfError({
        cause: null,
        message: "Quantity must be greater than zero.",
        label,
        status: 400,
      });
    }

    return await db.$transaction(async (tx) => {
      /** Step 1: Acquire row-level lock to prevent concurrent modifications */
      const asset = await lockAssetForQuantityUpdate(tx, assetId);

      /** Step 2: Validate asset belongs to the organization */
      if (asset.organizationId !== organizationId) {
        throw new ShelfError({
          cause: null,
          message: "Asset does not belong to this organization.",
          label,
          status: 403,
          additionalData: { assetId, organizationId },
        });
      }

      /** Step 3: Validate the asset is quantity-tracked */
      if (asset.type !== "QUANTITY_TRACKED") {
        throw new ShelfError({
          cause: null,
          message:
            "Only quantity-tracked assets support quantity custody operations.",
          label,
          status: 400,
          additionalData: { assetId, assetType: asset.type },
        });
      }

      /**
       * Step 4: Find the OPERATOR-allocated custody row for this
       * (asset, teamMember) pair. `findFirst` filtered to
       * `kitCustodyId: null` because the composite (assetId, teamMemberId)
       * uniqueness was split into two partial uniques — a custodian can
       * legitimately hold both an operator-allocated row AND one-or-more
       * kit-allocated rows on the same asset, and only the operator row
       * is releasable from this endpoint. The kit-allocated rows are
       * released by releasing the kit's custody (which cascade-deletes
       * them via `KitCustody.id` → `Custody.kitCustodyId`).
       */
      const custody = await tx.custody.findFirst({
        where: { assetId, teamMemberId, kitCustodyId: null },
      });

      if (!custody) {
        throw new ShelfError({
          cause: null,
          message: "No custody record found for this team member and asset.",
          label,
          status: 404,
          additionalData: { assetId, teamMemberId },
        });
      }

      /** Step 5: Validate the release quantity does not exceed custodied amount */
      if (quantity > custody.quantity) {
        throw new ShelfError({
          cause: null,
          message: `Cannot release ${quantity} units. The custodian only holds ${custody.quantity} units.`,
          label,
          status: 400,
          additionalData: {
            assetId,
            teamMemberId,
            quantity,
            custodied: custody.quantity,
          },
        });
      }

      /**
       * Step 6: Delete the custody record if releasing full amount, else
       * decrement. Target by `Custody.id` (primary key) since the global
       * composite unique is gone — the row we already loaded via
       * `findFirst` above is the authoritative reference.
       */
      if (quantity === custody.quantity) {
        await tx.custody.delete({
          where: { id: custody.id },
        });
      } else {
        await tx.custody.update({
          where: { id: custody.id },
          data: { quantity: { decrement: quantity } },
        });
      }

      /**
       * Step 6b: If this release removed the last Custody row on the asset,
       * flip Asset.status back to AVAILABLE. Without this, the asset stays
       * stuck at IN_CUSTODY even after every unit has been returned —
       * matching the conditional-flip pattern used by the kit-custody
       * flows (`releaseCustody` / `bulkRemoveAssetsFromKits` /
       * `updateKitAssets` removal). We only flip when zero rows remain so
       * an asset that still has other operator or kit-allocated custody
       * keeps its IN_CUSTODY status.
       */
      const remainingCustodyCount = await tx.custody.count({
        where: { assetId },
      });
      if (remainingCustodyCount === 0) {
        await tx.asset.update({
          // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `assetId` org-verified earlier via lockAssetForQuantityUpdate + the organizationId guard in this function
          where: { id: assetId },
          data: { status: AssetStatus.AVAILABLE },
        });
      }

      /** Step 7: Create an immutable audit log entry */
      await createConsumptionLog({
        assetId,
        category: "RETURN",
        quantity,
        userId,
        custodianId: teamMemberId,
        note,
        tx,
      });

      /**
       * Step 8: Activity event — emit `CUSTODY_RELEASED` inside the tx so
       * it commits atomically with the custody decrement/delete. Mirrors
       * `checkOutQuantity` — the `viaQuantity` meta flag distinguishes
       * qty-tracked releases from INDIVIDUAL-asset custody releases.
       */
      const custodianTeamMember = await tx.teamMember.findFirst({
        // org-scoped: teamMemberId is request input, so scope the lookup to
        // the caller's org (cross-org IDOR guard).
        where: { id: teamMemberId, organizationId },
        select: { user: { select: { id: true } } },
      });
      await recordEvent(
        {
          organizationId,
          actorUserId: userId,
          action: "CUSTODY_RELEASED",
          entityType: "ASSET",
          entityId: assetId,
          assetId,
          teamMemberId,
          targetUserId: custodianTeamMember?.user?.id ?? undefined,
          meta: { quantity, viaQuantity: true },
        },
        tx
      );

      /** Step 9: Return the refreshed asset */
      return tx.asset.findUniqueOrThrow({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `assetId` org-verified earlier via lockAssetForQuantityUpdate + the organizationId guard in this function
        where: { id: assetId },
      });
    });
  } catch (cause) {
    if (cause instanceof ShelfError) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      message:
        "Something went wrong while releasing quantity. Please try again or contact support.",
      additionalData: { assetId, teamMemberId, quantity, organizationId },
      label,
    });
  }
}

/* -------------------------------------------------------------------------- */
/*                       Quantity-Aware Location Moves                         */
/* -------------------------------------------------------------------------- */

/**
 * Moves N units of a QUANTITY_TRACKED asset between two manual
 * `AssetLocation` pivot rows (rows where `assetKitId IS NULL`).
 *
 * Runs inside an interactive transaction with a row-level lock on the
 * asset (matching `checkOutQuantity` / `releaseQuantity`) so concurrent
 * placement edits can't race the source/destination quantities. Source
 * row is decremented (or deleted when fully drained); destination row is
 * upserted. Only the location axis is touched — kit, custody, and
 * booking pivots are intentionally untouched (orthogonal-axes design).
 *
 * Emits two paired `ASSET_LOCATION_CHANGED` activity events (one
 * `from`-side, one `to`-side) sharing a `moveCorrelationId` UUID so
 * reports can re-pair them. Writes a single asset-side "moved N units
 * from L1 to L2" note via `createLocationChangeNote`, plus two
 * location-timeline notes (one per location), mirroring the existing
 * single-location-update note pattern.
 *
 * @see modules/asset/move-units.types.ts for the contract
 *
 * @param args - Move arguments (see `MoveAssetLocationUnitsArgs`)
 * @returns The post-tx pivot quantities + correlation id
 * @throws {ShelfError} 400 if the asset is INDIVIDUAL, source/dest are
 *   the same, quantity is non-positive, the asset is not placed at the
 *   source location, or the move would over-draw the source row
 * @throws {ShelfError} 404 if either location is not in the org
 */
export async function moveAssetLocationUnits(
  args: MoveAssetLocationUnitsArgs
): Promise<MoveUnitsResult> {
  const {
    assetId,
    organizationId,
    userId,
    fromLocationId,
    toLocationId,
    quantity,
  } = args;

  try {
    /**
     * Reject obviously-invalid request shapes BEFORE opening a tx so we
     * don't waste a connection on input we'd reject anyway. The asset
     * existence / type / org / placement checks all need the tx (they
     * touch the locked row), so they live inside the `$transaction`.
     */
    if (quantity <= 0) {
      throw new ShelfError({
        cause: null,
        message: "Quantity must be a positive integer.",
        label,
        status: 400,
        additionalData: { assetId, quantity },
      });
    }

    if (fromLocationId === toLocationId) {
      throw new ShelfError({
        cause: null,
        message: "Source and destination must be different.",
        label,
        status: 400,
        additionalData: { assetId, fromLocationId, toLocationId },
      });
    }

    /** UUID pairing the two halves of the move (from-side + to-side). */
    const moveCorrelationId = crypto.randomUUID();

    const txResult = await db.$transaction(async (tx) => {
      /**
       * Step 1: Cross-org IDOR guard for the asset id. Belt-and-braces:
       * the row-level lock below ALSO surfaces the asset's
       * `organizationId`, but running the shared helper first matches
       * `.claude/rules/org-scope-user-supplied-ids.md` and gives a
       * uniform 400 message instead of the 403 thrown by the post-lock
       * org check.
       */
      await assertAssetsBelongToOrg(
        { assetIds: [assetId], organizationId },
        tx
      );

      /** Step 2: Lock the asset row so concurrent placement edits serialize. */
      const asset = await lockAssetForQuantityUpdate(tx, assetId);

      /**
       * Step 3: Defense-in-depth org check. The `assertAssetsBelongToOrg`
       * above already guards request input, but `lockAssetForQuantityUpdate`
       * does NOT scope by org — so we re-check the locked row's
       * `organizationId` to make absolutely sure we're not mutating
       * another tenant's data.
       */
      if (asset.organizationId !== organizationId) {
        throw new ShelfError({
          cause: null,
          message: "Asset does not belong to this organization.",
          label,
          status: 403,
          additionalData: { assetId, organizationId },
        });
      }

      /**
       * Step 4: Refuse INDIVIDUAL. Split/merge is a QUANTITY_TRACKED-only
       * concept — INDIVIDUAL assets live at exactly one location and
       * have no per-row `quantity` semantics.
       */
      if (asset.type !== AssetType.QUANTITY_TRACKED) {
        throw new ShelfError({
          cause: null,
          message: "Split/merge is only available for quantity-tracked assets.",
          label,
          status: 400,
          additionalData: { assetId, assetType: asset.type },
        });
      }

      /** Step 5: Org-scope the two location ids (request input). */
      await assertLocationBelongsToOrg(
        { locationId: fromLocationId, organizationId },
        tx
      );
      await assertLocationBelongsToOrg(
        { locationId: toLocationId, organizationId },
        tx
      );

      /**
       * Step 6: Load the manual source row (`assetKitId IS NULL`). Kit-
       * driven rows are moved by editing the kit's `locationId`, not
       * this endpoint — they're deliberately invisible to this query.
       */
      const source = await tx.assetLocation.findFirst({
        where: { assetId, locationId: fromLocationId, assetKitId: null },
        select: { id: true, quantity: true },
      });

      if (!source) {
        throw new ShelfError({
          cause: null,
          message: "Asset is not placed at the source location.",
          label,
          status: 400,
          additionalData: { assetId, fromLocationId },
        });
      }

      /**
       * Step 7: Refuse over-move. Use `formatUnitCount` so the error
       * surfaces the asset's `unitOfMeasure` ("Only 12 boxes available
       * at Storage A") rather than a bare integer.
       */
      if (quantity > source.quantity) {
        const sourceLocation = await tx.location.findFirst({
          where: { id: fromLocationId, organizationId },
          select: { name: true },
        });
        const available =
          formatUnitCount(asset, source.quantity) ?? `${source.quantity} units`;
        const sourceLocationName = sourceLocation?.name ?? "the source";
        throw new ShelfError({
          cause: null,
          message: `Only ${available} available at ${sourceLocationName}.`,
          label,
          status: 400,
          additionalData: {
            assetId,
            fromLocationId,
            requested: quantity,
            available: source.quantity,
          },
        });
      }

      /**
       * Step 8: Decrement (or delete) the source manual row. Deleting
       * at zero keeps the manual-placement reads clean — an empty
       * `AssetLocation` row would otherwise show up in placement lists
       * as "0 units here", which the existing UI doesn't expect.
       */
      const sourceRowDeleted = quantity === source.quantity;
      if (sourceRowDeleted) {
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: source.id came from the org+asset-scoped findFirst in step 6 above, inside this same tx
        await tx.assetLocation.delete({ where: { id: source.id } });
      } else {
        await tx.assetLocation.update({
          // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: source.id came from the org+asset-scoped findFirst in step 6 above, inside this same tx
          where: { id: source.id },
          data: { quantity: source.quantity - quantity },
        });
      }

      /**
       * Step 9: Upsert the manual destination row. Manual + kit-driven
       * rows can coexist at the same `(assetId, locationId)` (different
       * `assetKitId`s), so `findFirst` filtered to `assetKitId: null`
       * is the only way to surface the right one. The
       * `AssetLocation_manual_unique` partial unique guarantees at most
       * one match.
       */
      const existingDest = await tx.assetLocation.findFirst({
        where: { assetId, locationId: toLocationId, assetKitId: null },
        select: { id: true, quantity: true },
      });

      let destNewQuantity: number;
      if (existingDest) {
        destNewQuantity = existingDest.quantity + quantity;
        await tx.assetLocation.update({
          // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: existingDest.id came from the org+asset-scoped findFirst above, inside this same tx
          where: { id: existingDest.id },
          data: { quantity: destNewQuantity },
        });
      } else {
        destNewQuantity = quantity;
        await tx.assetLocation.create({
          data: {
            assetId,
            locationId: toLocationId,
            organizationId,
            quantity,
            // assetKitId left null → manual placement.
          },
        });
      }

      /**
       * Step 10: Emit two paired `ASSET_LOCATION_CHANGED` events
       * (one per side) sharing a `moveCorrelationId`. Reports re-pair
       * them via `meta.moveCorrelationId`; the `side` discriminator
       * makes the from/to direction explicit without a `fromValue`
       * lookup. Using `recordEvents` (plural) keeps both writes on one
       * DB round-trip inside the tx.
       */
      await recordEvents(
        [
          {
            organizationId,
            actorUserId: userId,
            action: "ASSET_LOCATION_CHANGED",
            entityType: "ASSET",
            entityId: assetId,
            assetId,
            locationId: fromLocationId,
            field: "locationId",
            fromValue: fromLocationId,
            toValue: null,
            meta: {
              quantity,
              moveCorrelationId,
              side: "from",
              locationId: fromLocationId,
            },
          },
          {
            organizationId,
            actorUserId: userId,
            action: "ASSET_LOCATION_CHANGED",
            entityType: "ASSET",
            entityId: assetId,
            assetId,
            locationId: toLocationId,
            field: "locationId",
            fromValue: null,
            toValue: toLocationId,
            meta: {
              quantity,
              moveCorrelationId,
              side: "to",
              locationId: toLocationId,
            },
          },
        ],
        tx
      );

      /** Returned to the caller so we can write notes outside the tx. */
      return {
        fromQuantity: sourceRowDeleted ? 0 : source.quantity - quantity,
        toQuantity: destNewQuantity,
        sourceRowDeleted,
        assetSnapshot: {
          type: asset.type,
          unitOfMeasure: asset.unitOfMeasure,
          title: asset.title,
        },
      };
    });

    /**
     * Step 11: Notes. Written OUTSIDE the tx — `createNote` /
     * `createLocationChangeNote` / `createSystemLocationNote` all use
     * the global `db` client; nesting them inside an interactive tx
     * wouldn't make them rollback-atomic anyway, and the existing
     * `updateAssetMainImage` / placement-editor flows already use the
     * "tx commits placement, then notes" sequence. A note write
     * failure does NOT roll back the placement move — same trade-off
     * as the existing flows.
     *
     * Three notes mirror the existing single-location-update pattern:
     *   1. One asset-side note via `createLocationChangeNote` with
     *      BOTH `currentLocation` and `newLocation` set, which renders
     *      "{user} moved 50 units from L1 to L2." via
     *      `getLocationUpdateNoteContent`.
     *   2. A "removed N units from L1. Moved to L2." note on L1's
     *      timeline.
     *   3. An "added N units to L2. Moved from L1." note on L2's
     *      timeline.
     */
    const [user, fromLocation, toLocation] = await Promise.all([
      getUserByID(userId, {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        } satisfies Prisma.UserSelect,
      }),
      db.location.findFirst({
        where: { id: fromLocationId, organizationId },
        select: { id: true, name: true },
      }),
      db.location.findFirst({
        where: { id: toLocationId, organizationId },
        select: { id: true, name: true },
      }),
    ]);

    if (user && fromLocation && toLocation) {
      const firstName = user.firstName ?? "";
      const lastName = user.lastName ?? "";

      // Asset-side bidirectional note. The helper recognises the
      // "current + new both set" shape and emits the "moved …" phrasing.
      await createLocationChangeNote({
        currentLocation: fromLocation,
        newLocation: toLocation,
        firstName,
        lastName,
        assetId,
        userId,
        isRemoving: false,
        organizationId,
        type: txResult.assetSnapshot.type,
        unitOfMeasure: txResult.assetSnapshot.unitOfMeasure,
        quantity,
      });

      // Per-location timeline notes (one each side) — same shape as
      // the single-location update path at ~line 2596.
      const userLink = wrapUserLinkForNote({
        id: userId,
        firstName,
        lastName,
      });
      const assetForCount = {
        id: assetId,
        title: txResult.assetSnapshot.title,
        type: txResult.assetSnapshot.type,
        unitOfMeasure: txResult.assetSnapshot.unitOfMeasure,
      };
      const assetMarkup = wrapAssetWithCountForNote(assetForCount, quantity);
      const fromLink = wrapLinkForNote(
        `/locations/${fromLocation.id}`,
        fromLocation.name
      );
      const toLink = wrapLinkForNote(
        `/locations/${toLocation.id}`,
        toLocation.name
      );

      await Promise.all([
        createSystemLocationNote({
          locationId: fromLocation.id,
          content: `${userLink} removed ${assetMarkup} from ${fromLink}. Moved to ${toLink}.`,
          userId,
        }),
        createSystemLocationNote({
          locationId: toLocation.id,
          content: `${userLink} added ${assetMarkup} to ${toLink}. Moved from ${fromLink}.`,
          userId,
        }),
      ]);
    }

    return {
      fromQuantity: txResult.fromQuantity,
      toQuantity: txResult.toQuantity,
      sourceRowDeleted: txResult.sourceRowDeleted,
      moveCorrelationId,
    };
  } catch (cause) {
    if (isLikeShelfError(cause)) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      message:
        "Something went wrong while moving asset units between locations. Please try again or contact support.",
      additionalData: {
        assetId,
        organizationId,
        userId,
        fromLocationId,
        toLocationId,
        quantity,
      },
      label,
    });
  }
}

/**
 * Places N unplaced units of a QUANTITY_TRACKED asset at a destination
 * location. One-sided variant of `moveAssetLocationUnits` — there is no
 * source row to decrement; this just fills the gap between
 * `Asset.quantity` and `sum(AssetLocation.quantity WHERE assetKitId IS NULL)`.
 *
 * Reuses the same lock + org-guard + INDIVIDUAL-refusal stack. Emits one
 * `ASSET_LOCATION_CHANGED` event (to-side only) with a
 * `meta.moveCorrelationId` so reports can still pair it conceptually with
 * future moves out of the same destination. Writes one asset-side
 * "placed N units at L" note + one location-timeline "added N units"
 * note, matching the Phase 4e wording fix at
 * `getLocationUpdateNoteContent`.
 *
 * @see modules/asset/move-units.types.ts for the contract
 *
 * @param args - Arguments (see `PlaceUnplacedUnitsArgs`)
 * @returns Post-tx destination quantity + correlation id
 * @throws {ShelfError} 400 if the asset is INDIVIDUAL, quantity is
 *   non-positive, or `quantity` exceeds the asset's unplaced pool
 * @throws {ShelfError} 403 if the asset belongs to another org
 * @throws {ShelfError} 404 if the destination location is not in the org
 */
export async function placeUnplacedUnits(
  args: PlaceUnplacedUnitsArgs
): Promise<PlaceUnplacedUnitsResult> {
  const { assetId, organizationId, userId, toLocationId, quantity } = args;

  try {
    if (quantity <= 0) {
      throw new ShelfError({
        cause: null,
        message: "Quantity must be a positive integer.",
        label,
        status: 400,
        additionalData: { assetId, quantity },
      });
    }

    const moveCorrelationId = crypto.randomUUID();

    const txResult = await db.$transaction(async (tx) => {
      await assertAssetsBelongToOrg(
        { assetIds: [assetId], organizationId },
        tx
      );

      const asset = await lockAssetForQuantityUpdate(tx, assetId);

      if (asset.organizationId !== organizationId) {
        throw new ShelfError({
          cause: null,
          message: "Asset does not belong to this organization.",
          label,
          status: 403,
          additionalData: { assetId, organizationId },
        });
      }

      if (asset.type !== AssetType.QUANTITY_TRACKED) {
        throw new ShelfError({
          cause: null,
          message:
            "Placing unplaced units is only available for quantity-tracked assets.",
          label,
          status: 400,
          additionalData: { assetId, assetType: asset.type },
        });
      }

      await assertLocationBelongsToOrg(
        { locationId: toLocationId, organizationId },
        tx
      );

      /**
       * Compute the current unplaced pool from manual rows only. Kit-
       * driven rows (`assetKitId IS NOT NULL`) live on the orthogonal
       * AssetKit axis and don't count toward the location-axis sum (per
       * the trigger realignment in migration
       * `20260602100000_assetlocation_sum_exclude_kit_driven`).
       */
      const manualPlacements = await tx.assetLocation.aggregate({
        where: { assetId, assetKitId: null },
        _sum: { quantity: true },
      });
      const placed = manualPlacements._sum.quantity ?? 0;
      /**
       * `Asset.quantity` is nullable in the schema (legacy from before
       * QUANTITY_TRACKED was an explicit type). For a QUANTITY_TRACKED
       * asset it should always be set — but if it isn't, `null - placed`
       * silently evaluates to `NaN`, which would let the `quantity > unplaced`
       * check below pass and write the row. Coerce to 0 explicitly so a
       * misconfigured asset rejects the request with a clear 400 instead.
       */
      const totalQuantity = asset.quantity ?? 0;
      const unplaced = totalQuantity - placed;

      if (quantity > unplaced) {
        const available =
          formatUnitCount(asset, unplaced) ?? `${unplaced} units`;
        throw new ShelfError({
          cause: null,
          message: `Only ${available} unplaced.`,
          label,
          status: 400,
          additionalData: {
            assetId,
            requested: quantity,
            available: unplaced,
          },
        });
      }

      /**
       * Upsert the manual destination row, scoped by the
       * `assetKitId IS NULL` partial-unique. A kit-driven row may coexist
       * at the same `(assetId, locationId)` — we must not collide with it.
       */
      const existingDest = await tx.assetLocation.findFirst({
        where: { assetId, locationId: toLocationId, assetKitId: null },
        select: { id: true, quantity: true },
      });

      let destNewQuantity: number;
      if (existingDest) {
        destNewQuantity = existingDest.quantity + quantity;
        await tx.assetLocation.update({
          // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: existingDest.id came from the org+asset-scoped findFirst above, inside this same tx
          where: { id: existingDest.id },
          data: { quantity: destNewQuantity },
        });
      } else {
        destNewQuantity = quantity;
        await tx.assetLocation.create({
          data: {
            assetId,
            locationId: toLocationId,
            organizationId,
            quantity,
            // assetKitId left null → manual placement.
          },
        });
      }

      /**
       * One `ASSET_LOCATION_CHANGED` event for the to-side. We still
       * stamp `meta.moveCorrelationId` so the activity feed can render
       * this as a deliberate placement; `placeUnplaced: true` lets
       * reports distinguish the one-sided variant from a paired move.
       */
      await recordEvents(
        [
          {
            organizationId,
            actorUserId: userId,
            action: "ASSET_LOCATION_CHANGED",
            entityType: "ASSET",
            entityId: assetId,
            assetId,
            locationId: toLocationId,
            field: "locationId",
            fromValue: null,
            toValue: toLocationId,
            meta: {
              quantity,
              moveCorrelationId,
              side: "to",
              locationId: toLocationId,
              placeUnplaced: true,
            },
          },
        ],
        tx
      );

      return {
        toQuantity: destNewQuantity,
        assetSnapshot: {
          type: asset.type,
          unitOfMeasure: asset.unitOfMeasure,
          title: asset.title,
        },
      };
    });

    const [user, toLocation] = await Promise.all([
      getUserByID(userId, {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        } satisfies Prisma.UserSelect,
      }),
      db.location.findFirst({
        where: { id: toLocationId, organizationId },
        select: { id: true, name: true },
      }),
    ]);

    if (user && toLocation) {
      const firstName = user.firstName ?? "";
      const lastName = user.lastName ?? "";

      await createLocationChangeNote({
        currentLocation: null,
        newLocation: toLocation,
        firstName,
        lastName,
        assetId,
        userId,
        isRemoving: false,
        organizationId,
        type: txResult.assetSnapshot.type,
        unitOfMeasure: txResult.assetSnapshot.unitOfMeasure,
        quantity,
      });

      const userLink = wrapUserLinkForNote({
        id: userId,
        firstName,
        lastName,
      });
      const assetForCount = {
        id: assetId,
        title: txResult.assetSnapshot.title,
        type: txResult.assetSnapshot.type,
        unitOfMeasure: txResult.assetSnapshot.unitOfMeasure,
      };
      const assetMarkup = wrapAssetWithCountForNote(assetForCount, quantity);
      const toLink = wrapLinkForNote(
        `/locations/${toLocation.id}`,
        toLocation.name
      );

      await createSystemLocationNote({
        locationId: toLocation.id,
        content: `${userLink} placed ${assetMarkup} at ${toLink}.`,
        userId,
      });
    }

    return {
      toQuantity: txResult.toQuantity,
      moveCorrelationId,
    };
  } catch (cause) {
    if (isLikeShelfError(cause)) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      message:
        "Something went wrong while placing unplaced asset units. Please try again or contact support.",
      additionalData: {
        assetId,
        organizationId,
        userId,
        toLocationId,
        quantity,
      },
      label,
    });
  }
}
