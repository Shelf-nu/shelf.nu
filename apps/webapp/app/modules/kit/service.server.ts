import type {
  Asset,
  AssetIndexSettings,
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
  AssetType,
  BookingStatus,
  ErrorCorrection,
  KitStatus,
  NoteType,
} from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
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
import type { MergeInclude } from "~/utils/utils";
import type { UpdateKitPayload } from "./types";
import {
  GET_KIT_STATIC_INCLUDES,
  KIT_SELECT_FIELDS_FOR_LIST_ITEMS,
  KITS_INCLUDE_FIELDS,
} from "./types";
import { getKitsWhereInput } from "./utils.server";
import { recordEvent, recordEvents } from "../activity-event/service.server";
import { resolveAssetIdsForBulkOperation } from "../asset/bulk-operations-helper.server";
import type { CreateAssetFromContentImportPayload } from "../asset/types";
import {
  getAssetsWhereInput,
  getKitLocationUpdateNoteContent,
} from "../asset/utils.server";
import { getPrimaryCustody, hasCustody } from "../custody/utils";
import { createSystemLocationNote } from "../location-note/service.server";
import {
  createBulkKitChangeNotes,
  createNote,
  createNotes,
} from "../note/service.server";
import { getQr } from "../qr/service.server";
import { getUserByID } from "../user/service.server";

const label: ErrorLabel = "Kit";

/**
 * Build per-asset Custody rows that inherit a KitCustody assignment.
 *
 * When a kit is in custody, every asset in the kit gets a child Custody row
 * tagged with `kitCustodyId` so the row's origin is traceable. The rule for
 * `quantity`:
 * - INDIVIDUAL assets always inherit `quantity: 1`.
 * - QUANTITY_TRACKED assets inherit only the **remaining** pool — the asset's
 *   total `quantity` minus any already-allocated Custody rows (operator
 *   custody and pre-existing kit-allocated custody are both subtracted; the
 *   helper does not distinguish — what matters is "how many units are not
 *   already spoken for"). When remaining <= 0 the asset is silently skipped
 *   (no child row created), so the kit-custody flow degrades gracefully when
 *   an asset is fully allocated to operators.
 *
 * Tagging the child rows with `kitCustodyId` is what allows us to delete only
 * kit-allocated custody (filter by `kitCustodyId`) without disturbing
 * operator-assigned per-unit custody on the same asset, and lets the FK
 * cascade clean them up automatically when the parent KitCustody is deleted.
 *
 * @param args.tx - Transactional Prisma client (so the existing-custody read
 *   sees rows written earlier in the same tx).
 * @param args.kitCustodyId - The parent KitCustody row this inheritance points back to.
 * @param args.teamMemberId - The custodian team member, copied to every child row.
 * @param args.assetIds - Assets in the kit that should receive inherited custody.
 * @returns A flat array suitable for `tx.custody.createMany({ data })`. Empty
 *   when every asset is fully operator-allocated.
 */
/**
 * Structural type for the only Prisma surface we need from the tx. Typed this
 * way (rather than `Prisma.TransactionClient`) because the project uses an
 * extended Prisma client, and the extended tx is not directly assignable to
 * the generated `Prisma.TransactionClient`. Mirrors the `RecordEventTxClient`
 * pattern used in `activity-event/service.server.ts`.
 */
type KitCustodyInheritTxClient = {
  asset: {
    findMany: (args: {
      where: { id: { in: string[] } };
      select: {
        id: true;
        type: true;
        quantity: true;
        custody: { select: { quantity: true } };
      };
    }) => Promise<
      Array<{
        id: string;
        type: AssetType;
        quantity: number | null;
        custody: Array<{ quantity: number }>;
      }>
    >;
  };
};

export async function buildKitCustodyInheritData({
  tx,
  kitCustodyId,
  teamMemberId,
  assetIds,
}: {
  tx: KitCustodyInheritTxClient;
  kitCustodyId: string;
  teamMemberId: string;
  assetIds: string[];
}): Promise<Prisma.CustodyCreateManyInput[]> {
  if (assetIds.length === 0) return [];

  const assets = await tx.asset.findMany({
    where: { id: { in: assetIds } },
    select: {
      id: true,
      type: true,
      quantity: true,
      custody: { select: { quantity: true } },
    },
  });

  const rows: Prisma.CustodyCreateManyInput[] = [];
  for (const asset of assets) {
    if (asset.type !== AssetType.QUANTITY_TRACKED) {
      rows.push({
        teamMemberId,
        assetId: asset.id,
        kitCustodyId,
        quantity: 1,
      });
      continue;
    }
    // why: subtract every existing Custody row's quantity (operator AND
    // pre-existing kit-allocated) so we never over-allocate the asset's
    // tracked pool. Pleb already holds 4 of 80 → kit row claims 76, not 80.
    const allocated = asset.custody.reduce(
      (sum, row) => sum + (row.quantity ?? 0),
      0
    );
    const remaining = (asset.quantity ?? 0) - allocated;
    if (remaining <= 0) continue;
    rows.push({
      teamMemberId,
      assetId: asset.id,
      kitCustodyId,
      quantity: remaining,
    });
  }
  return rows;
}

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

    const data: Prisma.KitCreateInput = {
      name,
      description,
      createdBy: user,
      organization,
      qrCodes,
      category: categoryId ? { connect: { id: categoryId } } : undefined,
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

    if (locationId) {
      data.location = { connect: { id: locationId } };
    }

    // Use transaction to ensure kit creation and activity event are atomic
    const kit = await db.$transaction(async (tx) => {
      const created = await tx.kit.create({ data });

      // Activity event must be inside transaction for atomicity
      await recordEvent(
        {
          organizationId,
          actorUserId: createdById,
          action: "KIT_CREATED",
          entityType: "KIT",
          entityId: created.id,
          kitId: created.id,
        },
        tx
      );

      return created;
    });

    return kit;
  } catch (cause) {
    // If it's a Prisma unique constraint violation on barcode values,
    // use our detailed validation to provide specific field errors
    if (cause instanceof Error && "code" in cause && cause.code === "P2002") {
      const prismaError = cause as any;
      const target = prismaError.meta?.target;

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
    const data: Prisma.KitUpdateInput = {
      name,
      description,
      image,
      imageExpiration,
      status,
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

    if (locationId) {
      data.location = { connect: { id: locationId } };
    }

    const kit = await db.kit.update({
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

    await recordEvent({
      organizationId,
      actorUserId: createdById,
      action: "KIT_UPDATED",
      entityType: "KIT",
      entityId: kit.id,
      kitId: kit.id,
    });

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
  // include. Treat either `assets` (legacy callers passing typed shapes
  // that may still reference the old relation) or `assetKits` as the
  // signal that the caller wants the asset list available for the
  // hide-empty filter below.
  function hasAssetsIncluded(
    extraInclude?: Prisma.KitInclude
  ): extraInclude is Prisma.KitInclude & { assetKits: boolean } {
    return !!extraInclude?.assetKits;
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
      const searchTerm = search.toLowerCase().trim();
      where.OR = [
        // Search in kit name
        { name: { contains: searchTerm, mode: "insensitive" } },
        // Search in barcode values
        {
          barcodes: {
            some: { value: { contains: searchTerm, mode: "insensitive" } },
          },
        },
      ];
    }

    if (status) {
      where.status = status;
    }

    if (teamMember) {
      Object.assign(where, {
        custody: { custodianId: teamMember },
      });
    }

    if (currentBookingId && hideUnavailable) {
      // "every asset in this kit matches X" predicate becomes
      // "every AssetKit row's asset matches X".
      where.assetKits = {
        every: {
          asset: {
            organizationId,
            custody: { none: {} },
          },
        },
      };

      if (bookingFrom && bookingTo) {
        // Apply booking conflict logic similar to assets, but through kit assets
        const kitWhere: Prisma.KitWhereInput[] = [
          // Rule 1: RESERVED bookings always exclude kits (if any asset is in a RESERVED booking)
          {
            assetKits: {
              none: {
                asset: {
                  bookingAssets: {
                    some: {
                      booking: {
                        id: { not: currentBookingId },
                        status: BookingStatus.RESERVED,
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
                },
              },
            },
          },
          // Rule 2: For ONGOING/OVERDUE bookings, allow kits that are AVAILABLE or have no conflicting assets
          {
            OR: [
              // Either kit is AVAILABLE (checked in from partial check-in)
              { status: KitStatus.AVAILABLE },
              // Or kit has no assets in conflicting ONGOING/OVERDUE bookings
              {
                assetKits: {
                  none: {
                    asset: {
                      bookingAssets: {
                        some: {
                          booking: {
                            id: { not: currentBookingId },
                            status: {
                              in: [
                                BookingStatus.ONGOING,
                                BookingStatus.OVERDUE,
                              ],
                            },
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
                    },
                  },
                },
              },
            ],
          },
        ];

        // Combine the basic filters with booking conflict filters
        where.AND = kitWhere;
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
      // rows.
      db.kit.count({
        where: { organizationId, assetKits: { none: {} } },
      }),
    ]);

    if (hideUnavailable && hasAssetsIncluded(extraInclude)) {
      kits = kits.filter((kit) => {
        // extraInclude is dynamic, so the kit shape is widened here.
        // Cast to a minimal pivot shape rather than disabling type
        // checks file-wide.
        const ak = (kit as { assetKits?: unknown[] }).assetKits;
        return Array.isArray(ak) && ak.length > 0;
      });
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

// why: `const T` (TS 5.0+) preserves the literal type of the inline
// `extraInclude` passed at the call site. Without it, T widens to
// `Prisma.KitInclude` and consumers lose the deep shape (e.g.
// `kit.assetKits[0].asset.status`), forcing `as unknown as {…}` casts.
export async function getKit<const T extends Prisma.KitInclude | undefined>({
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

    // `AssetKit` pivot. Filter through the pivot instead.
    const where: Prisma.AssetWhereInput = {
      organizationId,
      assetKits: { some: { kitId } },
    };

    if (search && !ignoreFilters) {
      const searchTerm = search.toLowerCase().trim();
      where.OR = [
        // Search in asset title
        { title: { contains: searchTerm, mode: "insensitive" } },
        // Search in asset barcodes
        {
          barcodes: {
            some: { value: { contains: searchTerm, mode: "insensitive" } },
          },
        },
      ];
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

/**
 * Pre-fetched kit shape consumed by `performKitDeletion`. Kept loose
 * (just the fields the helper actually reads) so both single + bulk
 * call sites can share the same pipeline.
 */
type KitForDeletion = {
  id: Kit["id"];
  name: Kit["name"];
  image: Kit["image"];
  assets: Array<{ id: string; title: string }>;
  custody: {
    id: string;
    custodian: {
      id: string;
      name: string;
      user: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        displayName: string | null;
      } | null;
    };
  } | null;
};

/**
 * Shared deletion pipeline for `deleteKit` + `bulkDeleteKits`.
 *
 * Whether you're deleting one kit or many, the steps are identical:
 *   1. Pre-read inherited Custody rows (so we can emit
 *      `CUSTODY_RELEASED` events before the FK cascade wipes them).
 *   2. Inside a transaction:
 *      a. Emit one `CUSTODY_RELEASED` event per inherited row, tagged
 *         with the source kit + custodian for audit.
 *      b. Delete the kits — FK cascades clean up
 *         `Kit → KitCustody → Custody` and `Asset.kitId` is set null.
 *      c. Conditional status flip: only assets with **zero** remaining
 *         Custody rows after the cascade drop to `AVAILABLE`. Assets
 *         with surviving operator custody (Phase 2 multi-custodian)
 *         keep `IN_CUSTODY` so we don't lie about state.
 *   3. Outside the tx (best-effort, audit-only):
 *      a. Write asset notes — one `createNotes` call per in-custody
 *        kit so each group gets its kit's correct custodian.
 *      b. Delete kit images.
 *
 * @param args.kits - Pre-fetched kits with the shape above. Caller is
 *   responsible for org-scoping the read.
 * @param args.organizationId - Used for status-flip scoping + event meta.
 * @param args.userId - Actor for events + note attribution.
 */
async function performKitDeletion({
  kits,
  organizationId,
  userId,
}: {
  kits: KitForDeletion[];
  organizationId: Kit["organizationId"];
  userId: string;
}) {
  if (kits.length === 0) return;

  const kitIdsToDelete = kits.map((k) => k.id);
  const inCustodyKits = kits.filter((k) => !!k.custody);
  const allAssetIds = kits.flatMap((k) => k.assets.map((a) => a.id));

  // Resolve the actor once for note text — only needed when at least
  // one kit was in custody (an AVAILABLE kit emits nothing).
  let actorLink = "";
  if (inCustodyKits.length > 0) {
    const actor = await getUserByID(userId, {
      select: {
        firstName: true,
        lastName: true,
        displayName: true,
      } satisfies Prisma.UserSelect,
    });
    actorLink = wrapUserLinkForNote({
      id: userId,
      firstName: actor?.firstName,
      lastName: actor?.lastName,
    });
  }

  await db.$transaction(async (tx) => {
    const kitCustodyIds = inCustodyKits
      .map((k) => k.custody?.id)
      .filter((id): id is string => Boolean(id));

    if (kitCustodyIds.length > 0) {
      const inheritedCustodyRows = await tx.custody.findMany({
        where: { kitCustodyId: { in: kitCustodyIds } },
        select: {
          assetId: true,
          teamMemberId: true,
          kitCustodyId: true,
        },
      });

      if (inheritedCustodyRows.length > 0) {
        // Map each row's source kit so events carry the correct
        // `kitId` + `targetUserId`.
        const kitByKitCustodyId = new Map(
          inCustodyKits.map((k) => [k.custody!.id, k])
        );

        await recordEvents(
          inheritedCustodyRows.map((row) => {
            const sourceKit = kitByKitCustodyId.get(row.kitCustodyId!);
            return {
              organizationId,
              actorUserId: userId,
              action: "CUSTODY_RELEASED" as const,
              entityType: "ASSET" as const,
              entityId: row.assetId,
              assetId: row.assetId,
              kitId: sourceKit?.id,
              teamMemberId: row.teamMemberId,
              targetUserId:
                sourceKit?.custody?.custodian?.user?.id ?? undefined,
              meta: { viaKit: true, viaKitDelete: true },
            };
          }),
          tx
        );
      }
    }

    await tx.kit.deleteMany({
      where: { id: { in: kitIdsToDelete }, organizationId },
    });

    if (allAssetIds.length > 0) {
      const assetsWithRemainingCustody = await tx.custody.findMany({
        where: { assetId: { in: allAssetIds } },
        select: { assetId: true },
      });
      const stillCustodiedAssetIds = new Set(
        assetsWithRemainingCustody.map((c) => c.assetId)
      );
      const assetsToFlipAvailable = allAssetIds.filter(
        (assetId) => !stillCustodiedAssetIds.has(assetId)
      );
      if (assetsToFlipAvailable.length > 0) {
        await tx.asset.updateMany({
          where: { id: { in: assetsToFlipAvailable }, organizationId },
          data: { status: AssetStatus.AVAILABLE },
        });
      }
    }
  });

  if (inCustodyKits.length > 0) {
    await Promise.all(
      inCustodyKits
        .filter((k) => k.assets.length > 0)
        .map((k) => {
          const custodianDisplay = k.custody?.custodian
            ? wrapCustodianForNote({ teamMember: k.custody.custodian })
            : "**Unknown Custodian**";
          return createNotes({
            content: `${actorLink} released ${custodianDisplay}'s custody when kit **${k.name.trim()}** was deleted.`,
            type: "UPDATE",
            userId,
            assetIds: k.assets.map((a) => a.id),
          });
        })
    );
  }

  const kitWithImages = kits.filter((k) => !!k.image);
  await Promise.all(
    kitWithImages.map((k) => deleteKitImage({ url: k.image! }))
  );
}

export async function deleteKit({
  id,
  organizationId,
  userId,
}: {
  id: Kit["id"];
  organizationId: Kit["organizationId"];
  /**
   * Required for the activity-events + notes that fire when a
   * **kit-in-custody** is deleted. Treated as the actor of the
   * implicit `CUSTODY_RELEASED` for each affected asset.
   */
  userId: string;
}) {
  try {
    const kitRow = await db.kit.findUniqueOrThrow({
      where: { id, organizationId },
      select: {
        id: true,
        name: true,
        image: true,
        assetKits: {
          select: { asset: { select: { id: true, title: true } } },
        },
        custody: {
          select: {
            id: true,
            custodian: {
              select: {
                id: true,
                name: true,
                // why: wrapCustodianForNote / wrapUserLinkForNote use the
                // first/last/displayName to render the linked-text in the
                // resulting note; without them the fallback reads
                // "Unknown User".
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    displayName: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Flatten pivot rows into the in-memory `assets` shape that
    // `performKitDeletion` consumes.
    const kit = {
      ...kitRow,
      assets: (kitRow.assetKits ?? []).map((ak) => ak.asset),
    };

    await performKitDeletion({
      kits: [kit],
      organizationId,
      userId,
    });

    return kit;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while deleting kit",
      additionalData: { id, organizationId, userId },
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
    const [kitRow, actor] = await Promise.all([
      db.kit.findUniqueOrThrow({
        where: { id: kitId, organizationId },
        select: {
          id: true,
          name: true,
          assetKits: {
            select: { asset: { select: { id: true, title: true } } },
          },
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
          custody: {
            select: {
              id: true,
              custodian: { include: { user: true } },
            },
          },
        },
      }),
      getUserByID(userId, {
        select: {
          firstName: true,
          lastName: true,
          displayName: true,
        } satisfies Prisma.UserSelect,
      }),
    ]);

    // Flatten pivot rows so downstream code reads the same shape it
    // did pre-pivot. Optional chaining tolerates fixtures / payloads
    // that omit the pivot relation entirely.
    const kit = {
      ...kitRow,
      assets: (kitRow.assetKits ?? []).map((ak) => ak.asset),
    };

    const actorLink = wrapUserLinkForNote({
      id: userId,
      firstName: actor?.firstName,
      lastName: actor?.lastName,
    });
    const custodianDisplay = kit.custody?.custodian
      ? wrapCustodianForNote({ teamMember: kit.custody.custodian })
      : "**Unknown Custodian**";
    const kitLink = wrapLinkForNote(`/kits/${kit.id}`, kit.name.trim());

    // Use transaction for atomicity - prevents orphaned custody records on partial failure
    // Activity events must be inside to ensure audit trail consistency
    await db.$transaction(async (tx) => {
      // Capture the kit-allocated Custody rows BEFORE the cascade so we can
      // emit `CUSTODY_RELEASED` events for them. Filtering by `kitCustodyId`
      // means operator-assigned custody on the same assets is left untouched
      // when the FK cascade fires.
      const kitCustodyId = kit.custody?.id;
      const inheritedCustodyRows = kitCustodyId
        ? await tx.custody.findMany({
            where: { kitCustodyId },
            select: {
              assetId: true,
              teamMemberId: true,
              kitCustodyId: true,
            },
          })
        : [];

      // Activity events emitted FIRST — recordEvents runs inside the tx so
      // they roll back atomically if the kit-update below fails.
      if (inheritedCustodyRows.length > 0) {
        await recordEvents(
          inheritedCustodyRows.map((row) => ({
            organizationId,
            actorUserId: userId,
            action: "CUSTODY_RELEASED",
            entityType: "ASSET",
            entityId: row.assetId,
            assetId: row.assetId,
            kitId: kit.id,
            teamMemberId: row.teamMemberId,
            targetUserId: kit.custody?.custodian?.user?.id ?? undefined,
            meta: { viaKit: true },
          })),
          tx
        );
      }

      // Delete kit custody and update kit status. Deleting the KitCustody
      // row cascades to its child Custody rows (kitCustodyId FK) — no
      // explicit `tx.custody.deleteMany` is needed any more.
      await tx.kit.update({
        where: { id: kitId, organizationId },
        data: {
          status: KitStatus.AVAILABLE,
          custody: { delete: true },
        },
      });

      // Only mark assets AVAILABLE if no operator-assigned custody remains.
      // If an asset still has direct (non-kit) custody, it keeps IN_CUSTODY.
      const assetIds = kit.assets.map((a) => a.id);
      const assetsWithRemainingCustody = await tx.custody.findMany({
        where: { assetId: { in: assetIds } },
        select: { assetId: true },
      });
      const stillCustodiedAssetIds = new Set(
        assetsWithRemainingCustody.map((c) => c.assetId)
      );
      const assetsToFlipAvailable = assetIds.filter(
        (id) => !stillCustodiedAssetIds.has(id)
      );
      if (assetsToFlipAvailable.length > 0) {
        await tx.asset.updateMany({
          where: { id: { in: assetsToFlipAvailable }, organizationId },
          data: { status: AssetStatus.AVAILABLE },
        });
      }
    });

    // Notes can be created outside transaction (not critical for consistency)
    await createNotes({
      content: `${actorLink} released ${custodianDisplay}'s custody via kit: ${kitLink}.`,
      type: "UPDATE",
      userId,
      assetIds: kit.assets.map((asset) => asset.id),
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
       * an asset in the kit that is AVAILABLE and has no relevant booking.
       * Kit membership is read through the `AssetKit` pivot. */
      const kitAsset = await db.asset.findFirst({
        where: {
          assetKits: { some: { kitId: kit.id } },
          bookingAssets: {
            some: { booking: { status: { in: ["ONGOING", "OVERDUE"] } } },
          },
        },
        select: {
          id: true,
          bookingAssets: {
            where: { booking: { status: { in: ["ONGOING", "OVERDUE"] } } },
            include: {
              booking: {
                select: {
                  id: true,
                  custodianTeamMember: true,
                  custodianUser: {
                    select: {
                      firstName: true,
                      lastName: true,
                      displayName: true,
                      profilePicture: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      const booking = kitAsset?.bookingAssets[0]?.booking;
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
    bookingAssets: { booking: CurrentBookingType }[];
  }[];
}) {
  const ongoingBookingAsset = kit.assets
    // Filter each asset's bookingAssets to only ongoing or overdue ones
    .map((a) => ({
      ...a,
      bookingAssets: a.bookingAssets.filter(
        (ba) =>
          ba.booking.status === BookingStatus.ONGOING ||
          ba.booking.status === BookingStatus.OVERDUE
      ),
    }))
    // Only consider assets that are actually checked out
    .filter((a) => a.status === AssetStatus.CHECKED_OUT)
    // Find the first asset that has any ongoing/overdue bookings
    .find((a) => a.bookingAssets.length > 0);

  const ongoingBooking = ongoingBookingAsset
    ? ongoingBookingAsset.bookingAssets[0].booking
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
    const where: Prisma.KitWhereInput = kitIds.includes(ALL_SELECTED_KEY)
      ? getKitsWhereInput({ organizationId, currentSearchParams })
      : { id: { in: kitIds }, organizationId };

    const kitRows = await db.kit.findMany({
      where,
      select: {
        id: true,
        name: true,
        image: true,
        assetKits: {
          select: { asset: { select: { id: true, title: true } } },
        },
        custody: {
          select: {
            id: true,
            custodian: {
              select: {
                id: true,
                name: true,
                // why: wrapCustodianForNote / wrapUserLinkForNote use the
                // first/last/displayName to render the linked-text in the
                // resulting note; without them the fallback reads
                // "Unknown User".
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    displayName: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Flatten pivot rows into the in-memory `assets` shape that
    // `performKitDeletion` consumes.
    const kits = kitRows.map((k) => ({
      ...k,
      assets: (k.assetKits ?? []).map((ak) => ak.asset),
    }));

    await performKitDeletion({
      kits,
      organizationId,
      userId,
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
     * We have to make notes and assign custody to all assets of a kit so we have to make this query.
     * `type` and `quantity` are needed so qty-tracked assets get the asset's
     * full tracked quantity on the inherited Custody row (Site 3 of the kit
     * custody correctness fixes).
     */
    const [kits, user, custodianTeamMember] = await Promise.all([
      db.kit.findMany({
        where,
        select: {
          id: true,
          name: true,
          status: true,
          // We include the kit's id/name on each asset row by
          // re-projecting the parent kit, since the helper needs a
          // {kit: {id, name}} shape downstream to render the note link.
          assetKits: {
            select: {
              asset: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                  type: true,
                  quantity: true,
                },
              },
            },
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
      db.teamMember.findUnique({
        where: { id: custodianId },
        select: {
          id: true,
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

    const someKitsNotAvailable = kits.some((kit) => kit.status !== "AVAILABLE");
    if (someKitsNotAvailable) {
      throw new ShelfError({
        cause: null,
        message:
          "There are some unavailable kits. Please make sure you are selecting only available kits.",
        label,
      });
    }

    // Flatten the pivot rows into {asset, kit} pairs so downstream code
    // (notes, activity events) can read both sides without changing
    // shape.
    const allAssetsOfAllKits = kits.flatMap((kit) =>
      (kit.assetKits ?? []).map((ak) => ({
        ...ak.asset,
        kit: { id: kit.id, name: kit.name },
      }))
    );

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

      /**
       * `createMany` doesn't return rows, so re-query the just-created
       * KitCustody rows to get their IDs. Each child Custody row is tagged
       * with its parent's `kitCustodyId` so the kit→assets relationship is
       * traceable and FK cascade can clean up on release.
       */
      const kitCustodyRows = await tx.kitCustody.findMany({
        where: { kitId: { in: kits.map((kit) => kit.id) } },
        select: { id: true, kitId: true },
      });
      const kitCustodyByKitId = new Map(
        kitCustodyRows.map((kc) => [kc.kitId, kc.id])
      );

      /** If a kit is going to be in custody, then all it's assets should also inherit the same status */

      /** Creating custodies over assets of kits — one row per (asset, kit-custody) */
      const inheritDataPerKit = await Promise.all(
        kits.map(async (kit) => {
          const kitCustodyId = kitCustodyByKitId.get(kit.id);
          if (!kitCustodyId) return [];
          return buildKitCustodyInheritData({
            tx,
            kitCustodyId,
            teamMemberId: custodianId,
            assetIds: (kit.assetKits ?? []).map((ak) => ak.asset.id),
          });
        })
      );
      const inheritData = inheritDataPerKit.flat();
      if (inheritData.length > 0) {
        await tx.custody.createMany({ data: inheritData });
      }

      /** Updating status of all assets of kits */
      await tx.asset.updateMany({
        where: { id: { in: allAssetsOfAllKits.map((asset) => asset.id) } },
        data: { status: AssetStatus.IN_CUSTODY },
      });

      /** Creating notes for all the assets of the kit */
      const actor = wrapUserLinkForNote({
        id: userId,
        firstName: user?.firstName,
        lastName: user?.lastName,
      });
      const custodianDisplay = custodianTeamMember
        ? wrapCustodianForNote({ teamMember: custodianTeamMember })
        : `**${custodianName.trim()}**`;
      await tx.note.createMany({
        data: allAssetsOfAllKits.map((asset) => {
          const kitLink = asset.kit
            ? wrapLinkForNote(`/kits/${asset.kit.id}`, asset.kit.name.trim())
            : "**Unknown Kit**";
          return {
            content: `${actor} granted ${custodianDisplay} custody via kit assignment ${kitLink}.`,
            type: "UPDATE",
            userId,
            assetId: asset.id,
          };
        }),
      });

      // Activity events — one CUSTODY_ASSIGNED per asset, inside the tx.
      // `meta.quantity` mirrors the quantity persisted on the child Custody
      // row so reports can aggregate by units, not just rows.
      await recordEvents(
        allAssetsOfAllKits.map((asset) => ({
          organizationId,
          actorUserId: userId,
          action: "CUSTODY_ASSIGNED",
          entityType: "ASSET",
          entityId: asset.id,
          assetId: asset.id,
          kitId: asset.kit?.id ?? undefined,
          teamMemberId: custodianId,
          targetUserId: custodianTeamMember?.user?.id ?? undefined,
          meta: {
            viaKit: true,
            quantity:
              asset.type === AssetType.QUANTITY_TRACKED
                ? asset.quantity ?? 1
                : 1,
          },
        })),
        tx
      );
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
     * To make notes and release assets of kits we have to make this query.
     *
     * Kit assets come through the `AssetKit` pivot; we pull each asset
     * row via `assetKits.asset` and re-attach the parent kit's
     * `{ id, name }` to it so the downstream note creation can render
     * a kit link without changing shape.
     */
    const [kitRows, user] = await Promise.all([
      db.kit.findMany({
        where,
        select: {
          id: true,
          name: true,
          status: true,
          custody: {
            select: { id: true, custodian: { include: { user: true } } },
          },
          assetKits: {
            select: {
              asset: {
                select: {
                  id: true,
                  status: true,
                  title: true,
                  custody: { select: { id: true } },
                },
              },
            },
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

    // Flatten pivot rows back into kit-shaped {..., assets: [...]} so the
    // existing code path reads the same. Each asset carries a
    // synthetic `kit` field used for the note-link rendering below.
    const kits = kitRows.map((kit) => ({
      ...kit,
      assets: (kit.assetKits ?? []).map((ak) => ({
        ...ak.asset,
        kit: { id: kit.id, name: kit.name },
      })),
    }));

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
      /**
       * Capture the kit-allocated Custody rows BEFORE the cascade fires so we
       * can emit one `CUSTODY_RELEASED` event per row. Filtering by the
       * KitCustody IDs (rather than just `assetId`) keeps operator-assigned
       * custody on the same assets safe — it has `kitCustodyId IS NULL` and
       * is not affected by the cascade.
       */
      const kitCustodyRows = await tx.kitCustody.findMany({
        where: { kitId: { in: kits.map((kit) => kit.id) } },
        select: { id: true, kitId: true, custodianId: true },
      });
      const releasedCustodyRows =
        kitCustodyRows.length > 0
          ? await tx.custody.findMany({
              where: {
                kitCustodyId: { in: kitCustodyRows.map((kc) => kc.id) },
              },
              select: {
                assetId: true,
                teamMemberId: true,
                kitCustodyId: true,
              },
            })
          : [];

      // Map each released asset back to its kit (for the kitId field on the
      // event). This is one tiny lookup map; we already have everything in
      // memory.
      const kitIdByKitCustodyId = new Map(
        kitCustodyRows.map((kc) => [kc.id, kc.kitId])
      );

      // Activity events emitted FIRST so they roll back atomically with the
      // mutation if anything below fails. Cascade-driven deletes happen
      // after this point.
      if (releasedCustodyRows.length > 0) {
        await recordEvents(
          releasedCustodyRows.map((row) => ({
            organizationId,
            actorUserId: userId,
            action: "CUSTODY_RELEASED" as const,
            entityType: "ASSET" as const,
            entityId: row.assetId,
            assetId: row.assetId,
            kitId: row.kitCustodyId
              ? kitIdByKitCustodyId.get(row.kitCustodyId)
              : undefined,
            teamMemberId: row.teamMemberId,
            targetUserId: custodian?.user?.id ?? undefined,
            meta: { viaKit: true },
          })),
          tx
        );
      }

      /**
       * Deleting all custodies of kits — FK cascade (kitCustodyId on Custody)
       * removes the child Custody rows automatically, so no explicit
       * `tx.custody.deleteMany` is needed any more.
       */
      await tx.kitCustody.deleteMany({
        where: {
          kitId: { in: kits.map((kit) => kit.id) },
        },
      });

      /** Updating status of all kits to AVAILABLE */
      await tx.kit.updateMany({
        where: { id: { in: kits.map((kit) => kit.id) } },
        data: { status: KitStatus.AVAILABLE },
      });

      /**
       * Only flip assets to AVAILABLE if no operator-assigned custody
       * remains. Direct per-unit custody (kitCustodyId IS NULL) keeps the
       * asset IN_CUSTODY for that custodian.
       */
      const allAssetIds = allAssetsOfAllKits.map((asset) => asset.id);
      const stillCustodied = await tx.custody.findMany({
        where: { assetId: { in: allAssetIds } },
        select: { assetId: true },
      });
      const stillCustodiedIds = new Set(stillCustodied.map((c) => c.assetId));
      const assetsToFlipAvailable = allAssetIds.filter(
        (id) => !stillCustodiedIds.has(id)
      );
      if (assetsToFlipAvailable.length > 0) {
        await tx.asset.updateMany({
          where: { id: { in: assetsToFlipAvailable } },
          data: { status: AssetStatus.AVAILABLE },
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
      await tx.note.createMany({
        data: allAssetsOfAllKits.map((asset) => {
          const kitLink = asset.kit
            ? wrapLinkForNote(`/kits/${asset.kit.id}`, asset.kit.name.trim())
            : "**Unknown Kit**";
          return {
            content: `${actor} released ${custodianDisplay}'s custody via kit assignment ${kitLink}.`,
            type: "UPDATE",
            userId,
            assetId: asset.id,
          };
        }),
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
            name: kit.trim(),
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
        kits.set(kit, newKit);
      } else {
        // if the location exists, we just update the id
        kits.set(kit, existingKit);
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
  const [qr, kit] = await Promise.all([
    getQr({ id: qrId }),
    db.kit.findFirst({
      where: { id: kitId, organizationId },
      select: { qrCodes: { select: { id: true } } },
    }),
  ]);

  if (!kit) {
    throw new ShelfError({
      cause: null,
      message: "Kit not found.",
      label,
      additionalData: { kitId, organizationId, qrId },
      shouldBeCaptured: false,
    });
  }

  if (qr.organizationId && qr.organizationId !== organizationId) {
    throw new ShelfError({
      cause: null,
      title: "QR not valid.",
      message: "This QR code does not belong to your organization",
      label,
      status: 403,
      shouldBeCaptured: false,
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

  const oldQrCode = kit.qrCodes[0];

  await Promise.all([
    db.qr.update({
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
    const selectedKits = await db.kit.findMany({
      where: { id: { in: kitIds } },
      select: {
        assetKits: {
          select: { asset: { select: { id: true, status: true } } },
        },
      },
    });

    const allAssets = selectedKits.flatMap((kit) =>
      (kit.assetKits ?? []).map((ak) => ak.asset)
    );

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
    // Get kit with its assets first.
    const kitRow = await db.kit.findUnique({
      where: { id, organizationId },
      select: {
        id: true,
        name: true,
        assetKits: {
          select: {
            asset: {
              select: {
                id: true,
                title: true,
                location: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!kitRow) {
      throw new ShelfError({
        cause: null,
        message: "Kit not found",
        label,
        shouldBeCaptured: false,
      });
    }

    // Flatten pivot rows into the in-memory `assets` shape used below.
    const kit = {
      ...kitRow,
      assets: (kitRow.assetKits ?? []).map((ak) => ak.asset),
    };

    const assetIds = kit.assets.map((asset) => asset.id);

    if (newLocationId) {
      // Connect both kit and its assets to the new location in one update
      await db.location.update({
        where: { id: newLocationId },
        data: {
          kits: {
            connect: { id },
          },
          assets: {
            connect: assetIds.map((id) => ({ id })),
          },
        },
      });

      // Add notes to assets about location update via parent kit
      if (userId && assetIds.length > 0) {
        const user = await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          } satisfies Prisma.UserSelect,
        });
        const location = await db.location.findUnique({
          where: { id: newLocationId },
          select: { name: true, id: true },
        });

        // Create individual notes for each asset
        await Promise.all(
          kit.assets.map((asset) =>
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
      // Disconnect both kit and its assets from the current location
      await db.location.update({
        where: { id: currentLocationId },
        data: {
          kits: {
            disconnect: { id },
          },
          assets: {
            disconnect: assetIds.map((id) => ({ id })),
          },
        },
      });

      // Add notes to assets about location removal via parent kit
      if (userId && assetIds.length > 0) {
        const user = await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          } satisfies Prisma.UserSelect,
        });
        const currentLocation = await db.location.findUnique({
          where: { id: currentLocationId },
          select: { name: true, id: true },
        });

        // Create individual notes for each asset
        await Promise.all(
          kit.assets.map((asset) =>
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
    return await db.kit.findUnique({
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
    const where: Prisma.KitWhereInput = kitIds.includes(ALL_SELECTED_KEY)
      ? getKitsWhereInput({ organizationId, currentSearchParams })
      : { id: { in: kitIds }, organizationId };

    // Get kits with their assets before updating.
    // flatten back into a `.assets` shape downstream.
    const kitsWithAssetsRows = await db.kit.findMany({
      where,
      select: {
        id: true,
        name: true,
        locationId: true,
        location: { select: { id: true, name: true } },
        assetKits: {
          select: {
            asset: {
              select: {
                id: true,
                title: true,
                location: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });

    // Flatten pivot rows back into a kit-shaped `.assets` array so the
    // rest of this function reads as it did pre-pivot.
    const kitsWithAssets = kitsWithAssetsRows.map((kit) => ({
      ...kit,
      assets: (kit.assetKits ?? []).map((ak) => ak.asset),
    }));

    const actualKitIds = kitsWithAssets.map((kit) => kit.id);
    const allAssets = kitsWithAssets.flatMap((kit) => kit.assets);

    if (
      newLocationId &&
      newLocationId.trim() !== "" &&
      actualKitIds.length > 0
    ) {
      // Update location to connect both kits and their assets
      await db.location.update({
        where: { id: newLocationId },
        data: {
          kits: {
            connect: actualKitIds.map((id) => ({ id })),
          },
          assets: {
            connect: allAssets.map((asset) => ({ id: asset.id })),
          },
        },
      });

      // Create notes for affected assets
      if (allAssets.length > 0) {
        const user = await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          } satisfies Prisma.UserSelect,
        });
        const location = await db.location.findUnique({
          where: { id: newLocationId },
          select: { name: true, id: true },
        });

        // Create individual notes for each asset
        await Promise.all(
          allAssets.map((asset) =>
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
      await db.kit.updateMany({
        where,
        data: {
          locationId: null,
        },
      });

      // Also remove location from assets and create notes
      if (allAssets.length > 0) {
        const user = await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          } satisfies Prisma.UserSelect,
        });

        await db.asset.updateMany({
          where: {
            id: { in: allAssets.map((asset) => asset.id) },
          },
          data: {
            locationId: null,
          },
        });

        // Create individual notes for each asset
        await Promise.all(
          allAssets.map((asset) =>
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
        displayName: true,
      } satisfies Prisma.UserSelect,
    });
    const userLink = wrapUserLinkForNote({
      id: userId,
      firstName: userForNote?.firstName,
      lastName: userForNote?.lastName,
    });

    if (newLocationId && newLocationId.trim() !== "") {
      const location = await db.location.findUnique({
        where: { id: newLocationId },
        select: { id: true, name: true },
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
        displayName: true,
      } satisfies Prisma.UserSelect,
    });
    const actor = wrapUserLinkForNote({
      id: userId,
      firstName: user?.firstName,
      lastName: user?.lastName,
    });

    const kitWithRelations = await db.kit
      .findUniqueOrThrow({
        where: { id: kitId, organizationId },
        include: {
          location: { select: { id: true, name: true } },
          // Each pivot row carries the kitId (denormalised) so the
          // `asset.kit?.id` checks downstream can map to
          // `asset.assetKits[0]?.kitId`.
          assetKits: {
            select: {
              kitId: true,
              asset: {
                select: {
                  id: true,
                  title: true,
                  assetKits: { select: { kitId: true } },
                  bookingAssets: {
                    include: {
                      booking: { select: { id: true, status: true } },
                    },
                  },
                },
              },
            },
          },
          custody: {
            select: {
              id: true,
              custodian: {
                select: {
                  id: true,
                  name: true,
                  user: {
                    select: {
                      id: true,
                      email: true,
                      firstName: true,
                      lastName: true,
                      displayName: true,
                      profilePicture: true,
                    },
                  },
                },
              },
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Kit not found",
          additionalData: { kitId, userId, organizationId },
          status: 404,
          label: "Kit",
          shouldBeCaptured: !isNotFoundError(cause),
        });
      });

    // Flatten the AssetKit pivot rows back into a list of assets so the
    // rest of this function reads the same way it did pre-pivot.
    const kit = {
      ...kitWithRelations,
      assets: (kitWithRelations.assetKits ?? []).map((ak) => ak.asset),
    };

    const kitCustodianDisplay = kit.custody?.custodian
      ? wrapCustodianForNote({ teamMember: kit.custody.custodian })
      : undefined;

    const removedAssets = kit.assets.filter(
      (asset) => !assetIds.includes(asset.id)
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

      const allAssets = await db.asset.findMany({
        where: assetsWhere,
        select: { id: true },
      });
      const kitAssets = kit.assets.map((asset) => asset.id);
      const removedAssetsIds = removedAssets.map((asset) => asset.id);

      /**
       * New assets that needs to be added are
       * - Previously added assets
       * - All assets with applied filters
       */
      assetIds = [
        ...new Set([
          ...allAssets.map((asset) => asset.id),
          ...kitAssets.filter((asset) => !removedAssetsIds.includes(asset)),
        ]),
      ];
    }

    // Get all assets that should be in the kit (based on assetIds) with organization scoping.
    // `type` and `quantity` are required so that inheriting kit-custody on
    // qty-tracked assets writes the asset's full tracked quantity into the
    // child Custody row instead of defaulting to 1.
    const allAssetsForKit = await db.asset
      .findMany({
        where: { id: { in: assetIds }, organizationId },
        select: {
          id: true,
          title: true,
          type: true,
          quantity: true,
          // Pull the (≤1, today) row so we can check whether the asset
          // already lives in this kit.
          assetKits: { select: { kitId: true } },
          custody: true,
          location: { select: { id: true, name: true } },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message:
            "Something went wrong while fetching the assets. Please try again or contact support.",
          additionalData: { assetIds, userId, kitId },
          label: "Kit",
        });
      });

    // Identify which assets are actually new (not already in this kit)
    const newlyAddedAssets = allAssetsForKit.filter(
      (asset) =>
        !kit.assets.some((existingAsset) => existingAsset.id === asset.id)
    );

    /** An asset already in custody cannot be added to a kit */
    const isSomeAssetInCustody = newlyAddedAssets.some(
      (asset) =>
        hasCustody(asset.custody) && asset.assetKits[0]?.kitId !== kit.id
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
      kit.assets
        .find((a) => a.bookingAssets.length > 0)
        ?.bookingAssets.map((ba) => ba.booking) ?? [];

    // The old kit.update({ data: { assets: { connect, disconnect } } })
    // block becomes direct pivot writes inside a single $transaction so
    // remove + add are atomic.
    await db.$transaction(async (tx) => {
      // Disconnect: drop the pivot rows for removed assets (only when not
      // in addOnly mode).
      if (!addOnly && removedAssets.length > 0) {
        await tx.assetKit.deleteMany({
          where: {
            kitId: kit.id,
            assetId: { in: removedAssets.map(({ id }) => id) },
          },
        });
      }

      // Cross-kit move: assets being added that already live in another
      // kit need their existing pivot row dropped first; @@unique([assetId])
      // forbids two rows for the same asset, so the createMany below would
      // otherwise hit P2002. Pre-pivot this worked because Asset.kitId was
      // an update-in-place FK.
      const movedFromOtherKitIds = newlyAddedAssets
        .filter((asset) => (asset.assetKits?.length ?? 0) > 0)
        .map((asset) => asset.id);
      if (movedFromOtherKitIds.length > 0) {
        await tx.assetKit.deleteMany({
          where: { assetId: { in: movedFromOtherKitIds } },
        });
      }

      // Connect: create one pivot row per newly added asset.
      if (newlyAddedAssets.length > 0) {
        await tx.assetKit.createMany({
          data: newlyAddedAssets.map(({ id }) => ({
            assetId: id,
            kitId: kit.id,
            organizationId,
          })),
        });
      }
    });

    // We synthesise the `{ kit }` field the note helper consumes from
    // each asset's current `assetKits` pivot rows.
    const newlyAddedAssetsForNotes = newlyAddedAssets.map((asset) => ({
      id: asset.id,
      title: asset.title,
      kit: asset.assetKits[0]?.kitId
        ? // For freshly-attached assets we don't have the source kit's
          // name in scope; the note helper's `currentKit` path only
          // uses `id` + `name`, so fall back to "" for the latter — the
          // helper still renders a sane link.
          { id: asset.assetKits[0].kitId, name: "" }
        : null,
    }));
    const removedAssetsForNotes = (addOnly ? [] : removedAssets).map(
      (asset) => ({
        id: asset.id,
        title: asset.title,
        // Removed assets came from `kit.assets`, which itself was
        // flattened off `assetKits` for this kit — so the source kit
        // is the parent kit we're editing.
        kit: { id: kit.id, name: kit.name },
      })
    );

    await createBulkKitChangeNotes({
      kit,
      newlyAddedAssets: newlyAddedAssetsForNotes,
      removedAssets: removedAssetsForNotes,
      userId,
    });

    // Activity events — one ASSET_KIT_CHANGED per asset added or removed.
    const kitChangeEvents: Parameters<typeof recordEvents>[0] = [
      ...newlyAddedAssets.map((asset) => ({
        organizationId,
        actorUserId: userId,
        action: "ASSET_KIT_CHANGED" as const,
        entityType: "ASSET" as const,
        entityId: asset.id,
        assetId: asset.id,
        kitId: kit.id,
        field: "kitId",
        // (the 1:1 FK). With the pivot, an asset already in another kit
        // has its kit-id in `assetKits[0].kitId`.
        fromValue: asset.assetKits[0]?.kitId ?? null,
        toValue: kit.id,
      })),
      ...(addOnly ? [] : removedAssets).map((asset) => ({
        organizationId,
        actorUserId: userId,
        action: "ASSET_KIT_CHANGED" as const,
        entityType: "ASSET" as const,
        entityId: asset.id,
        assetId: asset.id,
        // The removal is still "about" this kit — populate the cross-ref so
        // "all activity for kit X" report queries see both adds and removes.
        // Flagged but deferred on PR #2495; picked up during Phase 4a testing.
        kitId: kit.id,
        field: "kitId",
        fromValue: kit.id,
        toValue: null,
      })),
    ];
    if (kitChangeEvents.length > 0) {
      await recordEvents(kitChangeEvents);
    }

    // Handle location cascade for newly added assets (after kit assignment notes)
    if (newlyAddedAssets.length > 0) {
      if (kit.location) {
        // Kit has a location, update all newly added assets to that location
        await db.asset.updateMany({
          where: { id: { in: newlyAddedAssets.map((asset) => asset.id) } },
          data: { locationId: kit.location.id },
        });

        // Create notes for assets that had their location changed
        const user = await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          } satisfies Prisma.UserSelect,
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
          await db.asset.updateMany({
            where: { id: { in: assetsWithLocation.map((asset) => asset.id) } },
            data: { locationId: null },
          });

          // Create notes for assets that had their location removed
          const user = await getUserByID(userId, {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              displayName: true,
            } satisfies Prisma.UserSelect,
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
      (asset) => !hasCustody(asset.custody)
    );

    if (
      kit.custody &&
      kit.custody.id &&
      kit.custody.custodian.id &&
      assetsToInheritStatus.length > 0
    ) {
      const kitCustodyId = kit.custody.id;
      const teamMemberId = kit.custody.custodian.id;

      // Build child Custody rows tagged with `kitCustodyId` and threaded with
      // the asset's *remaining* tracked quantity (qty-tracked) or 1
      // (individual). The helper subtracts already-allocated custody so the
      // kit-allocated row never over-allocates the asset's pool. See
      // `buildKitCustodyInheritData`. Must run inside the tx — its read of
      // existing custody must see rows written earlier in this tx.
      const inheritedAssetIds = await db.$transaction(async (tx) => {
        const inheritData = await buildKitCustodyInheritData({
          tx,
          kitCustodyId,
          teamMemberId,
          assetIds: assetsToInheritStatus.map((a) => a.id),
        });

        if (inheritData.length === 0) return [];

        await tx.custody.createMany({ data: inheritData });

        const inheritedIds = inheritData.map((row) => row.assetId);
        await tx.asset.updateMany({
          where: { id: { in: inheritedIds }, organizationId },
          data: { status: AssetStatus.IN_CUSTODY },
        });

        // Activity events — one CUSTODY_ASSIGNED per asset that inherited custody.
        await recordEvents(
          inheritData.map((row) => ({
            organizationId,
            actorUserId: userId,
            action: "CUSTODY_ASSIGNED" as const,
            entityType: "ASSET" as const,
            entityId: row.assetId,
            assetId: row.assetId,
            kitId: kit.id,
            teamMemberId,
            targetUserId: kit.custody?.custodian?.user?.id ?? undefined,
            meta: { viaKit: true, quantity: row.quantity },
          })),
          tx
        );
        return inheritedIds;
      });

      // Create notes only for assets that actually received an inherited
      // custody row. Fully operator-allocated qty-tracked assets are skipped
      // (no kit-custody row → no "granted custody" note for that asset).
      if (inheritedAssetIds.length > 0) {
        const custodianDisplay = kitCustodianDisplay ?? "**Unknown Custodian**";
        await createNotes({
          content: `${actor} granted ${custodianDisplay} custody.`,
          type: NoteType.UPDATE,
          userId,
          assetIds: inheritedAssetIds,
        });
      }
    }

    /**
     * If a kit is in custody and some assets are removed,
     * then we have to make the removed assets Available
     * Only apply this when not in addOnly mode
     */
    if (
      !addOnly &&
      removedAssets.length &&
      kit.custody?.id &&
      kit.custody.custodian.id
    ) {
      const custodianDisplay = kitCustodianDisplay ?? "**Unknown Custodian**";
      const assetIds = removedAssets.map((a) => a.id);
      const kitCustodyId = kit.custody.id;

      // Use transaction for atomicity - prevents orphaned custody records.
      // Filter the deleteMany by `kitCustodyId` so only kit-allocated rows
      // are removed. Operator-assigned per-unit custody on the same asset
      // (`kitCustodyId IS NULL`) stays — that's separate ownership.
      await db.$transaction(async (tx) => {
        // Capture the kit-allocated rows before deletion to emit events.
        const removedKitCustodyRows = await tx.custody.findMany({
          where: { assetId: { in: assetIds }, kitCustodyId },
          select: { assetId: true, teamMemberId: true },
        });

        if (removedKitCustodyRows.length > 0) {
          await recordEvents(
            removedKitCustodyRows.map((row) => ({
              organizationId,
              actorUserId: userId,
              action: "CUSTODY_RELEASED" as const,
              entityType: "ASSET" as const,
              entityId: row.assetId,
              assetId: row.assetId,
              kitId: kit.id,
              teamMemberId: row.teamMemberId,
              targetUserId: kit.custody?.custodian?.user?.id ?? undefined,
              meta: { viaKit: true },
            })),
            tx
          );
        }

        await tx.custody.deleteMany({
          where: { assetId: { in: assetIds }, kitCustodyId },
        });

        // Only flip to AVAILABLE for assets that have no remaining custody
        // (an operator-assigned per-unit row would keep them IN_CUSTODY).
        const stillCustodied = await tx.custody.findMany({
          where: { assetId: { in: assetIds } },
          select: { assetId: true },
        });
        const stillCustodiedIds = new Set(stillCustodied.map((c) => c.assetId));
        const assetsToFlipAvailable = assetIds.filter(
          (id) => !stillCustodiedIds.has(id)
        );
        if (assetsToFlipAvailable.length > 0) {
          await tx.asset.updateMany({
            where: { id: { in: assetsToFlipAvailable }, organizationId },
            data: { status: AssetStatus.AVAILABLE },
          });
        }
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

    if (bookingsToUpdate?.length) {
      await Promise.all(
        bookingsToUpdate.flatMap((booking) => {
          const ops = [];
          if (newlyAddedAssets.length > 0) {
            ops.push(
              db.bookingAsset.createMany({
                data: newlyAddedAssets.map((a) => ({
                  bookingId: booking.id,
                  assetId: a.id,
                })),
                skipDuplicates: true,
              })
            );
          }
          if (removedAssets.length > 0) {
            ops.push(
              db.bookingAsset.deleteMany({
                where: {
                  bookingId: booking.id,
                  assetId: { in: removedAssets.map((a) => a.id) },
                },
              })
            );
          }
          return ops;
        })
      );
    }

    /**
     * If the kit is part of an ONGOING booking, then we have to make all
     * the assets CHECKED_OUT
     */
    if (kit.status === KitStatus.CHECKED_OUT) {
      await db.asset.updateMany({
        where: { id: { in: newlyAddedAssets.map((a) => a.id) } },
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
        displayName: true,
      } satisfies Prisma.UserSelect,
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

    // We pull the parent kit (today: ≤1 pivot row per asset) through
    // `assetKits.kit`, then flatten back into a synthetic `asset.kit`
    // shape so the rest of this function reads as it did pre-pivot.
    const assetRows = await db.asset.findMany({
      where: { id: { in: resolvedIds }, organizationId },
      select: {
        id: true,
        title: true,
        assetKits: {
          select: {
            kit: {
              select: {
                id: true,
                name: true,
                custody: { select: { id: true } },
              },
            },
          },
        },
        custody: {
          select: {
            id: true,
            teamMemberId: true,
            kitCustodyId: true,
            custodian: {
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
            },
          },
        },
      },
    });

    const assets = assetRows.map((asset) => ({
      ...asset,
      kit: asset.assetKits[0]?.kit ?? null,
    }));

    await db.$transaction(async (tx) => {
      /**
       * If there are assets whose kits were in custody, then we have to remove
       * the custody FIRST to avoid orphaned custody records when status is set
       * to AVAILABLE.
       *
       * Important: only the Custody rows whose `kitCustodyId` matches the
       * asset's kit's KitCustody.id are kit-allocated. Operator-assigned
       * per-unit custody (`kitCustodyId IS NULL`, or pointing to a different
       * kit) must be left alone — that's separate ownership and not part of
       * this kit-removal.
       */
      const assetsWhoseKitsInCustody = assets.filter(
        (asset) => !!asset.kit?.custody && hasCustody(asset.custody)
      );

      /** Pairs of (asset, kit-allocated custody row) to delete */
      const kitAllocatedCustodyToDelete = assetsWhoseKitsInCustody.flatMap(
        (asset) => {
          const kitCustodyId = asset.kit?.custody?.id;
          if (!kitCustodyId) return [];
          return (asset.custody ?? [])
            .filter((c) => c.kitCustodyId === kitCustodyId)
            .map((c) => ({
              custodyId: c.id,
              assetId: asset.id,
              kitId: asset.kit?.id,
              teamMemberId: c.teamMemberId,
              targetUserId: c.custodian?.user?.id,
            }));
        }
      );

      if (kitAllocatedCustodyToDelete.length > 0) {
        // Emit CUSTODY_RELEASED events BEFORE deletion so they roll back
        // atomically with the mutation if anything fails.
        await recordEvents(
          kitAllocatedCustodyToDelete.map((row) => ({
            organizationId,
            actorUserId: userId,
            action: "CUSTODY_RELEASED" as const,
            entityType: "ASSET" as const,
            entityId: row.assetId,
            assetId: row.assetId,
            kitId: row.kitId ?? undefined,
            teamMemberId: row.teamMemberId,
            targetUserId: row.targetUserId ?? undefined,
            meta: { viaKit: true },
          })),
          tx
        );

        await tx.custody.deleteMany({
          where: {
            id: { in: kitAllocatedCustodyToDelete.map((r) => r.custodyId) },
          },
        });
      }

      /**
       * Removing assets from kits — AFTER custody is deleted. Only flip
       * status to AVAILABLE when no remaining custody exists for the asset
       * (operator-assigned per-unit custody keeps it IN_CUSTODY).
       */
      const allRemovedAssetIds = assets.map((a) => a.id);
      const stillCustodied = await tx.custody.findMany({
        where: { assetId: { in: allRemovedAssetIds } },
        select: { assetId: true },
      });
      const stillCustodiedIds = new Set(stillCustodied.map((c) => c.assetId));
      const assetsToFlipAvailable = allRemovedAssetIds.filter(
        (id) => !stillCustodiedIds.has(id)
      );

      // Detach all from the kit regardless of remaining custody.
      // "detach from kit" means deleting the pivot rows for these
      // assets within this organization.
      await tx.assetKit.deleteMany({
        where: {
          assetId: { in: allRemovedAssetIds },
          organizationId,
        },
      });
      if (assetsToFlipAvailable.length > 0) {
        await tx.asset.updateMany({
          where: { id: { in: assetsToFlipAvailable } },
          data: { status: AssetStatus.AVAILABLE },
        });
      }

      /** Create notes for assets released from custody */
      if (assetsWhoseKitsInCustody.length > 0) {
        await tx.note.createMany({
          data: assetsWhoseKitsInCustody.map((asset) => {
            const primaryCustody = getPrimaryCustody(asset.custody);
            const custodianDisplay = primaryCustody?.custodian
              ? wrapCustodianForNote({
                  teamMember: primaryCustody.custodian,
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
